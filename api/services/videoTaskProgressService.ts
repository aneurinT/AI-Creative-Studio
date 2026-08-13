import { getDb } from './db/index.js';
import type { TaskProgressRow } from './db/types.js';

/**
 * 持久化的视频任务进度服务（已桥接至数据库适配器）
 *
 * 解决问题：videoTaskProgress 原本是内存对象，服务器重启后会丢失，
 * 导致 split_/merge_ 复合任务无法恢复，前端报"任务记录不存在或已过期"。
 *
 * 本服务通过 DatabaseAdapter 的 getProgressTable() 持久化进度，
 * 服务器重启后可自动恢复进行中的任务状态。
 *
 * 并发安全：内存 L1 缓存加速高频读轮询，写操作同步落盘到适配器
 * （JSON 模式延迟保存，SQLite 模式事务即时持久化）。
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

/** 进度记录过期时间：2小时（与前端轮询超时对齐） */
const PROGRESS_EXPIRE_MS = 2 * 60 * 60 * 1000;

/** 内存 L1 缓存：加速高频读轮询（每5秒一次），写时同步更新缓存与适配器 */
let taskCache: Record<string, TaskProgress> = {};

// ===== 行映射 =====

function toRow(taskId: string, p: TaskProgress): TaskProgressRow {
  return {
    task_id: taskId,
    progress: p.progress,
    status: p.status,
    video_url: p.videoUrl ?? null,
    error: p.error ?? null,
    task_type: p.taskType,
    prompt: p.prompt ?? null,
    style: p.style ?? null,
    duration: p.duration ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

function fromRow(r: TaskProgressRow): TaskProgress {
  return {
    progress: r.progress,
    status: r.status as TaskProgress['status'],
    videoUrl: r.video_url ?? undefined,
    error: r.error ?? undefined,
    taskType: r.task_type as TaskProgress['taskType'],
    prompt: r.prompt ?? undefined,
    style: r.style ?? undefined,
    duration: r.duration ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 从适配器加载到内存缓存（启动时调用一次） */
function loadFromAdapter(): void {
  try {
    const table = getDb().getProgressTable();
    const rows = table.all();
    taskCache = {};
    for (const row of rows) {
      taskCache[row.task_id] = fromRow(row);
    }
  } catch (error) {
    console.error('[TaskProgress] 从适配器加载失败:', error);
    taskCache = {};
  }
}

/** 清理过期的进度记录（超过2小时未更新） */
function cleanupExpired(): void {
  const now = Date.now();
  const expiredIds: string[] = [];

  for (const taskId of Object.keys(taskCache)) {
    const task = taskCache[taskId];
    if (now - task.updatedAt > PROGRESS_EXPIRE_MS) {
      delete taskCache[taskId];
      expiredIds.push(taskId);
    }
  }

  if (expiredIds.length > 0) {
    try {
      const table = getDb().getProgressTable();
      table.deleteWhere(r => expiredIds.includes(r.task_id));
    } catch (error) {
      console.error('[TaskProgress] 清理过期记录失败:', error);
    }
  }
}

/** 启动时加载缓存并清理过期记录 */
loadFromAdapter();
cleanupExpired();

/** 定期清理过期记录（每30分钟） */
setInterval(cleanupExpired, 30 * 60 * 1000);

/** 获取任务进度 */
export function getTaskProgress(taskId: string): TaskProgress | undefined {
  return taskCache[taskId];
}

/** 设置/更新任务进度 */
export function setTaskProgress(
  taskId: string,
  progress: Partial<TaskProgress> & { taskType?: 'normal' | 'split' | 'merge' },
): void {
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

  try {
    getDb().getProgressTable().upsert(toRow(taskId, taskCache[taskId]));
  } catch (error) {
    console.error('[TaskProgress] 写入适配器失败:', error);
  }
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

  try {
    getDb().getProgressTable().upsert(toRow(taskId, taskCache[taskId]));
  } catch (error) {
    console.error('[TaskProgress] 写入适配器失败:', error);
  }
  return true;
}

/** 删除任务进度 */
export function removeTaskProgress(taskId: string): void {
  if (taskCache[taskId]) {
    delete taskCache[taskId];
    try {
      getDb().getProgressTable().delete(taskId);
    } catch (error) {
      console.error('[TaskProgress] 从适配器删除失败:', error);
    }
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
