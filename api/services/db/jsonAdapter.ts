/**
 * JsonAdapter — JSON 文件数据库适配器
 *
 * 原样搬迁自 database.ts 的 JsonTable 引擎，实现 DatabaseAdapter 接口。
 * 作为 DB_MODE=json（默认）的后端，保证与历史行为完全一致。
 *
 * 特性：
 * - WAL 风格写入（tmp → rename），防写坏
 * - 内存索引加速查询
 * - 自动按日轮转操作日志
 * - 自动延迟保存（2秒合并写）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  DatabaseAdapter,
  GenericTable,
  ChatSession,
  ChatMessageRow,
  ShortMemoryRow,
  LongMemoryRow,
  VideoTaskRow,
  CheckpointRow,
  TaskProgressRow,
  VideoHistoryRow,
  ScheduledTaskRow,
  OperationLog,
  Trace,
  TraceSpan,
  TraceQueryOpts,
  WriteStream,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');

// ===== 通用表引擎（搬迁自 database.ts）=====

export class JsonTable<T extends object> implements GenericTable<T> {
  private filePath: string;
  private data: T[] = [];
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private indexMap = new Map<string, number>();
  // 主键字段名（默认 id，桥接表用 task_id）
  private pkField: keyof T;

  constructor(filename: string, pkField: keyof T = 'id' as keyof T) {
    this.filePath = path.join(DATA_DIR, filename);
    this.pkField = pkField;
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        this.rebuildIndex();
      }
    } catch {
      this.data = [];
    }
  }

  private rebuildIndex(): void {
    this.indexMap.clear();
    this.data.forEach((item, i) => {
      const pk = item[this.pkField] as unknown as string | undefined;
      if (pk) this.indexMap.set(pk, i);
    });
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 2000);
  }

  saveNow(): void {
    if (!this.dirty) return;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath);
      this.dirty = false;
    } catch (e) {
      console.error(`[DB] Save failed: ${this.filePath}`, (e as Error).message);
    }
  }

  upsert(item: T): void {
    const pk = item[this.pkField] as unknown as string | undefined;
    if (pk && this.indexMap.has(pk)) {
      this.data[this.indexMap.get(pk)!] = item;
    } else {
      this.data.push(item);
      if (pk) this.indexMap.set(pk, this.data.length - 1);
    }
    this.scheduleSave();
  }

  get(id: string): T | undefined {
    const idx = this.indexMap.get(id);
    return idx !== undefined ? this.data[idx] : undefined;
  }

  filter(fn: (item: T) => boolean): T[] {
    return this.data.filter(fn);
  }

  query(opts: {
    where?: (item: T) => boolean;
    orderBy?: keyof T;
    desc?: boolean;
    limit?: number;
    offset?: number;
  }): T[] {
    let result = opts.where ? this.data.filter(opts.where) : [...this.data];
    if (opts.orderBy) {
      result.sort((a, b) => {
        const va = a[opts.orderBy!],
          vb = b[opts.orderBy!];
        return opts.desc ? (va < vb ? 1 : -1) : (va < vb ? -1 : 1);
      });
    }
    if (opts.offset) result = result.slice(opts.offset);
    if (opts.limit) result = result.slice(0, opts.limit);
    return result;
  }

  delete(id: string): boolean {
    const idx = this.indexMap.get(id);
    if (idx === undefined) return false;
    this.data.splice(idx, 1);
    this.rebuildIndex();
    this.scheduleSave();
    return true;
  }

  deleteWhere(fn: (item: T) => boolean): number {
    const before = this.data.length;
    this.data = this.data.filter(item => !fn(item));
    this.rebuildIndex();
    this.scheduleSave();
    return before - this.data.length;
  }

  all(): T[] {
    return this.data;
  }

  flush(): void {
    this.saveNow();
  }
}

// ===== 表懒加载单例 =====

let _sessions: JsonTable<ChatSession> | null = null;
let _messages: JsonTable<ChatMessageRow> | null = null;
let _shortMemory: JsonTable<ShortMemoryRow> | null = null;
let _longMemory: JsonTable<LongMemoryRow> | null = null;
let _videoTasks: JsonTable<VideoTaskRow> | null = null;
let _checkpoints: JsonTable<CheckpointRow> | null = null;
let _progress: JsonTable<TaskProgressRow> | null = null;
let _history: JsonTable<VideoHistoryRow> | null = null;

const sessions = () => {
  if (!_sessions) _sessions = new JsonTable<ChatSession>('chat_sessions.json');
  return _sessions;
};
const messages = () => {
  if (!_messages) _messages = new JsonTable<ChatMessageRow>('chat_messages.json');
  return _messages;
};
const shortMemory = () => {
  if (!_shortMemory) _shortMemory = new JsonTable<ShortMemoryRow>('agent_short_memory.json');
  return _shortMemory;
};
const longMemory = () => {
  if (!_longMemory) _longMemory = new JsonTable<LongMemoryRow>('agent_long_memory.json');
  return _longMemory;
};
const videoTasks = () => {
  if (!_videoTasks) {
    _videoTasks = new JsonTable<VideoTaskRow>('video_tasks.json');
    migrateOldVideoTasks();
  }
  return _videoTasks;
};
const checkpoints = () => {
  if (!_checkpoints) _checkpoints = new JsonTable<CheckpointRow>('checkpoints.json');
  return _checkpoints;
};
const progressTable = () => {
  if (!_progress) _progress = new JsonTable<TaskProgressRow>('video_task_progress.json', 'task_id');
  return _progress;
};
const historyTable = () => {
  if (!_history) _history = new JsonTable<VideoHistoryRow>('video_history.json');
  return _history;
};
let _scheduledTasks: JsonTable<ScheduledTaskRow> | null = null;
const scheduledTasksTable = () => {
  if (!_scheduledTasks) _scheduledTasks = new JsonTable<ScheduledTaskRow>('scheduled_tasks.json');
  return _scheduledTasks;
};
let _traces: JsonTable<Trace> | null = null;
let _traceSpans: JsonTable<TraceSpan> | null = null;
const traces = () => {
  if (!_traces) _traces = new JsonTable<Trace>('traces.json', 'traceId' as keyof Trace);
  return _traces;
};
const traceSpans = () => {
  if (!_traceSpans) _traceSpans = new JsonTable<TraceSpan>('trace_spans.json', 'spanId' as keyof TraceSpan);
  return _traceSpans;
};

function migrateOldVideoTasks(): void {
  const oldPath = path.join(DATA_DIR, 'videoTasks.json');
  if (!fs.existsSync(oldPath)) return;
  try {
    const raw = fs.readFileSync(oldPath, 'utf-8');
    const old = JSON.parse(raw);
    if (Array.isArray(old) && _videoTasks) {
      let n = 0;
      old.forEach((t: any) => {
        if (!_videoTasks!.get(t.taskId)) {
          _videoTasks!.upsert({
            task_id: t.taskId,
            prompt: t.prompt || '',
            style: t.style || 'realistic',
            duration: t.duration || '10',
            status: t.status || 'pending',
            source: t.source || 'video-generator',
            user_id: 'anonymous',
            created_at: t.createdAt || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          n++;
        }
      });
      if (n > 0) {
        console.log(`[DB] 迁移 ${n} 条旧视频任务`);
        _videoTasks.saveNow();
      }
    }
    fs.renameSync(oldPath, oldPath + '.bak');
  } catch {
    /* skip */
  }
}

// ===== 操作日志（追加模式，按日分文件）=====

let _logStream: { stream: WriteStream; date: string } | null = null;
function getLogStream(): fs.WriteStream {
  const today = new Date().toISOString().slice(0, 10);
  if (_logStream && _logStream.date === today) return _logStream.stream;
  if (_logStream) _logStream.stream.end();
  const logPath = path.join(DATA_DIR, 'logs', `operations-${today}.log`);
  const logDir = path.dirname(logPath);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  _logStream = { stream: fs.createWriteStream(logPath, { flags: 'a' }), date: today };
  return _logStream.stream;
}

// ===== JsonAdapter 实现 =====

export class JsonAdapter implements DatabaseAdapter {
  createSession(id: string, title = ''): ChatSession {
    const now = new Date().toISOString();
    const s: ChatSession = {
      id,
      title,
      user_id: 'anonymous',
      created_at: now,
      updated_at: now,
      message_count: 0,
      is_active: 1,
    };
    sessions().upsert(s);
    return s;
  }
  getSession(id: string) {
    return sessions().get(id);
  }
  getActiveSessions(userId = 'anonymous') {
    return sessions().query({
      where: s => s.user_id === userId && s.is_active === 1,
      orderBy: 'updated_at',
      desc: true,
      limit: 50,
    });
  }
  updateSessionActivity(id: string): void {
    const s = sessions().get(id);
    if (s) {
      s.message_count++;
      s.updated_at = new Date().toISOString();
      sessions().upsert(s);
    }
  }
  saveMessage(msg: ChatMessageRow): void {
    messages().upsert(msg);
    this.updateSessionActivity(msg.session_id);
  }
  getSessionMessages(sessionId: string, limit = 50) {
    return messages().query({
      where: m => m.session_id === sessionId,
      orderBy: 'timestamp',
      desc: false,
      limit,
    });
  }
  deleteSessionMessages(sessionId: string): void {
    messages().deleteWhere(m => m.session_id === sessionId);
  }

  // 短期记忆
  addShortMemory(m: Omit<ShortMemoryRow, 'id' | 'created_at'>): string {
    const id = `${m.session_id}_${m.agent_name}_${m.turn_index}`;
    shortMemory().upsert({ ...m, id, created_at: new Date().toISOString() });
    return id;
  }
  getShortMemories(sessionId: string, agentName?: string) {
    return shortMemory().query({
      where: m => m.session_id === sessionId && (!agentName || m.agent_name === agentName),
      orderBy: 'turn_index',
      desc: false,
    });
  }
  compressShortMemories(
    sessionId: string,
    agentName: string,
    summary: string,
    keepRecent: number,
  ): void {
    const all = shortMemory().query({
      where: m => m.session_id === sessionId && m.agent_name === agentName,
      orderBy: 'turn_index',
      desc: true,
    });
    if (all.length <= keepRecent) return;
    const toCompress = all.slice(keepRecent);
    toCompress.forEach(m => shortMemory().delete(m.id));
    const id = `${sessionId}_${agentName}_summary_${Date.now()}`;
    shortMemory().upsert({
      id,
      session_id: sessionId,
      agent_name: agentName,
      turn_index: -1,
      role: 'system',
      content: `[摘要] ${summary}`,
      summary,
      token_estimate: Math.ceil(summary.length / 2),
      created_at: new Date().toISOString(),
    });
  }
  clearSessionShortMemories(sessionId: string): void {
    shortMemory().deleteWhere(m => m.session_id === sessionId);
  }

  // 长期记忆
  addLongMemory(m: Omit<LongMemoryRow, 'access_count' | 'last_accessed'>): string {
    const id = m.id || `lm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    longMemory().upsert({ ...m, id, access_count: 0, last_accessed: new Date().toISOString() });
    return id;
  }
  getLongMemoriesByAgent(agentName: string, limit = 50) {
    return longMemory().query({
      where: m => m.agent_name === agentName,
      orderBy: 'importance',
      desc: true,
      limit,
    });
  }
  searchLongMemories(query: string, limit = 20) {
    const lower = query.toLowerCase();
    return longMemory().query({
      where: m => m.content.toLowerCase().includes(lower),
      orderBy: 'importance',
      desc: true,
      limit,
    });
  }
  getAllLongMemoriesWithEmbedding(limit = 200) {
    return longMemory().query({
      where: m => m.embedding_json !== '' && m.embedding_json != null,
      orderBy: 'importance',
      desc: true,
      limit,
    });
  }
  incrementLongMemoryAccess(id: string): void {
    const m = longMemory().get(id);
    if (m) {
      m.access_count++;
      m.last_accessed = new Date().toISOString();
      longMemory().upsert(m);
    }
  }
  deleteLongMemory(id: string): void {
    longMemory().delete(id);
  }

  // 视频任务
  addVideoTask(t: Omit<VideoTaskRow, 'created_at' | 'updated_at'>): void {
    const now = new Date().toISOString();
    videoTasks().upsert({ ...t, created_at: now, updated_at: now });
  }
  updateVideoTaskStatus(taskId: string, status: string): void {
    const t = videoTasks().get(taskId);
    if (t) {
      t.status = status;
      t.updated_at = new Date().toISOString();
      videoTasks().upsert(t);
    }
  }
  getPendingVideoTasks() {
    return videoTasks().query({
      where: t => t.status === 'pending',
      orderBy: 'created_at',
      desc: true,
    });
  }
  cleanCompletedVideoTasks() {
    return videoTasks().deleteWhere(t =>
      ['completed', 'failed', 'cancelled'].includes(t.status),
    );
  }

  // 检查点
  saveCheckpoint(cp: Omit<CheckpointRow, 'id' | 'created_at' | 'updated_at'>): string {
    const id = `cp_${cp.session_id}_${cp.agent_name}_${cp.stage}_${Date.now()}`;
    const now = new Date().toISOString();
    checkpoints().upsert({ ...cp, id, created_at: now, updated_at: now });
    return id;
  }
  getCheckpoint(id: string) {
    return checkpoints().get(id);
  }
  getActiveCheckpoints(sessionId: string, agentName?: string) {
    return checkpoints().query({
      where: c =>
        c.session_id === sessionId &&
        c.status === 'active' &&
        (!agentName || c.agent_name === agentName),
      orderBy: 'created_at',
      desc: true,
    });
  }
  getLatestCheckpoint(sessionId: string, agentName: string, stage?: string) {
    const all = checkpoints().query({
      where: c =>
        c.session_id === sessionId &&
        c.agent_name === agentName &&
        c.status === 'active' &&
        (!stage || c.stage === stage),
      orderBy: 'created_at',
      desc: true,
      limit: 1,
    });
    return all[0];
  }
  updateCheckpointStatus(id: string, status: CheckpointRow['status']): void {
    const cp = checkpoints().get(id);
    if (cp) {
      cp.status = status;
      cp.updated_at = new Date().toISOString();
      checkpoints().upsert(cp);
    }
  }
  completeCheckpoint(id: string): void {
    this.updateCheckpointStatus(id, 'completed');
  }
  failCheckpoint(id: string): void {
    this.updateCheckpointStatus(id, 'failed');
  }
  expireOldCheckpoints(maxAgeHours = 24): number {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
    return checkpoints().deleteWhere(c => c.status === 'active' && c.created_at < cutoff);
  }

  // 操作日志
  addOperationLog(log: OperationLog): void {
    const line =
      JSON.stringify({
        ...log,
        timestamp: log.timestamp || new Date().toISOString(),
        user_id: log.user_id || 'anonymous',
        session_id: log.session_id || '',
        detail: log.detail || '',
        duration_ms: log.duration_ms || 0,
        result: log.result || 'success',
        error_text: log.error_text || '',
        metadata: log.metadata || '{}',
      }) + '\n';
    try {
      getLogStream().write(line);
    } catch {
      /* silent */
    }
  }

  // 生命周期
  flushAll(): void {
    sessions().flush();
    messages().flush();
    shortMemory().flush();
    longMemory().flush();
    videoTasks().flush();
    checkpoints().flush();
    progressTable().flush();
    historyTable().flush();
    scheduledTasksTable().flush();
    traces().flush();
    traceSpans().flush();
    if (_logStream) {
      _logStream.stream.end();
      _logStream = null;
    }
  }
  closeDb(): void {
    this.flushAll();
    console.log('[DB] 所有表已保存并关闭');
  }

  // 桥接层表访问器
  getProgressTable(): GenericTable<TaskProgressRow> {
    return progressTable();
  }
  getHistoryTable(): GenericTable<VideoHistoryRow> {
    return historyTable();
  }
  getScheduledTasksTable(): GenericTable<ScheduledTaskRow> {
    return scheduledTasksTable();
  }

  // ===== Tracing =====
  addTrace(trace: Trace): void {
    traces().upsert(trace);
  }
  updateTrace(traceId: string, updates: Partial<Trace>): void {
    const t = traces().get(traceId);
    if (t) {
      Object.assign(t, updates);
      traces().upsert(t);
    }
  }
  addTraceSpan(span: TraceSpan): void {
    traceSpans().upsert(span);
  }
  updateTraceSpan(spanId: string, updates: Partial<TraceSpan>): void {
    const s = traceSpans().get(spanId);
    if (s) {
      Object.assign(s, updates);
      traceSpans().upsert(s);
    }
  }
  getTraces(opts: TraceQueryOpts): Trace[] {
    return traces().query({
      where: t =>
        (!opts.sessionId || t.rootSessionId === opts.sessionId) &&
        (!opts.status || t.status === opts.status),
      orderBy: (opts.orderBy as keyof Trace) || 'createdAt',
      desc: opts.desc !== false,
      limit: opts.limit || 50,
      offset: opts.offset,
    });
  }
  getTrace(traceId: string): { trace: Trace; spans: TraceSpan[] } | undefined {
    const trace = traces().get(traceId);
    if (!trace) return undefined;
    const spans = traceSpans().query({
      where: s => s.traceId === traceId,
      orderBy: 'startTime',
      desc: false,
    });
    return { trace, spans };
  }
}
