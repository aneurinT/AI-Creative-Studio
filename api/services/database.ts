/**
 * JSON 文件数据库 — 零外部依赖，持久化所有核心数据
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

// ===== 通用表引擎 =====
class JsonTable<T extends { id?: string }> {
  private filePath: string;
  private data: T[] = [];
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private indexMap = new Map<string, number>();

  constructor(filename: string) {
    this.filePath = path.join(DATA_DIR, filename);
    this.load();
  }
  private load(): void {
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); if (fs.existsSync(this.filePath)) { this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')); this.rebuildIndex(); } } catch { this.data = []; }
  }
  private rebuildIndex(): void { this.indexMap.clear(); this.data.forEach((item, i) => { if (item.id) this.indexMap.set(item.id, i); }); }
  private scheduleSave(): void { this.dirty = true; if (this.saveTimer) clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.saveNow(), 2000); }
  saveNow(): void { if (!this.dirty) return; try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); const tmp = this.filePath + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8'); fs.renameSync(tmp, this.filePath); this.dirty = false; } catch (e) { console.error(`[DB] Save failed: ${this.filePath}`, (e as Error).message); } }
  upsert(item: T): void { if (item.id && this.indexMap.has(item.id)) { this.data[this.indexMap.get(item.id)!] = item; } else { this.data.push(item); if (item.id) this.indexMap.set(item.id, this.data.length - 1); } this.scheduleSave(); }
  get(id: string): T | undefined { const idx = this.indexMap.get(id); return idx !== undefined ? this.data[idx] : undefined; }
  filter(fn: (item: T) => boolean): T[] { return this.data.filter(fn); }
  query(opts: { where?: (item: T) => boolean; orderBy?: keyof T; desc?: boolean; limit?: number; offset?: number }): T[] { let result = opts.where ? this.data.filter(opts.where) : [...this.data]; if (opts.orderBy) { result.sort((a, b) => { const va = a[opts.orderBy!], vb = b[opts.orderBy!]; return opts.desc ? (va < vb ? 1 : -1) : (va < vb ? -1 : 1); }); } if (opts.offset) result = result.slice(opts.offset); if (opts.limit) result = result.slice(0, opts.limit); return result; }
  delete(id: string): boolean { const idx = this.indexMap.get(id); if (idx === undefined) return false; this.data.splice(idx, 1); this.rebuildIndex(); this.scheduleSave(); return true; }
  deleteWhere(fn: (item: T) => boolean): number { const before = this.data.length; this.data = this.data.filter(item => !fn(item)); this.rebuildIndex(); this.scheduleSave(); return before - this.data.length; }
  all(): T[] { return this.data; }
  flush(): void { this.saveNow(); }
}

// ===== 表定义 =====
export interface ChatSession { id: string; title: string; user_id: string; created_at: string; updated_at: string; message_count: number; is_active: number; }
export interface ChatMessageRow { id: string; session_id: string; role: string; content: string; action_type: string; params: string; generated_image: string; generated_video: string; original_prompt: string; is_generating: number; progress: number; agent_thoughts: string; agent_process: string; modify_history: string; timestamp: number; }
export interface ShortMemoryRow { id: string; session_id: string; agent_name: string; turn_index: number; role: string; content: string; summary: string; token_estimate: number; created_at: string; }
export interface LongMemoryRow { id: string; session_id: string; agent_name: string; category: string; content: string; embedding_json: string; importance: number; access_count: number; created_at: string; last_accessed: string; }
export interface VideoTaskRow { task_id: string; prompt: string; style: string; duration: string; status: string; source: string; user_id: string; created_at: string; updated_at: string; }
export interface CheckpointRow { id: string; session_id: string; agent_name: string; stage: string; state_json: string; summary: string; status: 'active' | 'completed' | 'failed' | 'expired'; created_at: string; updated_at: string; }

let _sessions: JsonTable<ChatSession> | null = null;
let _messages: JsonTable<ChatMessageRow> | null = null;
let _shortMemory: JsonTable<ShortMemoryRow> | null = null;
let _longMemory: JsonTable<LongMemoryRow> | null = null;
let _videoTasks: JsonTable<VideoTaskRow> | null = null;
let _checkpoints: JsonTable<CheckpointRow> | null = null;

const sessions = () => { if (!_sessions) _sessions = new JsonTable<ChatSession>('chat_sessions.json'); return _sessions; };
const messages = () => { if (!_messages) _messages = new JsonTable<ChatMessageRow>('chat_messages.json'); return _messages; };
const shortMemory = () => { if (!_shortMemory) _shortMemory = new JsonTable<ShortMemoryRow>('agent_short_memory.json'); return _shortMemory; };
const longMemory = () => { if (!_longMemory) _longMemory = new JsonTable<LongMemoryRow>('agent_long_memory.json'); return _longMemory; };
const videoTasks = () => { if (!_videoTasks) { _videoTasks = new JsonTable<VideoTaskRow>('video_tasks.json'); migrateOldVideoTasks(); } return _videoTasks; };
const checkpoints = () => { if (!_checkpoints) _checkpoints = new JsonTable<CheckpointRow>('checkpoints.json'); return _checkpoints; };

function migrateOldVideoTasks(): void {
  const oldPath = path.join(DATA_DIR, 'videoTasks.json');
  if (!fs.existsSync(oldPath)) return;
  try { const raw = fs.readFileSync(oldPath, 'utf-8'); const old = JSON.parse(raw); if (Array.isArray(old) && _videoTasks) { let n = 0; old.forEach((t: any) => { if (!_videoTasks!.get(t.taskId)) { _videoTasks!.upsert({ task_id: t.taskId, prompt: t.prompt || '', style: t.style || 'realistic', duration: t.duration || '10', status: t.status || 'pending', source: t.source || 'video-generator', user_id: 'anonymous', created_at: t.createdAt || new Date().toISOString(), updated_at: new Date().toISOString() }); n++; } }); if (n > 0) { console.log(`[DB] 迁移 ${n} 条旧视频任务`); _videoTasks.saveNow(); } } fs.renameSync(oldPath, oldPath + '.bak'); } catch { /* skip */ }
}

// ===== 公开 API =====
export function createSession(id: string, title = ''): ChatSession { const now = new Date().toISOString(); const s: ChatSession = { id, title, user_id: 'anonymous', created_at: now, updated_at: now, message_count: 0, is_active: 1 }; sessions().upsert(s); return s; }
export function getSession(id: string) { return sessions().get(id); }
export function getActiveSessions(userId = 'anonymous') { return sessions().query({ where: s => s.user_id === userId && s.is_active === 1, orderBy: 'updated_at', desc: true, limit: 50 }); }
export function updateSessionActivity(id: string): void { const s = sessions().get(id); if (s) { s.message_count++; s.updated_at = new Date().toISOString(); sessions().upsert(s); } }
export function saveMessage(msg: ChatMessageRow): void { messages().upsert(msg); updateSessionActivity(msg.session_id); }
export function getSessionMessages(sessionId: string, limit = 50) { return messages().query({ where: m => m.session_id === sessionId, orderBy: 'timestamp', desc: false, limit }); }
export function deleteSessionMessages(sessionId: string): void { messages().deleteWhere(m => m.session_id === sessionId); }

// 短期记忆
export function addShortMemory(m: Omit<ShortMemoryRow, 'id' | 'created_at'>): string { const id = `${m.session_id}_${m.agent_name}_${m.turn_index}`; shortMemory().upsert({ ...m, id, created_at: new Date().toISOString() }); return id; }
export function getShortMemories(sessionId: string, agentName?: string) { return shortMemory().query({ where: m => m.session_id === sessionId && (!agentName || m.agent_name === agentName), orderBy: 'turn_index', desc: false }); }
export function compressShortMemories(sessionId: string, agentName: string, summary: string, keepRecent: number): void { const all = shortMemory().query({ where: m => m.session_id === sessionId && m.agent_name === agentName, orderBy: 'turn_index', desc: true }); if (all.length <= keepRecent) return; const toCompress = all.slice(keepRecent); toCompress.forEach(m => shortMemory().delete(m.id)); const id = `${sessionId}_${agentName}_summary_${Date.now()}`; shortMemory().upsert({ id, session_id: sessionId, agent_name: agentName, turn_index: -1, role: 'system', content: `[摘要] ${summary}`, summary, token_estimate: Math.ceil(summary.length / 2), created_at: new Date().toISOString() }); }
export function clearSessionShortMemories(sessionId: string): void { shortMemory().deleteWhere(m => m.session_id === sessionId); }

// 长期记忆
export function addLongMemory(m: Omit<LongMemoryRow, 'access_count' | 'last_accessed'>): string { const id = m.id || `lm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; longMemory().upsert({ ...m, id, access_count: 0, last_accessed: new Date().toISOString() }); return id; }
export function getLongMemoriesByAgent(agentName: string, limit = 50) { return longMemory().query({ where: m => m.agent_name === agentName, orderBy: 'importance', desc: true, limit }); }
export function searchLongMemories(query: string, limit = 20) { const lower = query.toLowerCase(); return longMemory().query({ where: m => m.content.toLowerCase().includes(lower), orderBy: 'importance', desc: true, limit }); }
export function getAllLongMemoriesWithEmbedding(limit = 200) { return longMemory().query({ where: m => m.embedding_json !== '' && m.embedding_json != null, orderBy: 'importance', desc: true, limit }); }
export function incrementLongMemoryAccess(id: string): void { const m = longMemory().get(id); if (m) { m.access_count++; m.last_accessed = new Date().toISOString(); longMemory().upsert(m); } }
export function deleteLongMemory(id: string): void { longMemory().delete(id); }

// 视频任务
export function addVideoTask(t: Omit<VideoTaskRow, 'created_at' | 'updated_at'>): void { const now = new Date().toISOString(); videoTasks().upsert({ ...t, created_at: now, updated_at: now }); }
export function updateVideoTaskStatus(taskId: string, status: string): void { const t = videoTasks().get(taskId); if (t) { t.status = status; t.updated_at = new Date().toISOString(); videoTasks().upsert(t); } }
export function getPendingVideoTasks() { return videoTasks().query({ where: t => t.status === 'pending', orderBy: 'created_at', desc: true }); }
export function cleanCompletedVideoTasks() { return videoTasks().deleteWhere(t => ['completed', 'failed', 'cancelled'].includes(t.status)); }

// ===== Checkpoint 检查点 =====
export function saveCheckpoint(cp: Omit<CheckpointRow, 'id' | 'created_at' | 'updated_at'>): string {
  const id = `cp_${cp.session_id}_${cp.agent_name}_${cp.stage}_${Date.now()}`;
  const now = new Date().toISOString();
  checkpoints().upsert({ ...cp, id, created_at: now, updated_at: now });
  return id;
}
export function getCheckpoint(id: string): CheckpointRow | undefined { return checkpoints().get(id); }
export function getActiveCheckpoints(sessionId: string, agentName?: string): CheckpointRow[] {
  return checkpoints().query({
    where: c => c.session_id === sessionId && c.status === 'active' && (!agentName || c.agent_name === agentName),
    orderBy: 'created_at', desc: true,
  });
}
export function getLatestCheckpoint(sessionId: string, agentName: string, stage?: string): CheckpointRow | undefined {
  const all = checkpoints().query({
    where: c => c.session_id === sessionId && c.agent_name === agentName && c.status === 'active' && (!stage || c.stage === stage),
    orderBy: 'created_at', desc: true, limit: 1,
  });
  return all[0];
}
export function updateCheckpointStatus(id: string, status: CheckpointRow['status']): void {
  const cp = checkpoints().get(id);
  if (cp) { cp.status = status; cp.updated_at = new Date().toISOString(); checkpoints().upsert(cp); }
}
export function completeCheckpoint(id: string): void { updateCheckpointStatus(id, 'completed'); }
export function failCheckpoint(id: string): void { updateCheckpointStatus(id, 'failed'); }
export function expireOldCheckpoints(maxAgeHours = 24): number {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
  return checkpoints().deleteWhere(c => c.status === 'active' && c.created_at < cutoff);
}

// 操作日志（追加模式，按日分文件）
let _logStream: { stream: fs.WriteStream; date: string } | null = null;
function getLogStream(): fs.WriteStream { const today = new Date().toISOString().slice(0, 10); if (_logStream && _logStream.date === today) return _logStream.stream; if (_logStream) _logStream.stream.end(); const logPath = path.join(DATA_DIR, 'logs', `operations-${today}.log`); const logDir = path.dirname(logPath); if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true }); _logStream = { stream: fs.createWriteStream(logPath, { flags: 'a' }), date: today }; return _logStream.stream; }
export function addOperationLog(log: { timestamp?: string; level: string; category: string; user_id?: string; session_id?: string; operation: string; detail?: string; duration_ms?: number; result?: string; error_text?: string; metadata?: string }): void { const line = JSON.stringify({ ...log, timestamp: log.timestamp || new Date().toISOString(), user_id: log.user_id || 'anonymous', session_id: log.session_id || '', detail: log.detail || '', duration_ms: log.duration_ms || 0, result: log.result || 'success', error_text: log.error_text || '', metadata: log.metadata || '{}' }) + '\n'; try { getLogStream().write(line); } catch { /* silent */ } }

export function flushAll(): void { sessions().flush(); messages().flush(); shortMemory().flush(); longMemory().flush(); videoTasks().flush(); checkpoints().flush(); if (_logStream) { _logStream.stream.end(); _logStream = null; } }
export function closeDb(): void { flushAll(); console.log('[DB] 所有表已保存并关闭'); }

process.on('exit', () => flushAll());
process.on('SIGINT', () => { flushAll(); process.exit(0); });
process.on('SIGTERM', () => { flushAll(); process.exit(0); });
