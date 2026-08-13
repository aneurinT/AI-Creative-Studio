/**
 * 数据库适配器类型定义
 *
 * 定义 DatabaseAdapter 接口，方法签名与原 database.ts 具名导出一一对应，
 * 保证 facade 模式下调用方零改动。JsonAdapter / SqliteAdapter 均实现此接口。
 *
 * 另提供 GenericTable<T> 底层访问器，供 videoTaskProgressService /
 * videoHistoryService 等桥接层访问额外表（video_task_progress / video_history）。
 */
import type fs from 'fs';

// ===== 行类型（迁移自 database.ts）=====

export interface ChatSession {
  id: string;
  title: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  is_active: number;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  action_type: string;
  params: string;
  generated_image: string;
  generated_video: string;
  original_prompt: string;
  is_generating: number;
  progress: number;
  agent_thoughts: string;
  agent_process: string;
  modify_history: string;
  timestamp: number;
}

export interface ShortMemoryRow {
  id: string;
  session_id: string;
  agent_name: string;
  turn_index: number;
  role: string;
  content: string;
  summary: string;
  token_estimate: number;
  created_at: string;
}

export interface LongMemoryRow {
  id: string;
  session_id: string;
  agent_name: string;
  category: string;
  content: string;
  embedding_json: string;
  importance: number;
  access_count: number;
  created_at: string;
  last_accessed: string;
}

export interface VideoTaskRow {
  task_id: string;
  prompt: string;
  style: string;
  duration: string;
  status: string;
  source: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface CheckpointRow {
  id: string;
  session_id: string;
  agent_name: string;
  stage: string;
  state_json: string;
  summary: string;
  status: 'active' | 'completed' | 'failed' | 'expired';
  created_at: string;
  updated_at: string;
}

// ===== 桥接层行类型 =====

/** video_task_progress 表行（供 videoTaskProgressService 桥接） */
export interface TaskProgressRow {
  task_id: string;
  progress: number;
  status: string;
  video_url: string | null;
  error: string | null;
  task_type: string;
  prompt: string | null;
  style: string | null;
  duration: string | null;
  created_at: number;
  updated_at: number;
}

/** video_history 表行（供 videoHistoryService 桥接） */
export interface VideoHistoryRow {
  id: string;
  prompt: string;
  style: string;
  duration: string;
  video_url: string;
  created_at: string;
}

/** scheduled_tasks 表行（供 scheduledPublishService 桥接，持久化定时发布任务）
 *  platforms/content 为复杂对象，序列化为 JSON 字符串存储，避免 db 层依赖 service 层类型 */
export interface ScheduledTaskRow {
  id: string;
  platformsJson: string;
  contentJson: string;
  intervalMinutes: number;
  enabled: number;
  nextRunAt: string;
  createdAt: string;
  userId: string;
  lastRunAt: string | null;
  lastResult: string | null;
  runCount: number;
}

// ===== 操作日志类型 =====

export interface OperationLog {
  timestamp?: string;
  level: string;
  category: string;
  user_id?: string;
  session_id?: string;
  operation: string;
  detail?: string;
  duration_ms?: number;
  result?: string;
  error_text?: string;
  metadata?: string;
}

// ===== Tracing 类型（Agent 调度链路追踪）=====

export interface TraceSpan {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  agentName: string;
  action: string;
  inputJson: string | null;
  outputJson: string | null;
  startTime: number;
  endTime: number | null;
  durationMs: number | null;
  status: string;
  retryCount: number;
  errorMessage: string | null;
  attributes: string | null;
}

export interface Trace {
  traceId: string;
  rootSessionId: string;
  userMessage: string;
  createdAt: string;
  status: string;
  totalDurationMs: number | null;
  spanCount: number | null;
}

// ===== 通用表访问器（供桥接层使用）=====

export interface GenericTable<T extends object> {

  upsert(item: T): void;
  get(id: string): T | undefined;
  filter(fn: (item: T) => boolean): T[];
  query(opts: {
    where?: (item: T) => boolean;
    orderBy?: keyof T;
    desc?: boolean;
    limit?: number;
    offset?: number;
  }): T[];
  delete(id: string): boolean;
  deleteWhere(fn: (item: T) => boolean): number;
  all(): T[];
  flush(): void;
}

// ===== 查询选项 =====

export interface TraceQueryOpts {
  sessionId?: string;
  status?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  desc?: boolean;
}

// ===== DatabaseAdapter 接口（签名与 database.ts 具名导出逐字一致）=====

export interface DatabaseAdapter {
  // 会话
  createSession(id: string, title?: string): ChatSession;
  getSession(id: string): ChatSession | undefined;
  getActiveSessions(userId?: string): ChatSession[];
  updateSessionActivity(id: string): void;
  saveMessage(msg: ChatMessageRow): void;
  getSessionMessages(sessionId: string, limit?: number): ChatMessageRow[];
  deleteSessionMessages(sessionId: string): void;

  // 短期记忆
  addShortMemory(m: Omit<ShortMemoryRow, 'id' | 'created_at'>): string;
  getShortMemories(sessionId: string, agentName?: string): ShortMemoryRow[];
  compressShortMemories(
    sessionId: string,
    agentName: string,
    summary: string,
    keepRecent: number,
  ): void;
  clearSessionShortMemories(sessionId: string): void;

  // 长期记忆
  addLongMemory(m: Omit<LongMemoryRow, 'access_count' | 'last_accessed'>): string;
  getLongMemoriesByAgent(agentName: string, limit?: number): LongMemoryRow[];
  searchLongMemories(query: string, limit?: number): LongMemoryRow[];
  getAllLongMemoriesWithEmbedding(limit?: number): LongMemoryRow[];
  incrementLongMemoryAccess(id: string): void;
  deleteLongMemory(id: string): void;

  // 视频任务
  addVideoTask(t: Omit<VideoTaskRow, 'created_at' | 'updated_at'>): void;
  updateVideoTaskStatus(taskId: string, status: string): void;
  getPendingVideoTasks(): VideoTaskRow[];
  cleanCompletedVideoTasks(): number;

  // 检查点
  saveCheckpoint(cp: Omit<CheckpointRow, 'id' | 'created_at' | 'updated_at'>): string;
  getCheckpoint(id: string): CheckpointRow | undefined;
  getActiveCheckpoints(sessionId: string, agentName?: string): CheckpointRow[];
  getLatestCheckpoint(
    sessionId: string,
    agentName: string,
    stage?: string,
  ): CheckpointRow | undefined;
  updateCheckpointStatus(id: string, status: CheckpointRow['status']): void;
  completeCheckpoint(id: string): void;
  failCheckpoint(id: string): void;
  expireOldCheckpoints(maxAgeHours?: number): number;

  // 操作日志
  addOperationLog(log: OperationLog): void;

  // 生命周期
  flushAll(): void;
  closeDb(): void;

  // 底层表访问器（供桥接层访问 video_task_progress / video_history / scheduled_tasks 等额外表）
  getProgressTable(): GenericTable<TaskProgressRow>;
  getHistoryTable(): GenericTable<VideoHistoryRow>;
  getScheduledTasksTable(): GenericTable<ScheduledTaskRow>;

  // Tracing（Agent 调度链路追踪）
  addTrace(trace: Trace): void;
  updateTrace(traceId: string, updates: Partial<Trace>): void;
  addTraceSpan(span: TraceSpan): void;
  updateTraceSpan(spanId: string, updates: Partial<TraceSpan>): void;
  getTraces(opts: TraceQueryOpts): Trace[];
  getTrace(traceId: string): { trace: Trace; spans: TraceSpan[] } | undefined;
}

// 额外导出 fs 类型供适配器内部使用（避免重复 import）
export type WriteStream = fs.WriteStream;
