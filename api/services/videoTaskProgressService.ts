import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * 持久化的视频任务进度服务
 *
 * 解决问题：videoTaskProgress 原本是内存对象，服务器重启后会丢失，
 * 导致 split_/merge_ 复合任务无法恢复，前端报"任务记录不存在或已过期"。
 *
 * 本服务将进度持久化到磁盘，服务器重启后可自动恢复进行中的任务状态。
 *
 * 并发安全：使用内存缓存 + 写操作队列串行化，避免多任务并发写入时丢失数据。
 */

export interface TaskProgress {
  progress: number;
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  videoUrl?: string;
  error?: string;
  /** 任务类型，用于恢复时判断是否可重新查询第三方 API */
  taskType: 'normal' | 'split' | 'merge';
  /** 原始请求参数，便于过期后提示用户重新生成 */
  prompt?: string;
  style?: string;
  duration?: string;
  /** 创建时间戳，用于自动清理过期记录 */
  createdAt: number;
  /** 最后更新时间戳 */
  updatedAt: number;
}

interface ProgressFileData {
  tasks: Record<string, TaskProgress>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const progressFilePath = path.join(__dirname, '../data/videoTaskProgress.json');

/** 进度记录过期时间：2小时（与前端轮询超时对齐） */
const PROGRESS_EXPIRE_MS = 2 * 60 * 60 * 1000;

/** 内存缓存：所有读写操作优先访问内存，避免频繁磁盘IO */
let taskCache: Record<string, TaskProgress> = {};

/** 写操作队列：串行化所有文件写入，避免竞态条件 */
let writeQueue: Promise<void> = Promise.resolve();

/** 防抖写入：短时间内多次更新只写一次磁盘 */
let writeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const WRITE_DEBOUNCE_MS = 500;

function ensureFile(): void {
  const dataDir = path.dirname(progressFilePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(progressFilePath)) {
    fs.writeFileSync(progressFilePath, JSON.stringify({ tasks: {} }, null, 2));
  }
}

/** 从磁盘加载到内存缓存（启动时调用一次） */
function loadFromDisk(): void {
  ensureFile();
  try {
    const data = fs.readFileSync(progressFilePath, 'utf-8');
    const parsed = JSON.parse(data) as ProgressFileData;
    taskCache = parsed.tasks || {};
  } catch (error) {
    console.error('[TaskProgress] 读取进度文件失败:', error);
    taskCache = {};
  }
}

/** 防抖写入：将内存缓存写入磁盘（异步，不阻塞事件循环） */
function scheduleDiskWrite(): void {
  if (writeDebounceTimer) {
    clearTimeout(writeDebounceTimer);
  }
  writeDebounceTimer = setTimeout(() => {
    writeDebounceTimer = null;
    flushToDisk();
  }, WRITE_DEBOUNCE_MS);
}

/** 将内存缓存写入磁盘（串行化，避免竞态条件） */
function flushToDisk(): void {
  const dataToWrite = JSON.stringify({ tasks: taskCache }, null, 2);
  writeQueue = writeQueue.then(() => {
    return new Promise<void>(resolve => {
      fs.writeFile(progressFilePath, dataToWrite, 'utf-8', err => {
        if (err) {
          console.error('[TaskProgress] 写入进度文件失败:', err);
        }
        resolve();
      });
    });
  });
}

/** 清理过期的进度记录（超过2小时未更新） */
function cleanupExpired(): void {
  const now = Date.now();
  let changed = false;

  for (const taskId of Object.keys(taskCache)) {
    const task = taskCache[taskId];
    if (now - task.updatedAt > PROGRESS_EXPIRE_MS) {
      delete taskCache[taskId];
      changed = true;
    }
  }

  if (changed) {
    scheduleDiskWrite();
  }
}

/** 启动时加载缓存并清理过期记录 */
loadFromDisk();
cleanupExpired();

/** 定期清理过期记录（每30分钟） */
setInterval(cleanupExpired, 30 * 60 * 1000);

/** 获取任务进度 */
export function getTaskProgress(taskId: string): TaskProgress | undefined {
  return taskCache[taskId];
}

/** 设置/更新任务进度 */
export function setTaskProgress(taskId: string, progress: Partial<TaskProgress> & { taskType?: 'normal' | 'split' | 'merge' }): void {
  const existing = taskCache[taskId];

  const now = Date.now();
  taskCache[taskId] = {
    progress: progress.progress ?? existing?.progress ?? 0,
    status: progress.status ?? existing?.status ?? 'processing',
    videoUrl: progress.videoUrl ?? existing?.videoUrl,
    error: progress.error ?? existing?.error,
    taskType: progress.taskType ?? existing?.taskType ?? 'normal',
    prompt: progress.prompt ?? existing?.prompt,
    style: progress.style ?? existing?.style,
    duration: progress.duration ?? existing?.duration,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  scheduleDiskWrite();
}

/** 更新进度（便捷方法，只更新部分字段） */
export function updateTaskProgress(taskId: string, updates: Partial<TaskProgress>): boolean {
  if (!taskCache[taskId]) {
    console.warn(`[TaskProgress] updateTaskProgress: 任务 ${taskId} 不存在，更新被跳过`);
    return false;
  }
  taskCache[taskId] = {
    ...taskCache[taskId],
    ...updates,
    updatedAt: Date.now(),
  };

  scheduleDiskWrite();
  return true;
}

/** 删除任务进度 */
export function removeTaskProgress(taskId: string): void {
  if (taskCache[taskId]) {
    delete taskCache[taskId];
    scheduleDiskWrite();
  }
}

/** 检查任务是否存在（区分"不存在"和"已过期"） */
export function checkTaskExists(taskId: string): { exists: boolean; expired: boolean; task?: TaskProgress } {
  const task = taskCache[taskId];

  if (!task) {
    return { exists: false, expired: false };
  }

  const now = Date.now();
  const expired = now - task.updatedAt > PROGRESS_EXPIRE_MS;

  return { exists: true, expired, task };
}

/** 获取所有进行中的任务（用于状态恢复） */
export function getProcessingTasks(): TaskProgress[] {
  return Object.values(taskCache).filter(t => t.status === 'processing');
}
