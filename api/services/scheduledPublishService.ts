/**
 * 定时发布调度服务 (Scheduled Publish Scheduler)
 *
 * 支持用户设置定时发布任务，按指定间隔自动发布内容到自媒体平台。
 * 使用 setInterval 实现，支持动态创建、暂停、恢复和删除任务。
 */

import { socialMediaService, type SocialPlatform, type PublishContent } from './socialMediaService.js';

/** 定时发布任务 */
export interface ScheduledTask {
  id: string;
  platforms: SocialPlatform[];
  content: PublishContent;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: string;
  createdAt: string;
  userId?: string;
  lastRunAt?: string;
  lastResult?: 'success' | 'partial' | 'failed';
  runCount: number;
  /** 内部定时器 ID */
  _timer?: ReturnType<typeof setInterval>;
}

class ScheduledPublishService {
  private tasks = new Map<string, ScheduledTask>();
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 每 30 秒检查一次是否有需要执行的任务
    this.checkInterval = setInterval(() => this.checkAndExecute(), 30000);
    console.log('[ScheduledPublish] Scheduler started, checking every 30s');
  }

  /** 创建定时发布任务 */
  createTask(
    platforms: SocialPlatform[],
    content: PublishContent,
    intervalMinutes: number,
    userId?: string
  ): ScheduledTask {
    const id = `sch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date();

    const task: ScheduledTask = {
      id,
      platforms,
      content,
      intervalMinutes,
      enabled: true,
      nextRunAt: new Date(now.getTime() + intervalMinutes * 60000).toISOString(),
      createdAt: now.toISOString(),
      userId,
      runCount: 0,
    };

    this.tasks.set(id, task);
    console.log(`[ScheduledPublish] Task created: ${id}, platforms: ${platforms.join(', ')}, interval: ${intervalMinutes}min`);
    return task;
  }

  /** 获取所有任务 */
  getAllTasks(): ScheduledTask[] {
    const tasks: ScheduledTask[] = [];
    this.tasks.forEach((task) => {
      tasks.push({
        id: task.id,
        platforms: task.platforms,
        content: task.content,
        intervalMinutes: task.intervalMinutes,
        enabled: task.enabled,
        nextRunAt: task.nextRunAt,
        createdAt: task.createdAt,
        userId: task.userId,
        lastRunAt: task.lastRunAt,
        lastResult: task.lastResult,
        runCount: task.runCount,
      });
    });
    return tasks.sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime());
  }

  /** 获取单个任务 */
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id);
  }

  /** 更新任务（启用/暂停） */
  updateTask(id: string, updates: { enabled?: boolean; intervalMinutes?: number; content?: Partial<PublishContent> }): ScheduledTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    if (updates.enabled !== undefined) {
      task.enabled = updates.enabled;
      if (task.enabled) {
        // 重新启用时，更新下次执行时间
        task.nextRunAt = new Date(Date.now() + task.intervalMinutes * 60000).toISOString();
      }
      console.log(`[ScheduledPublish] Task ${id} ${updates.enabled ? 'enabled' : 'paused'}`);
    }

    if (updates.intervalMinutes !== undefined) {
      task.intervalMinutes = updates.intervalMinutes;
      task.nextRunAt = new Date(Date.now() + updates.intervalMinutes * 60000).toISOString();
    }

    if (updates.content !== undefined) {
      task.content = { ...task.content, ...updates.content };
    }

    return task;
  }

  /** 删除任务 */
  deleteTask(id: string): boolean {
    const existed = this.tasks.has(id);
    this.tasks.delete(id);
    if (existed) {
      console.log(`[ScheduledPublish] Task deleted: ${id}`);
    }
    return existed;
  }

  /** 立即执行一次任务 */
  async executeTaskNow(id: string): Promise<{ success: boolean; results: Record<string, any> }> {
    const task = this.tasks.get(id);
    if (!task) {
      return { success: false, results: { error: '任务不存在' } };
    }

    return await this.executeTask(task);
  }

  /** 检查并执行到期的任务 */
  private async checkAndExecute(): Promise<void> {
    const now = Date.now();
    const tasksToRun: ScheduledTask[] = [];

    this.tasks.forEach((task) => {
      if (!task.enabled) return;

      const nextRunTime = new Date(task.nextRunAt).getTime();
      if (now >= nextRunTime) {
        tasksToRun.push(task);
      }
    });

    for (const task of tasksToRun) {
      console.log(`[ScheduledPublish] Executing task ${task.id}: "${task.content.title}"`);
      await this.executeTask(task);
    }
  }

  /** 执行单个任务 */
  private async executeTask(task: ScheduledTask): Promise<{ success: boolean; results: Record<string, any> }> {
    const results = await socialMediaService.publishToMultiple(
      task.platforms,
      task.content,
      task.userId
    );

    task.runCount++;
    task.lastRunAt = new Date().toISOString();

    const successCount = Object.values(results).filter((r) => r.success).length;
    const totalCount = task.platforms.length;

    if (successCount === totalCount) {
      task.lastResult = 'success';
    } else if (successCount > 0) {
      task.lastResult = 'partial';
    } else {
      task.lastResult = 'failed';
    }

    // 更新下次执行时间
    task.nextRunAt = new Date(Date.now() + task.intervalMinutes * 60000).toISOString();

    console.log(
      `[ScheduledPublish] Task ${task.id} completed: ${successCount}/${totalCount} success (${task.lastResult}), next run at ${task.nextRunAt}`
    );

    return {
      success: task.lastResult === 'success',
      results: {
        platforms: results,
        summary: {
          successCount,
          totalCount,
          result: task.lastResult,
          nextRunAt: task.nextRunAt,
          runCount: task.runCount,
        },
      },
    };
  }

  /** 停止调度器 */
  shutdown(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('[ScheduledPublish] Scheduler shut down');
  }
}

// 单例导出
export const scheduledPublishService = new ScheduledPublishService();