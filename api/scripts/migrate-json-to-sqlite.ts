/**
 * JSON → SQLite 一次性数据迁移脚本
 *
 * 用法：npm run db:migrate
 *
 * 读取 data/ 下的 JSON 文件，upsert 到 SQLite 数据库（DB_PATH 或默认 app.db）。
 * 幂等：upsert 语义，重复运行结果一致，不会产生重复数据。
 *
 * 注意：
 * - data/sessions/*.json（chatSessionService 的数据）本轮不迁移（签名冲突），原样保留
 * - 操作日志（data/logs/operations-*.log）会回填到 operation_logs 表
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');
const dbPath = process.env.DB_PATH || path.join(DATA_DIR, 'app.db');

console.log(`[Migrate] 数据目录: ${DATA_DIR}`);
console.log(`[Migrate] 目标 SQLite: ${dbPath}`);

if (!fs.existsSync(DATA_DIR)) {
  console.log('[Migrate] data 目录不存在，无需迁移');
  process.exit(0);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// 建表（与 SqliteAdapter.initSchema 一致）
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, title TEXT, user_id TEXT, created_at TEXT, updated_at TEXT, message_count INTEGER, is_active INTEGER);
  CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, action_type TEXT, params TEXT, generated_image TEXT, generated_video TEXT, original_prompt TEXT, is_generating INTEGER, progress INTEGER, agent_thoughts TEXT, agent_process TEXT, modify_history TEXT, timestamp INTEGER);
  CREATE TABLE IF NOT EXISTS agent_short_memory (id TEXT PRIMARY KEY, session_id TEXT, agent_name TEXT, turn_index INTEGER, role TEXT, content TEXT, summary TEXT, token_estimate INTEGER, created_at TEXT);
  CREATE TABLE IF NOT EXISTS agent_long_memory (id TEXT PRIMARY KEY, session_id TEXT, agent_name TEXT, category TEXT, content TEXT, embedding_json TEXT, importance REAL, access_count INTEGER, created_at TEXT, last_accessed TEXT);
  CREATE TABLE IF NOT EXISTS video_tasks (task_id TEXT PRIMARY KEY, prompt TEXT, style TEXT, duration TEXT, status TEXT, source TEXT, user_id TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, session_id TEXT, agent_name TEXT, stage TEXT, state_json TEXT, summary TEXT, status TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE IF NOT EXISTS operation_logs (rowid INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, level TEXT, category TEXT, user_id TEXT, session_id TEXT, operation TEXT, detail TEXT, duration_ms INTEGER, result TEXT, error_text TEXT, metadata TEXT);
  CREATE TABLE IF NOT EXISTS video_task_progress (task_id TEXT PRIMARY KEY, progress INTEGER, status TEXT, video_url TEXT, error TEXT, task_type TEXT, prompt TEXT, style TEXT, duration TEXT, created_at INTEGER, updated_at INTEGER);
  CREATE TABLE IF NOT EXISTS video_history (id TEXT PRIMARY KEY, prompt TEXT, style TEXT, duration TEXT, video_url TEXT, created_at TEXT);
`);

/** 通用迁移：读取 JSON 数组文件，upsert 到指定表 */
function migrateArrayTable(
  jsonFile: string,
  table: string,
  cols: string[],
  pk: string,
  transform?: (row: any) => any,
): number {
  const filePath = path.join(DATA_DIR, jsonFile);
  if (!fs.existsSync(filePath)) {
    console.log(`[Migrate] 跳过 ${jsonFile}（不存在）`);
    return 0;
  }
  let data: any[];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    data = Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.warn(`[Migrate] 解析 ${jsonFile} 失败:`, (e as Error).message);
    return 0;
  }
  if (data.length === 0) {
    console.log(`[Migrate] 跳过 ${jsonFile}（空）`);
    return 0;
  }
  const placeholders = cols.map(() => '?').join(', ');
  const updates = cols.filter(c => c !== pk).map(c => `${c}=excluded.${c}`).join(', ');
  const stmt = db.prepare(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT(${pk}) DO UPDATE SET ${updates}`,
  );
  const tx = db.transaction((rows: any[]) => {
    for (const row of rows) {
      const r = transform ? transform(row) : row;
      stmt.run(...cols.map(c => (r[c] !== undefined ? r[c] : null)));
    }
  });
  tx(data);
  console.log(`[Migrate] ${jsonFile} → ${table}: ${data.length} 条`);
  return data.length;
}

let total = 0;

// chat_sessions（字段已是 snake_case）
total += migrateArrayTable('chat_sessions.json', 'chat_sessions', ['id', 'title', 'user_id', 'created_at', 'updated_at', 'message_count', 'is_active'], 'id');

// chat_messages
total += migrateArrayTable('chat_messages.json', 'chat_messages', ['id', 'session_id', 'role', 'content', 'action_type', 'params', 'generated_image', 'generated_video', 'original_prompt', 'is_generating', 'progress', 'agent_thoughts', 'agent_process', 'modify_history', 'timestamp'], 'id');

// agent_short_memory
total += migrateArrayTable('agent_short_memory.json', 'agent_short_memory', ['id', 'session_id', 'agent_name', 'turn_index', 'role', 'content', 'summary', 'token_estimate', 'created_at'], 'id');

// agent_long_memory
total += migrateArrayTable('agent_long_memory.json', 'agent_long_memory', ['id', 'session_id', 'agent_name', 'category', 'content', 'embedding_json', 'importance', 'access_count', 'created_at', 'last_accessed'], 'id');

// video_tasks
total += migrateArrayTable('video_tasks.json', 'video_tasks', ['task_id', 'prompt', 'style', 'duration', 'status', 'source', 'user_id', 'created_at', 'updated_at'], 'task_id');

// checkpoints
total += migrateArrayTable('checkpoints.json', 'checkpoints', ['id', 'session_id', 'agent_name', 'stage', 'state_json', 'summary', 'status', 'created_at', 'updated_at'], 'id');

// video_task_progress（结构：{tasks: {taskId: TaskProgress}}，字段 camelCase）
{
  const filePath = path.join(DATA_DIR, 'videoTaskProgress.json');
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const tasks = parsed.tasks || parsed;
      const rows = Object.entries(tasks).map(([taskId, p]: [string, any]) => ({
        task_id: taskId,
        progress: p.progress ?? 0,
        status: p.status ?? 'processing',
        video_url: p.videoUrl ?? null,
        error: p.error ?? null,
        task_type: p.taskType ?? 'normal',
        prompt: p.prompt ?? null,
        style: p.style ?? null,
        duration: p.duration ?? null,
        created_at: p.createdAt ?? Date.now(),
        updated_at: p.updatedAt ?? Date.now(),
      }));
      const cols = ['task_id', 'progress', 'status', 'video_url', 'error', 'task_type', 'prompt', 'style', 'duration', 'created_at', 'updated_at'];
      const placeholders = cols.map(() => '?').join(', ');
      const updates = cols.filter(c => c !== 'task_id').map(c => `${c}=excluded.${c}`).join(', ');
      const stmt = db.prepare(`INSERT INTO video_task_progress (${cols.join(',')}) VALUES (${placeholders}) ON CONFLICT(task_id) DO UPDATE SET ${updates}`);
      const tx = db.transaction((rs: any[]) => { for (const r of rs) stmt.run(...cols.map(c => r[c] ?? null)); });
      tx(rows);
      console.log(`[Migrate] videoTaskProgress.json → video_task_progress: ${rows.length} 条`);
      total += rows.length;
    } catch (e) {
      console.warn('[Migrate] 迁移 videoTaskProgress.json 失败:', (e as Error).message);
    }
  } else {
    console.log('[Migrate] 跳过 videoTaskProgress.json（不存在）');
  }
}

// video_history（数组，字段 camelCase：videoUrl, createdAt）
total += migrateArrayTable(
  'videoHistory.json',
  'video_history',
  ['id', 'prompt', 'style', 'duration', 'video_url', 'created_at'],
  'id',
  (row: any) => ({
    id: row.id,
    prompt: row.prompt,
    style: row.style,
    duration: row.duration,
    video_url: row.videoUrl,
    created_at: row.createdAt,
  }),
);

// 操作日志（data/logs/operations-*.log，每行一个 JSON）
{
  const logsDir = path.join(DATA_DIR, 'logs');
  let logCount = 0;
  if (fs.existsSync(logsDir)) {
    const logFiles = fs.readdirSync(logsDir).filter(f => f.startsWith('operations-') && f.endsWith('.log'));
    const stmt = db.prepare(
      `INSERT INTO operation_logs (timestamp, level, category, user_id, session_id, operation, detail, duration_ms, result, error_text, metadata)
       VALUES (@timestamp, @level, @category, @user_id, @session_id, @operation, @detail, @duration_ms, @result, @error_text, @metadata)`,
    );
    const tx = db.transaction((lines: any[]) => {
      for (const line of lines) stmt.run(line);
    });
    const batch: any[] = [];
    for (const f of logFiles) {
      const content = fs.readFileSync(path.join(logsDir, f), 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          batch.push(JSON.parse(line));
        } catch {
          /* skip malformed */
        }
      }
    }
    if (batch.length > 0) {
      tx(batch);
      logCount = batch.length;
    }
    console.log(`[Migrate] logs/operations-*.log → operation_logs: ${logCount} 条（${logFiles.length} 个文件）`);
    total += logCount;
  } else {
    console.log('[Migrate] 跳过 logs 目录（不存在）');
  }
}

// data/sessions/*.json（chatSessionService 数据）— 本轮不迁移，留 TODO
{
  const sessionsDir = path.join(DATA_DIR, 'sessions');
  if (fs.existsSync(sessionsDir)) {
    const count = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json')).length;
    console.log(`[Migrate] TODO: data/sessions/ 下有 ${count} 个会话文件未迁移（chatSessionService 签名冲突，本轮保留原样）`);
  }
}

db.close();
console.log(`\n[Migrate] 迁移完成，共 ${total} 条记录。`);
console.log('[Migrate] 下一步：设置 DB_MODE=sqlite 启动服务即可使用 SQLite。');
