/**
 * 高并发保护服务
 * 
 * 核心能力：
 * 1. 全局请求限流 — 滑动窗口算法，防止突发流量冲垮服务
 * 2. LLM 调用队列 — 限制并发 LLM 调用数，排队等待
 * 3. 连接池管理 — HTTP Agent keep-alive 复用连接
 * 4. 请求超时 — 全局超时保护，防止雪崩
 * 5. 熔断器 — 连续失败自动熔断，保护下游服务
 */
import type { Request, Response, NextFunction } from 'express';

// ===== 限流器（滑动窗口） =====

interface RateLimitWindow {
  timestamp: number;
  count: number;
}

class SlidingWindowLimiter {
  private windows = new Map<string, RateLimitWindow[]>();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests = 100, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  allow(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    let windows = this.windows.get(key);

    if (!windows) {
      windows = [];
      this.windows.set(key, windows);
    }

    // 清理过期窗口
    windows = windows.filter(w => w.timestamp > windowStart);

    const totalCount = windows.reduce((sum, w) => sum + w.count, 0);
    if (totalCount >= this.maxRequests) return false;

    // 合并到当前秒的窗口
    const currentSecond = Math.floor(now / 1000) * 1000;
    const currentWindow = windows.find(w => w.timestamp === currentSecond);
    if (currentWindow) {
      currentWindow.count++;
    } else {
      windows.push({ timestamp: currentSecond, count: 1 });
    }

    this.windows.set(key, windows);
    return true;
  }

  getRemaining(key: string): number {
    const now = Date.now();
    const windows = this.windows.get(key) || [];
    const active = windows.filter(w => w.timestamp > now - this.windowMs);
    const total = active.reduce((sum, w) => sum + w.count, 0);
    return Math.max(0, this.maxRequests - total);
  }
}

// 全局限流器（100请求/分钟，LLM调用10请求/分钟）
export const globalLimiter = new SlidingWindowLimiter(200, 60000);
export const llmLimiter = new SlidingWindowLimiter(20, 60000);

/** Express 限流中间件 */
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || 'unknown';

  if (!globalLimiter.allow(key)) {
    res.status(429).json({
      success: false,
      error: '请求过于频繁，请稍后再试',
      retryAfter: 5,
    });
    return;
  }
  next();
}

// ===== LLM 调用队列 =====

interface QueuedTask<T> {
  id: string;
  executor: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

class LLMQueue {
  private queue: QueuedTask<any>[] = [];
  private activeCount = 0;
  private maxConcurrent: number;
  private queueTimeout: number;

  constructor(maxConcurrent = 3, queueTimeout = 60000) {
    this.maxConcurrent = maxConcurrent;
    this.queueTimeout = queueTimeout;
  }

  async enqueue<T>(id: string, executor: () => Promise<T>, priority = 0): Promise<T> {
    if (this.activeCount < this.maxConcurrent) {
      return this.execute(id, executor);
    }

    // 排队等待
    console.log(`[Queue] LLM调用排队: ${id} (队列长度: ${this.queue.length})`);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.queue.findIndex(t => t.id === id);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(new Error('LLM 调用超时，请重试'));
        }
      }, this.queueTimeout);

      this.queue.push({ id, executor, resolve, reject, timeout });
    });
  }

  private async execute<T>(id: string, executor: () => Promise<T>): Promise<T> {
    this.activeCount++;
    try {
      const result = await executor();
      return result;
    } finally {
      this.activeCount--;
      this.dequeue();
    }
  }

  private dequeue(): void {
    if (this.queue.length === 0 || this.activeCount >= this.maxConcurrent) return;
    const task = this.queue.shift()!;
    clearTimeout(task.timeout);
    this.execute(task.id, task.executor).then(task.resolve).catch(task.reject);
  }

  getStats() {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

// 全局 LLM 队列（最多 3 个并发）
export const llmQueue = new LLMQueue(3, 60000);

// ===== 熔断器 =====

class CircuitBreaker {
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half_open' = 'closed';
  private failureThreshold: number;
  private recoveryTimeout: number;
  private halfOpenMaxRequests: number;
  private halfOpenRequests = 0;

  constructor(failureThreshold = 5, recoveryTimeout = 30000, halfOpenMaxRequests = 3) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
    this.halfOpenMaxRequests = halfOpenMaxRequests;
  }

  async call<T>(fn: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = 'half_open';
        this.halfOpenRequests = 0;
        console.log('[CircuitBreaker] 进入半开状态，尝试恢复');
      } else {
        if (fallback) return fallback();
        throw new Error('服务暂时不可用（熔断保护）');
      }
    }

    if (this.state === 'half_open' && this.halfOpenRequests >= this.halfOpenMaxRequests) {
      if (fallback) return fallback();
      throw new Error('服务恢复中，请稍后再试');
    }

    try {
      if (this.state === 'half_open') this.halfOpenRequests++;
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      if (fallback) return fallback();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.successCount++;
    if (this.state === 'half_open' && this.successCount >= 3) {
      this.state = 'closed';
      console.log('[CircuitBreaker] 熔断器已恢复');
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      console.error(`[CircuitBreaker] 熔断器触发！连续失败 ${this.failureCount} 次`);
    }
  }

  getState() { return this.state; }
}

// LLM API 熔断器
export const llmCircuitBreaker = new CircuitBreaker(5, 30000, 3);

// ===== 请求超时中间件 =====

export function timeoutMiddleware(timeoutMs = 30000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ success: false, error: '请求超时' });
      }
    }, timeoutMs);

    res.on('finish', () => clearTimeout(timer));
    next();
  };
}

// ===== 并发统计 =====

let activeConnections = 0;
let peakConnections = 0;

export function trackConnection(): void {
  activeConnections++;
  if (activeConnections > peakConnections) peakConnections = activeConnections;
}

export function untrackConnection(): void {
  activeConnections--;
}

export function getConcurrencyStats() {
  return {
    active: activeConnections,
    peak: peakConnections,
    llmQueue: llmQueue.getStats(),
    circuitBreaker: llmCircuitBreaker.getState(),
    rateLimit: {
      globalRemaining: globalLimiter.getRemaining('global'),
      llmRemaining: llmLimiter.getRemaining('global'),
    },
  };
}

// 定期输出并发统计
setInterval(() => {
  if (activeConnections > 0) {
    console.log(`[Concurrency] active=${activeConnections} peak=${peakConnections} llmQueue=${llmQueue.getStats().queued}`);
  }
}, 30000);
