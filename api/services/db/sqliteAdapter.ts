/**
 * SqliteAdapter — SQLite 数据库适配器（better-sqlite3）
 *
 * 作为 DB_MODE=sqlite 的后端。同步 API（与 JsonAdapter 语义一致），
 * WAL 模式 + prepared statements 缓存，写入性能与并发安全性显著优于 JSON。
 *
 * better-sqlite3 是原生模块，Electron 打包需 @electron/rebuild 重新编译。
 * 加载失败时由 db/index.ts facade 自动降级到 JsonAdapter。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
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
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 解析 SQLite 文件路径（优先 DB_PATH，其次 Electron userData，最后项目 data 目录） */
function resolveDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (process.env.ELECTRON_USER_DATA) {
    const dir = path.join(process.env.ELECTRON_USER_DATA, 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'app.db');
  }
  const dir = path.join(__dirname, '../../data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'app.db');
}

// ===== 通用 SQLite 表（实现 GenericTable）=====

class SqliteTable<T extends Record<string, any>> implements GenericTable<T> {
  private stmtUpsert: Statement;
  private stmtGet: Statement;
  private stmtDelete: Statement;
  private stmtAll: Statement;

  constructor(
    private db: DatabaseType,
    private tableName: string,
    private pkField: string,
    private columns: string[],
  ) {
    const cols = columns.join(', ');
    const placeholders = columns.map(() => '?').join(', ');
    const updates = columns
      .filter(c => c !== pkField)
      .map(c => `${c} = excluded.${c}`)
      .join(', ');
    const upsertSql = `INSERT INTO ${tableName} (${cols}) VALUES (${placeholders}) ON CONFLICT(${pkField}) DO UPDATE SET ${updates}`;
    this.stmtUpsert = db.prepare(upsertSql);
    this.stmtGet = db.prepare(`SELECT * FROM ${tableName} WHERE ${pkField} = ?`);
    this.stmtDelete = db.prepare(`DELETE FROM ${tableName} WHERE ${pkField} = ?`);
    this.stmtAll = db.prepare(`SELECT * FROM ${tableName}`);
  }

  upsert(item: T): void {
    this.stmtUpsert.run(...this.columns.map(c => (item as any)[c] ?? null));
  }

  get(id: string): T | undefined {
    return this.stmtGet.get(id) as T | undefined;
  }

  filter(fn: (item: T) => boolean): T[] {
    return (this.stmtAll.all() as T[]).filter(fn);
  }

  query(opts: {
    where?: (item: T) => boolean;
    orderBy?: keyof T;
    desc?: boolean;
    limit?: number;
    offset?: number;
  }): T[] {
    let result = this.stmtAll.all() as T[];
    if (opts.where) result = result.filter(opts.where);
    if (opts.orderBy) {
      const key = opts.orderBy as string;
      result.sort((a, b) => {
        const va = a[key],
          vb = b[key];
        return opts.desc ? (va < vb ? 1 : -1) : (va < vb ? -1 : 1);
      });
    }
    if (opts.offset) result = result.slice(opts.offset);
    if (opts.limit) result = result.slice(0, opts.limit);
    return result;
  }

  delete(id: string): boolean {
    const info = this.stmtDelete.run(id);
    return info.changes > 0;
  }

  deleteWhere(fn: (item: T) => boolean): number {
    const all = this.stmtAll.all() as T[];
    const toDelete = all.filter(fn);
    if (toDelete.length === 0) return 0;
    const tx = this.db.transaction((items: T[]) => {
      for (const item of items) {
        this.stmtDelete.run((item as any)[this.pkField]);
      }
    });
    tx(toDelete);
    return toDelete.length;
  }

  all(): T[] {
    return this.stmtAll.all() as T[];
  }

  flush(): void {
    /* SQLite 事务即时持久化，无需 flush */
  }
}

// ===== 列定义（与行类型字段名一一对应，snake_case）=====

const COLS = {
  chat_sessions: ['id', 'title', 'user_id', 'created_at', 'updated_at', 'message_count', 'is_active'],
  chat_messages: [
    'id', 'session_id', 'role', 'content', 'action_type', 'params',
    'generated_image', 'generated_video', 'original_prompt', 'is_generating',
    'progress', 'agent_thoughts', 'agent_process', 'modify_history', 'timestamp',
  ],
  agent_short_memory: [
    'id', 'session_id', 'agent_name', 'turn_index', 'role', 'content',
    'summary', 'token_estimate', 'created_at',
  ],
  agent_long_memory: [
    'id', 'session_id', 'agent_name', 'category', 'content', 'embedding_json',
    'importance', 'access_count', 'created_at', 'last_accessed',
  ],
  video_tasks: ['task_id', 'prompt', 'style', 'duration', 'status', 'source', 'user_id', 'created_at', 'updated_at'],
  checkpoints: ['id', 'session_id', 'agent_name', 'stage', 'state_json', 'summary', 'status', 'created_at', 'updated_at'],
  video_task_progress: ['task_id', 'progress', 'status', 'video_url', 'error', 'task_type', 'prompt', 'style', 'duration', 'created_at', 'updated_at'],
  video_history: ['id', 'prompt', 'style', 'duration', 'video_url', 'created_at'],
  scheduled_tasks: ['id', 'platformsJson', 'contentJson', 'intervalMinutes', 'enabled', 'nextRunAt', 'createdAt', 'userId', 'lastRunAt', 'lastResult', 'runCount'],
  traces: ['traceId', 'rootSessionId', 'userMessage', 'createdAt', 'status', 'totalDurationMs', 'spanCount'],
  trace_spans: ['spanId', 'traceId', 'parentSpanId', 'agentName', 'action', 'inputJson', 'outputJson', 'startTime', 'endTime', 'durationMs', 'status', 'retryCount', 'errorMessage', 'attributes'],
};

// ===== SqliteAdapter 实现 =====

export class SqliteAdapter implements DatabaseAdapter {
  private db: DatabaseType;
  private _sessions: SqliteTable<ChatSession>;
  private _messages: SqliteTable<ChatMessageRow>;
  private _shortMemory: SqliteTable<ShortMemoryRow>;
  private _longMemory: SqliteTable<LongMemoryRow>;
  private _videoTasks: SqliteTable<VideoTaskRow>;
  private _checkpoints: SqliteTable<CheckpointRow>;
  private _progress: SqliteTable<TaskProgressRow>;
  private _history: SqliteTable<VideoHistoryRow>;
  private _scheduledTasks: SqliteTable<ScheduledTaskRow>;
  private _traces: SqliteTable<Trace>;
  private _traceSpans: SqliteTable<TraceSpan>;
  private _stmtInsertLog: Statement;

  constructor() {
    const dbPath = resolveDbPath();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.initSchema();
    console.log(`[DB] SQLite 已就绪: ${dbPath}`);

    this._sessions = new SqliteTable(this.db, 'chat_sessions', 'id', COLS.chat_sessions);
    this._messages = new SqliteTable(this.db, 'chat_messages', 'id', COLS.chat_messages);
    this._shortMemory = new SqliteTable(this.db, 'agent_short_memory', 'id', COLS.agent_short_memory);
    this._longMemory = new SqliteTable(this.db, 'agent_long_memory', 'id', COLS.agent_long_memory);
    this._videoTasks = new SqliteTable(this.db, 'video_tasks', 'task_id', COLS.video_tasks);
    this._checkpoints = new SqliteTable(this.db, 'checkpoints', 'id', COLS.checkpoints);
    this._progress = new SqliteTable(this.db, 'video_task_progress', 'task_id', COLS.video_task_progress);
    this._history = new SqliteTable(this.db, 'video_history', 'id', COLS.video_history);
    this._scheduledTasks = new SqliteTable(this.db, 'scheduled_tasks', 'id', COLS.scheduled_tasks);
    this._traces = new SqliteTable(this.db, 'traces', 'traceId', COLS.traces);
    this._traceSpans = new SqliteTable(this.db, 'trace_spans', 'spanId', COLS.trace_spans);

    this._stmtInsertLog = this.db.prepare(
      `INSERT INTO operation_logs (timestamp, level, category, user_id, session_id, operation, detail, duration_ms, result, error_text, metadata)
       VALUES (@timestamp, @level, @category, @user_id, @session_id, @operation, @detail, @duration_ms, @result, @error_text, @metadata)`,
    );
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY, title TEXT, user_id TEXT, created_at TEXT, updated_at TEXT,
        message_count INTEGER, is_active INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON chat_sessions(user_id, is_active, updated_at);

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, action_type TEXT,
        params TEXT, generated_image TEXT, generated_video TEXT, original_prompt TEXT,
        is_generating INTEGER, progress INTEGER, agent_thoughts TEXT, agent_process TEXT,
        modify_history TEXT, timestamp INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, timestamp);

      CREATE TABLE IF NOT EXISTS agent_short_memory (
        id TEXT PRIMARY KEY, session_id TEXT, agent_name TEXT, turn_index INTEGER,
        role TEXT, content TEXT, summary TEXT, token_estimate INTEGER, created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_short_session_agent ON agent_short_memory(session_id, agent_name, turn_index);

      CREATE TABLE IF NOT EXISTS agent_long_memory (
        id TEXT PRIMARY KEY, session_id TEXT, agent_name TEXT, category TEXT, content TEXT,
        embedding_json TEXT, importance REAL, access_count INTEGER, created_at TEXT, last_accessed TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_long_agent ON agent_long_memory(agent_name, importance DESC);
      CREATE INDEX IF NOT EXISTS idx_long_embedding ON agent_long_memory(embedding_json) WHERE embedding_json != '';

      CREATE TABLE IF NOT EXISTS video_tasks (
        task_id TEXT PRIMARY KEY, prompt TEXT, style TEXT, duration TEXT, status TEXT,
        source TEXT, user_id TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_video_status ON video_tasks(status, created_at);

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY, session_id TEXT, agent_name TEXT, stage TEXT, state_json TEXT,
        summary TEXT, status TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cp_session_status ON checkpoints(session_id, status, created_at);

      CREATE TABLE IF NOT EXISTS operation_logs (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, level TEXT, category TEXT,
        user_id TEXT, session_id TEXT, operation TEXT, detail TEXT, duration_ms INTEGER,
        result TEXT, error_text TEXT, metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_logs_time ON operation_logs(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_logs_category_session ON operation_logs(category, session_id);

      CREATE TABLE IF NOT EXISTS video_task_progress (
        task_id TEXT PRIMARY KEY, progress INTEGER, status TEXT, video_url TEXT, error TEXT,
        task_type TEXT, prompt TEXT, style TEXT, duration TEXT, created_at INTEGER, updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS video_history (
        id TEXT PRIMARY KEY, prompt TEXT, style TEXT, duration TEXT, video_url TEXT, created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_history_created ON video_history(created_at DESC);

      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY, platformsJson TEXT, contentJson TEXT, intervalMinutes INTEGER,
        enabled INTEGER, nextRunAt TEXT, createdAt TEXT, userId TEXT,
        lastRunAt TEXT, lastResult TEXT, runCount INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_enabled_nextrun ON scheduled_tasks(enabled, nextRunAt);

      CREATE TABLE IF NOT EXISTS traces (
        traceId TEXT PRIMARY KEY, rootSessionId TEXT, userMessage TEXT, createdAt TEXT,
        status TEXT, totalDurationMs INTEGER, spanCount INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_traces_session ON traces(rootSessionId, createdAt DESC);

      CREATE TABLE IF NOT EXISTS trace_spans (
        spanId TEXT PRIMARY KEY, traceId TEXT, parentSpanId TEXT, agentName TEXT, action TEXT,
        inputJson TEXT, outputJson TEXT, startTime INTEGER, endTime INTEGER, durationMs INTEGER,
        status TEXT, retryCount INTEGER, errorMessage TEXT, attributes TEXT,
        FOREIGN KEY (traceId) REFERENCES traces(traceId) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_spans_trace ON trace_spans(traceId, startTime);
    `);
  }

  // ===== 会话 =====
  createSession(id: string, title = ''): ChatSession {
    const now = new Date().toISOString();
    const s: ChatSession = {
      id, title, user_id: 'anonymous', created_at: now, updated_at: now,
      message_count: 0, is_active: 1,
    };
    this._sessions.upsert(s);
    return s;
  }
  getSession(id: string) { return this._sessions.get(id); }
  getActiveSessions(userId = 'anonymous') {
    return this._sessions.query({
      where: s => s.user_id === userId && s.is_active === 1,
      orderBy: 'updated_at', desc: true, limit: 50,
    });
  }
  updateSessionActivity(id: string): void {
    const s = this._sessions.get(id);
    if (s) { s.message_count++; s.updated_at = new Date().toISOString(); this._sessions.upsert(s); }
  }
  saveMessage(msg: ChatMessageRow): void {
    this._messages.upsert(msg);
    this.updateSessionActivity(msg.session_id);
  }
  getSessionMessages(sessionId: string, limit = 50) {
    return this._messages.query({
      where: m => m.session_id === sessionId, orderBy: 'timestamp', desc: false, limit,
    });
  }
  deleteSessionMessages(sessionId: string): void {
    this._messages.deleteWhere(m => m.session_id === sessionId);
  }

  // ===== 短期记忆 =====
  addShortMemory(m: Omit<ShortMemoryRow, 'id' | 'created_at'>): string {
    const id = `${m.session_id}_${m.agent_name}_${m.turn_index}`;
    this._shortMemory.upsert({ ...m, id, created_at: new Date().toISOString() });
    return id;
  }
  getShortMemories(sessionId: string, agentName?: string) {
    return this._shortMemory.query({
      where: m => m.session_id === sessionId && (!agentName || m.agent_name === agentName),
      orderBy: 'turn_index', desc: false,
    });
  }
  compressShortMemories(sessionId: string, agentName: string, summary: string, keepRecent: number): void {
    const all = this._shortMemory.query({
      where: m => m.session_id === sessionId && m.agent_name === agentName,
      orderBy: 'turn_index', desc: true,
    });
    if (all.length <= keepRecent) return;
    const toCompress = all.slice(keepRecent);
    toCompress.forEach(m => this._shortMemory.delete(m.id));
    const id = `${sessionId}_${agentName}_summary_${Date.now()}`;
    this._shortMemory.upsert({
      id, session_id: sessionId, agent_name: agentName, turn_index: -1, role: 'system',
      content: `[摘要] ${summary}`, summary, token_estimate: Math.ceil(summary.length / 2),
      created_at: new Date().toISOString(),
    });
  }
  clearSessionShortMemories(sessionId: string): void {
    this._shortMemory.deleteWhere(m => m.session_id === sessionId);
  }

  // ===== 长期记忆 =====
  addLongMemory(m: Omit<LongMemoryRow, 'access_count' | 'last_accessed'>): string {
    const id = m.id || `lm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this._longMemory.upsert({ ...m, id, access_count: 0, last_accessed: new Date().toISOString() });
    return id;
  }
  getLongMemoriesByAgent(agentName: string, limit = 50) {
    return this._longMemory.query({
      where: m => m.agent_name === agentName, orderBy: 'importance', desc: true, limit,
    });
  }
  searchLongMemories(query: string, limit = 20) {
    const like = `%${query.toLowerCase()}%`;
    // 用 SQL LIKE 优化（语义等价于 toLowerCase().includes()）
    const rows = this.db.prepare(
      `SELECT * FROM agent_long_memory WHERE LOWER(content) LIKE ? ORDER BY importance DESC LIMIT ?`,
    ).all(like, limit) as LongMemoryRow[];
    return rows;
  }
  getAllLongMemoriesWithEmbedding(limit = 200) {
    return this._longMemory.query({
      where: m => m.embedding_json !== '' && m.embedding_json != null,
      orderBy: 'importance', desc: true, limit,
    });
  }
  incrementLongMemoryAccess(id: string): void {
    const m = this._longMemory.get(id);
    if (m) { m.access_count++; m.last_accessed = new Date().toISOString(); this._longMemory.upsert(m); }
  }
  deleteLongMemory(id: string): void { this._longMemory.delete(id); }

  // ===== 视频任务 =====
  addVideoTask(t: Omit<VideoTaskRow, 'created_at' | 'updated_at'>): void {
    const now = new Date().toISOString();
    this._videoTasks.upsert({ ...t, created_at: now, updated_at: now });
  }
  updateVideoTaskStatus(taskId: string, status: string): void {
    const t = this._videoTasks.get(taskId);
    if (t) { t.status = status; t.updated_at = new Date().toISOString(); this._videoTasks.upsert(t); }
  }
  getPendingVideoTasks() {
    return this._videoTasks.query({ where: t => t.status === 'pending', orderBy: 'created_at', desc: true });
  }
  cleanCompletedVideoTasks() {
    return this._videoTasks.deleteWhere(t => ['completed', 'failed', 'cancelled'].includes(t.status));
  }

  // ===== 检查点 =====
  saveCheckpoint(cp: Omit<CheckpointRow, 'id' | 'created_at' | 'updated_at'>): string {
    const id = `cp_${cp.session_id}_${cp.agent_name}_${cp.stage}_${Date.now()}`;
    const now = new Date().toISOString();
    this._checkpoints.upsert({ ...cp, id, created_at: now, updated_at: now });
    return id;
  }
  getCheckpoint(id: string) { return this._checkpoints.get(id); }
  getActiveCheckpoints(sessionId: string, agentName?: string) {
    return this._checkpoints.query({
      where: c => c.session_id === sessionId && c.status === 'active' && (!agentName || c.agent_name === agentName),
      orderBy: 'created_at', desc: true,
    });
  }
  getLatestCheckpoint(sessionId: string, agentName: string, stage?: string) {
    const all = this._checkpoints.query({
      where: c => c.session_id === sessionId && c.agent_name === agentName && c.status === 'active' && (!stage || c.stage === stage),
      orderBy: 'created_at', desc: true, limit: 1,
    });
    return all[0];
  }
  updateCheckpointStatus(id: string, status: CheckpointRow['status']): void {
    const cp = this._checkpoints.get(id);
    if (cp) { cp.status = status; cp.updated_at = new Date().toISOString(); this._checkpoints.upsert(cp); }
  }
  completeCheckpoint(id: string): void { this.updateCheckpointStatus(id, 'completed'); }
  failCheckpoint(id: string): void { this.updateCheckpointStatus(id, 'failed'); }
  expireOldCheckpoints(maxAgeHours = 24): number {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
    return this._checkpoints.deleteWhere(c => c.status === 'active' && c.created_at < cutoff);
  }

  // ===== 操作日志 =====
  addOperationLog(log: OperationLog): void {
    this._stmtInsertLog.run({
      timestamp: log.timestamp || new Date().toISOString(),
      level: log.level,
      category: log.category,
      user_id: log.user_id || 'anonymous',
      session_id: log.session_id || '',
      operation: log.operation,
      detail: log.detail || '',
      duration_ms: log.duration_ms || 0,
      result: log.result || 'success',
      error_text: log.error_text || '',
      metadata: log.metadata || '{}',
    });
  }

  // ===== 生命周期 =====
  flushAll(): void { /* SQLite 事务即时持久化，no-op */ }
  closeDb(): void {
    try { this.db.close(); console.log('[DB] SQLite 连接已关闭'); } catch { /* ignore */ }
  }

  // ===== 桥接层表访问器 =====
  getProgressTable(): GenericTable<TaskProgressRow> { return this._progress; }
  getHistoryTable(): GenericTable<VideoHistoryRow> { return this._history; }
  getScheduledTasksTable(): GenericTable<ScheduledTaskRow> { return this._scheduledTasks; }

  // ===== Tracing =====
  addTrace(trace: Trace): void {
    this._traces.upsert(trace);
  }
  updateTrace(traceId: string, updates: Partial<Trace>): void {
    const t = this._traces.get(traceId);
    if (t) {
      Object.assign(t, updates);
      this._traces.upsert(t);
    }
  }
  addTraceSpan(span: TraceSpan): void {
    this._traceSpans.upsert(span);
  }
  updateTraceSpan(spanId: string, updates: Partial<TraceSpan>): void {
    const s = this._traceSpans.get(spanId);
    if (s) {
      Object.assign(s, updates);
      this._traceSpans.upsert(s);
    }
  }
  getTraces(opts: TraceQueryOpts): Trace[] {
    return this._traces.query({
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
    const trace = this._traces.get(traceId);
    if (!trace) return undefined;
    const spans = this._traceSpans.query({
      where: s => s.traceId === traceId,
      orderBy: 'startTime',
      desc: false,
    });
    return { trace, spans };
  }

  /** 暴露底层 db 供迁移脚本使用 */
  getRawDb(): DatabaseType { return this.db; }
}
