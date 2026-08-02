import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface VideoTask {
  taskId: string;
  prompt: string;
  style: string;
  duration: string;
  createdAt: string;
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

export function getPendingTasks(): PendingTasksResponse {
  ensureTasksFile();

  try {
    const data = fs.readFileSync(tasksFilePath, 'utf-8');
    const tasks = JSON.parse(data) as VideoTask[];
    tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { success: true, tasks };
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

export function removePendingTask(taskId: string): TaskOperationResponse {
  ensureTasksFile();

  try {
    const data = fs.readFileSync(tasksFilePath, 'utf-8');
    const tasks = JSON.parse(data) as VideoTask[];

    const filtered = tasks.filter((t) => t.taskId !== taskId);

    fs.writeFileSync(tasksFilePath, JSON.stringify(filtered, null, 2));

    return { success: true, message: '任务已移除' };
  } catch (error) {
    console.error('Error removing pending task:', error);
    return { success: false, message: '移除任务失败' };
  }
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
