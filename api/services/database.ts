/**
 * 轻量级 JSON 数据库（纯 Node.js，零依赖）
 *
 * 特性：
 * - 按表分文件存储，支持索引
 * - WAL 风格写入（先写 tmp 再 rename，防写坏）
 * - 自动按日期轮转操作日志
 * - 会话级短期记忆 + 跨会话长期记忆
 * - 兼容旧 videoTasks.json 数据
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

// ===== 类型定义 =====

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

// ===== 通用 JSON 表引擎 =====

class JsonTable<T extends { id?: string }> {
  private filePath: string;
  private data: T[] = [];
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private indexMap = new Map<string, number>(); // id -> array index

  constructor(filename: string) {
    this.filePath = path.join(DATA_DIR, filename);
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw);
        this.rebuildIndex();
      }
    } catch {
      this.data = [];
    }
  }

  private rebuildIndex(): void {
    this.indexMap.clear();
    this.data.forEach((item, i) => {
      if (item.id) this.indexMap.set(item.id, i);
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
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
      this.dirty = false;
    } catch (err) {
      console.error(`[JsonTable] Save failed: ${this.filePath}`, (err as Error).message);
    }
  }

  /** 插入或更新 */
  upsert(item: T): void {
    if (item.id && this.indexMap.has(item.id)) {
      this.data[this.indexMap.get(item.id)!] = item;
    } else {
      this.data.push(item);
      if (item.id) this.indexMap.set(item.id, this.data.length - 1);
    }
    this.scheduleSave();
  }

  /** 按 id 查找 */
  get(id: string): T | undefined {
    const idx = this.indexMap.get(id);
    return idx !== undefined ? this.data[idx] : undefined;
  }

  /** 按条件过滤 */
  filter(fn: (item: T) => boolean): T[] {
    return this.data.filter(fn);
  }

  /** 分页查询 */
  query(options: { where?: (item: T) => boolean; orderBy?: keyof T; desc?: boolean; limit?: number; offset?: number }): T[] {
    let result = options.where ? this.data.filter(options.where) : [...this.data];
    if (options.orderBy) {
      result.sort((a, b) => {
        const va = a[options.orderBy!], vb = b[options.orderBy!];
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return options.desc ? -cmp : cmp;
      });
    }
    if (options.offset) result = result.slice(options.offset);
    if (options.limit) result = result.slice(0, options.limit);
    return result;
  }

  /** 计数 */
  count(fn?: (item: T) => boolean): number {
    return fn ? this.data.filter(fn).length : this.data.length;
  }

  /** 按 id 删除 */
  delete(id: string): boolean {
    const idx = this.indexMap.get(id);
    if (idx === undefined) return false;
    this.data.splice(idx, 1);
    this.rebuildIndex();
    this.scheduleSave();
    return true;
  }

  /** 批量删除 */
  deleteWhere(fn: (item: T) => boolean): number {
    const before = this.data.length;
    this.data = this.data.filter(item => !fn(item));
    this.rebuildIndex();
    this.scheduleSave();
    return before - this.data.length;
  }

  /** 全部数据 */
  all(): T[] { return this.data; }

  /** 立即写入磁盘 */
  flush(): void { this.saveNow(); }
}

// ===== 全局表实例 =====

let _sessions: JsonTable<ChatSession> | null = null;
let _messages: JsonTable<ChatMessageRow> | null = null;
let _shortMemory: JsonTable<ShortMemoryRow> | null = null;
let _longMemory: JsonTable<LongMemoryRow> | null = null;
let _videoTasks: JsonTable<VideoTaskRow> | null = null;

function sessions(): JsonTable<ChatSession> {
  if (!_sessions) _sessions = new JsonTable<ChatSession>('chat_sessions.json');
  return _sessions;
}
function messages(): JsonTable<ChatMessageRow> {
  if (!_messages) _messages = new JsonTable<ChatMessageRow>('chat_messages.json');
  return _messages;
}
function shortMemory(): JsonTable<ShortMemoryRow> {
  if (!_shortMemory) _shortMemory = new JsonTable<ShortMemoryRow>('agent_short_memory.json');
  return _shortMemory;
}
function longMemory(): JsonTable<LongMemoryRow> {
  if (!_longMemory) _longMemory = new JsonTable<LongMemoryRow>('agent_long_memory.json');
  return _longMemory;
}
function videoTasks(): JsonTable<VideoTaskRow> {
  if (!_videoTasks) {
    _videoTasks = new JsonTable<VideoTaskRow>('video_tasks.json');
    // 兼容旧数据迁移
    migrateOldVideoTasks();
  }
  return _videoTasks;
}

/** 兼容旧 videoTasks.json 格式 */
function migrateOldVideoTasks(): void {
  const oldPath = path.join(DATA_DIR, 'videoTasks.json');
  if (!fs.existsSync(oldPath)) return;
  try {
    const raw = fs.readFileSync(oldPath, 'utf-8');
    const oldTasks = JSON.parse(raw);
    if (Array.isArray(oldTasks) && oldTasks.length > 0 && _videoTasks) {
      let migrated = 0;
      oldTasks.forEach((t: any) => {
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
          migrated++;
        }
      });
      if (migrated > 0) {
        console.log(`[Database] 迁移 ${migrated} 条旧视频任务`);
        _videoTasks.saveNow();
      }
    }
    // 重命名旧文件
    fs.renameSync(oldPath, oldPath + '.bak');
  } catch (err) {
    console.warn('[Database] 旧数据迁移失败:', (err as Error).message);
  }
}

// ===== 聊天会话 =====

export function createSession(id: string, title: string = ''): ChatSession {
  const now = new Date().toISOString();
  const session: ChatSession = { id, title, user_id: 'anonymous', created_at: now, updated_at: now, message_count: 0, is_active: 1 };
  sessions().upsert(session);
  return session;
}

export function getSession(id: string): ChatSession | undefined {
  return sessions().get(id);
}

export function getActiveSessions(userId: string = 'anonymous'): ChatSession[] {
  return sessions().query({
    where: s => s.user_id === userId && s.is_active === 1,
    orderBy: 'updated_at',
    desc: true,
    limit: 50,
  });
}

export function updateSessionTitle(id: string, title: string): void {
  const s = sessions().get(id);
  if (s) { s.title = title; s.updated_at = new Date().toISOString(); sessions().upsert(s); }
}

export function updateSessionActivity(id: string): void {
  const s = sessions().get(id);
  if (s) { s.message_count++; s.updated_at = new Date().toISOString(); sessions().upsert(s); }
}

// ===== 聊天消息 =====

export function saveMessage(msg: ChatMessageRow): void {
  messages().upsert(msg);
  updateSessionActivity(msg.session_id);
}

export function getSessionMessages(sessionId: string, limit: number = 50): ChatMessageRow[] {
  return messages().query({
    where: m => m.session_id === sessionId,
    orderBy: 'timestamp',
    desc: false,
    limit,
  });
}

export function deleteSessionMessages(sessionId: string): void {
  messages().deleteWhere(m => m.session_id === sessionId);
}

// ===== 视频任务 =====

export function addVideoTask(task: Omit<VideoTaskRow, 'created_at' | 'updated_at'>): void {
  const now = new Date().toISOString();
  videoTasks().upsert({ ...task, created_at: now, updated_at: now });
}

export function updateVideoTaskStatus(taskId: string, status: string): void {
  const t = videoTasks().get(taskId);
  if (t) { t.status = status; t.updated_at = new Date().toISOString(); videoTasks().upsert(t); }
}

export function getPendingVideoTasks(): VideoTaskRow[] {
  return videoTasks().query({
    where: t => t.status === 'pending',
    orderBy: 'created_at',
    desc: true,
  });
}

export function deleteVideoTask(taskId: string): void {
  videoTasks().delete(taskId);
}

export function cleanCompletedVideoTasks(): number {
  return videoTasks().deleteWhere(t => ['completed', 'failed', 'cancelled'].includes(t.status));
}

// ===== Agent 短期记忆（会话级） =====

export function addShortMemory(memory: Omit<ShortMemoryRow, 'id' | 'created_at'>): string {
  const id = `${memory.session_id}_${memory.agent_name}_${memory.turn_index}`;
  shortMemory().upsert({
    ...memory,
    id,
    created_at: new Date().toISOString(),
  });
  return id;
}

export function getShortMemories(sessionId: string, agentName?: string): ShortMemoryRow[] {
  return shortMemory().query({
    where: m => m.session_id === sessionId && (!agentName || m.agent_name === agentName),
    orderBy: 'turn_index',
    desc: false,
  });
}

export function getRecentShortMemories(sessionId: string, limit: number = 20): ShortMemoryRow[] {
  return shortMemory().query({
    where: m => m.session_id === sessionId,
    orderBy: 'turn_index',
    desc: true,
    limit,
  });
}

export function clearSessionShortMemories(sessionId: string): void {
  shortMemory().deleteWhere(m => m.session_id === sessionId);
}

/** 压缩短期记忆：将旧记忆汇总为摘要，保留最近 N 轮 */
export function compressShortMemories(sessionId: string, agentName: string, summary: string, keepRecentTurns: number): void {
  const all = shortMemory().query({
    where: m => m.session_id === sessionId && m.agent_name === agentName,
    orderBy: 'turn_index',
    desc: true,
  });
  if (all.length <= keepRecentTurns) return;

  // 删除被压缩的记忆
  const toCompress = all.slice(keepRecentTurns);
  const idsToDelete = toCompress.map(m => m.id);
  idsToDelete.forEach(id => shortMemory().delete(id));

  // 添加摘要记忆
  const id = `${sessionId}_${agentName}_summary_${Date.now()}`;
  shortMemory().upsert({
    id,
    session_id: sessionId,
    agent_name: agentName,
    turn_index: -1, // 摘要用负数索引
    role: 'system',
    content: `[会话摘要] ${summary}`,
    summary,
    token_estimate: Math.ceil(summary.length / 2),
    created_at: new Date().toISOString(),
  });
}

// ===== Agent 长期记忆（跨会话） =====

export function addLongMemory(memory: Omit<LongMemoryRow, 'access_count' | 'last_accessed'>): string {
  const id = memory.id || `lm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  longMemory().upsert({
    ...memory,
    id,
    access_count: 0,
    last_accessed: new Date().toISOString(),
  });
  return id;
}

export function getLongMemoriesByCategory(category: string, limit: number = 50): LongMemoryRow[] {
  return longMemory().query({
    where: m => m.category === category,
    orderBy: 'importance',
    desc: true,
    limit,
  });
}

export function getLongMemoriesByAgent(agentName: string, limit: number = 50): LongMemoryRow[] {
  return longMemory().query({
    where: m => m.agent_name === agentName,
    orderBy: 'importance',
    desc: true,
    limit,
  });
}

export function searchLongMemories(query: string, limit: number = 20): LongMemoryRow[] {
  const lower = query.toLowerCase();
  return longMemory().query({
    where: m => m.content.toLowerCase().includes(lower),
    orderBy: 'importance',
    desc: true,
    limit,
  });
}

export function getAllLongMemoriesWithEmbedding(limit: number = 200): LongMemoryRow[] {
  return longMemory().query({
    where: m => m.embedding_json !== '' && m.embedding_json != null,
    orderBy: 'importance',
    desc: true,
    limit,
  });
}

export function incrementLongMemoryAccess(id: string): void {
  const m = longMemory().get(id);
  if (m) { m.access_count++; m.last_accessed = new Date().toISOString(); longMemory().upsert(m); }
}

export function deleteLongMemory(id: string): void {
  longMemory().delete(id);
}

// ===== 操作日志（追加模式，按日分文件） =====

let _logStream: { stream: fs.WriteStream; date: string } | null = null;

function getLogStream(): fs.WriteStream {
  const today = new Date().toISOString().slice(0, 10);
  if (_logStream && _logStream.date === today) return _logStream.stream;

  if (_logStream) _logStream.stream.end();
  const logPath = path.join(DATA_DIR, 'logs', `operations-${today}.log`);
  const logDir = path.dirname(logPath);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  _logStream = {
    stream: fs.createWriteStream(logPath, { flags: 'a' }),
    date: today,
  };
  return _logStream.stream;
}

export function addOperationLog(log: {
  timestamp?: string; level: string; category: string;
  user_id?: string; session_id?: string; operation: string;
  detail?: string; duration_ms?: number; result?: string;
  error_text?: string; metadata?: string;
}): void {
  const line = JSON.stringify({
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
  }) + '\n';

  try {
    getLogStream().write(line);
  } catch {
    // 日志写入失败不影响主流程
  }
}

export function getOperationLogs(sessionId?: string, limit: number = 100): any[] {
  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join(DATA_DIR, 'logs', `operations-${today}.log`);
  if (!fs.existsSync(logPath)) return [];

  try {
    const raw = fs.readFileSync(logPath, 'utf-8');
    let lines = raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    if (sessionId) lines = lines.filter((l: any) => l.session_id === sessionId);
    return lines.slice(-limit).reverse();
  } catch {
    return [];
  }
}

// ===== 清理 & 关闭 =====

export function flushAll(): void {
  sessions().flush();
  messages().flush();
  shortMemory().flush();
  longMemory().flush();
  videoTasks().flush();
  if (_logStream) { _logStream.stream.end(); _logStream = null; }
}

export function closeDb(): void {
  flushAll();
  console.log('[Database] 所有表已保存并关闭');
}

// 进程退出时自动保存
process.on('exit', () => flushAll());
process.on('SIGINT', () => { flushAll(); process.exit(0); });
process.on('SIGTERM', () => { flushAll(); process.exit(0); });
