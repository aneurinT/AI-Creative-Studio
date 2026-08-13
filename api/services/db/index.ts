/**
 * 数据库 facade — 按 DB_MODE 环境变量选择适配器
 *
 * - DB_MODE=json（默认）：使用 JsonAdapter，行为与历史完全一致
 * - DB_MODE=sqlite：使用 SqliteAdapter（better-sqlite3），写入性能与并发安全性更优
 *
 * better-sqlite3 为原生模块，加载失败时自动降级到 JsonAdapter（Electron 打包兜底）。
 * 顶层 await 确保适配器在使用前完成初始化。
 */
import { JsonAdapter } from './jsonAdapter.js';
import type { DatabaseAdapter } from './types.js';

let adapter: DatabaseAdapter;
let dbMode: 'json' | 'sqlite' = 'json';

const mode = (process.env.DB_MODE || 'json').toLowerCase();
if (mode === 'sqlite') {
  try {
    const { SqliteAdapter } = await import('./sqliteAdapter.js');
    adapter = new SqliteAdapter();
    dbMode = 'sqlite';
    console.log('[DB] 使用 SQLite 模式');
  } catch (e) {
    console.warn(
      `[DB] SQLite 加载失败，降级到 JSON 模式:`,
      (e as Error).message,
    );
    adapter = new JsonAdapter();
    console.log('[DB] 使用 JSON 模式（降级）');
  }
} else {
  adapter = new JsonAdapter();
  console.log('[DB] 使用 JSON 模式');
}

/** 获取当前数据库适配器实例 */
export function getDb(): DatabaseAdapter {
  return adapter;
}

/** 获取当前数据库模式 */
export function getDbMode(): 'json' | 'sqlite' {
  return dbMode;
}

// 进程退出钩子：确保数据落盘
process.on('exit', () => {
  try {
    adapter.flushAll();
  } catch {
    /* ignore */
  }
});
process.on('SIGINT', () => {
  try {
    adapter.flushAll();
  } catch {
    /* ignore */
  }
  process.exit(0);
});
process.on('SIGTERM', () => {
  try {
    adapter.flushAll();
  } catch {
    /* ignore */
  }
  process.exit(0);
});
