import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface VideoTask {
  taskId: string;
  userId?: string;        // 创建任务的用户 ID，用于隔离
  prompt: string;
  style: string;
  duration: string;
  createdAt: string;
  status?: 'pending' | 'completed' | 'failed';
  source?: string;
}

export interface PendingTasksResponse {
  success: boolean;
  tasks: VideoTask[];
}

export interface TaskOperationResponse {
  success: boolean;
  message?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tasksFilePath = path.join(__dirname, '../data/videoTasks.json');

function ensureTasksFile(): void {
  const dataDir = path.dirname(tasksFilePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(tasksFilePath)) {
    fs.writeFileSync(tasksFilePath, JSON.stringify([]));
  }
}

export function getPendingTasks(userId?: string): PendingTasksResponse {
  ensureTasksFile();

  try {
    const data = fs.readFileSync(tasksFilePath, 'utf-8');
    const tasks = JSON.parse(data) as VideoTask[];
    let pendingOnly = tasks.filter(t => !t.status || t.status === 'pending');
    // 如果有 userId，只返回该用户的任务
    if (userId) {
      pendingOnly = pendingOnly.filter(t => !t.userId || t.userId === userId);
    }
    pendingOnly.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { success: true, tasks: pendingOnly };
  } catch (error) {
    console.error('Error reading pending tasks:', error);
    return { success: true, tasks: [] };
  }
}

export function addPendingTask(task: Omit<VideoTask, 'createdAt'>): void {
  ensureTasksFile();

  try {
    const data = fs.readFileSync(tasksFilePath, 'utf-8');
    const tasks = JSON.parse(data) as VideoTask[];

    tasks.push({
      ...task,
      createdAt: new Date().toISOString(),
    });

    fs.writeFileSync(tasksFilePath, JSON.stringify(tasks, null, 2));
  } catch (error) {
    console.error('Error adding pending task:', error);
  }
}

export function removePendingTask(taskId: string, userId?: string): TaskOperationResponse {
  ensureTasksFile();

  try {
    const data = fs.readFileSync(tasksFilePath, 'utf-8');
    const tasks = JSON.parse(data) as VideoTask[];

    const filtered = tasks.filter((t) => {
      if (t.taskId !== taskId) return true; // 保留不匹配的
      // 如果提供了 userId，只删除该用户的任务
      if (userId && t.userId && t.userId !== userId) return true;
      return false;
    });

    fs.writeFileSync(tasksFilePath, JSON.stringify(filtered, null, 2));

    return { success: true, message: '任务已移除' };
  } catch (error) {
    console.error('Error removing pending task:', error);
    return { success: false, message: '移除任务失败' };
  }
}

export function getAllTasks(): VideoTask[] {
  ensureTasksFile();
  try { const data = fs.readFileSync(tasksFilePath, 'utf-8'); return JSON.parse(data) as VideoTask[]; }
  catch { return []; }
}

export function updateTaskStatus(taskId: string, status: 'completed' | 'failed'): TaskOperationResponse {
  ensureTasksFile();
  try {
    const data = fs.readFileSync(tasksFilePath, 'utf-8');
    const tasks = JSON.parse(data) as VideoTask[];
    const updated = tasks.map(t => t.taskId === taskId ? { ...t, status } : t);
    fs.writeFileSync(tasksFilePath, JSON.stringify(updated, null, 2));
    console.log(`[TaskService] Task ${taskId} marked as ${status}`);
    return { success: true, message: `任务状态已更新为 ${status}` };
  } catch (error) {
    console.error('Error updating task status:', error);
    return { success: false, message: '更新任务状态失败' };
  }
}

export function cleanStaleTasks(): TaskOperationResponse {
  ensureTasksFile();
  try {
    const data = fs.readFileSync(tasksFilePath, 'utf-8');
    const tasks = JSON.parse(data) as VideoTask[];
    const active = tasks.filter(t => !t.status || t.status === 'pending');
    fs.writeFileSync(tasksFilePath, JSON.stringify(active, null, 2));
    return { success: true, message: `已清理 ${tasks.length - active.length} 个过期任务` };
  } catch (error) { return { success: false, message: '清理失败' }; }
}

export function clearAllPendingTasks(): TaskOperationResponse {
  ensureTasksFile();

  try {
    fs.writeFileSync(tasksFilePath, JSON.stringify([]));
    return { success: true, message: '已清空所有任务' };
  } catch (error) {
    console.error('Error clearing pending tasks:', error);
    return { success: false, message: '清空任务失败' };
  }
}
