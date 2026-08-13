/**
 * 定时发布调度服务 (Scheduled Publish Scheduler)
 *
 * 支持用户设置定时发布任务，按指定间隔自动发布内容到自媒体平台。
 * 使用 setInterval 轮询，支持动态创建、暂停、恢复和删除任务。
 *
 * 持久化：任务存储于 DB 适配器（scheduled_tasks 表，JSON/SQLite 双模式），
 * 服务重启后自动恢复，不再丢失。每次操作直接读写 DB，无内存缓存状态。
 */

import { socialMediaService, type SocialPlatform, type PublishContent } from './socialMediaService.js';
import { getDb } from './db/index.js';
import type { ScheduledTaskRow } from './db/types.js';

/** 定时发布任务（对外接口，与历史保持兼容） */
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
}

// ===== Row ↔ Task 转换（platforms/content 序列化为 JSON 存储）=====

function rowToTask(row: ScheduledTaskRow): ScheduledTask {
  let platforms: SocialPlatform[] = [];
  let content: PublishContent;
  try { platforms = JSON.parse(row.platformsJson); } catch { /* 兼容脏数据 */ }
  try { content = JSON.parse(row.contentJson); } catch { content = {} as PublishContent; }
  return {
    id: row.id,
    platforms,
    content,
    intervalMinutes: row.intervalMinutes,
    enabled: !!row.enabled,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
    userId: row.userId || undefined,
    lastRunAt: row.lastRunAt || undefined,
    lastResult: (row.lastResult as ScheduledTask['lastResult']) || undefined,
    runCount: row.runCount,
  };
}

function taskToRow(task: ScheduledTask): ScheduledTaskRow {
  return {
    id: task.id,
    platformsJson: JSON.stringify(task.platforms),
    contentJson: JSON.stringify(task.content),
    intervalMinutes: task.intervalMinutes,
    enabled: task.enabled ? 1 : 0,
    nextRunAt: task.nextRunAt,
    createdAt: task.createdAt,
    userId: task.userId || '',
    lastRunAt: task.lastRunAt || null,
    lastResult: task.lastResult || null,
    runCount: task.runCount,
  };
}

/** 获取底层表（封装避免重复调用） */
function table() {
  return getDb().getScheduledTasksTable();
}

class ScheduledPublishService {
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 每 30 秒检查一次是否有需要执行的任务（数据源为 DB，重启后自动恢复）
    this.checkInterval = setInterval(() => this.checkAndExecute(), 30000);
    console.log('[ScheduledPublish] Scheduler started, checking every 30s (persisted)');
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

    table().upsert(taskToRow(task));
    console.log(`[ScheduledPublish] Task created: ${id}, platforms: ${platforms.join(', ')}, interval: ${intervalMinutes}min`);
    return task;
  }

  /** 获取所有任务（按下次执行时间升序） */
  getAllTasks(): ScheduledTask[] {
    const rows = table().query({ orderBy: 'nextRunAt', desc: false });
    return rows.map(rowToTask);
  }

  /** 获取单个任务 */
  getTask(id: string): ScheduledTask | undefined {
    const row = table().get(id);
    return row ? rowToTask(row) : undefined;
  }

  /** 更新任务（启用/暂停/间隔/内容） */
  updateTask(id: string, updates: { enabled?: boolean; intervalMinutes?: number; content?: Partial<PublishContent> }): ScheduledTask | null {
    const row = table().get(id);
    if (!row) return null;
    const task = rowToTask(row);

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

    table().upsert(taskToRow(task));
    return task;
  }

  /** 删除任务 */
  deleteTask(id: string): boolean {
    const existed = table().get(id) != null;
    if (existed) {
      table().delete(id);
      console.log(`[ScheduledPublish] Task deleted: ${id}`);
    }
    return existed;
  }

  /** 立即执行一次任务 */
  async executeTaskNow(id: string): Promise<{ success: boolean; results: Record<string, any> }> {
    const row = table().get(id);
    if (!row) {
      return { success: false, results: { error: '任务不存在' } };
    }
    return await this.executeTask(rowToTask(row));
  }

  /** 检查并执行到期的任务 */
  private async checkAndExecute(): Promise<void> {
    const now = Date.now();
    // 查询启用且到期的任务（直接从 DB 读取，覆盖重启后恢复的场景）
    const dueRows = table().filter(r => r.enabled === 1 && new Date(r.nextRunAt).getTime() <= now);

    for (const row of dueRows) {
      const task = rowToTask(row);
      console.log(`[ScheduledPublish] Executing task ${task.id}: "${task.content.title}"`);
      await this.executeTask(task);
    }
  }

  /** 执行单个任务并回写结果 */
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

    // 回写 DB（持久化执行结果，防重启丢失）
    table().upsert(taskToRow(task));

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
