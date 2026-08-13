/**
 * Trace 中间件 — 为每个请求注入 traceId
 *
 * 读取请求头 X-Trace-Id（无则生成），挂到 req.traceId，
 * 并在响应头回写 X-Trace-Id 便于前端关联。
 *
 * traceId 贯穿 HTTP → orchestrator → agent 执行链路，
 * 用于关联所有 span，构建完整调用树。
 */
import { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'crypto';

// 扩展 Express Request 类型（与 auth.ts 的 user 扩展合并）
declare global {
  namespace Express {
    interface Request {
      traceId?: string;
    }
  }
}

export function traceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const headerTraceId = req.headers['x-trace-id'] as string | undefined;
  const traceId = headerTraceId || `trace_${Date.now()}_${randomUUID().substring(0, 8)}`;
  req.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  next();
}
