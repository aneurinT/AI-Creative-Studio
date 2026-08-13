/**
 * 数据库 facade（向后兼容层）
 *
 * 原 JSON 文件数据库现已重构为适配器架构（见 ./db/）。
 * 本文件保留所有具名导出函数与类型签名，内部委托给 getDb()，
 * 保证全项目 `from './database.js'` 导入零改动。
 *
 * 通过 DB_MODE 环境变量切换 json（默认）/ sqlite 后端。
 * 详见 ./db/index.ts
 */
import { getDb } from './db/index.js';

// 重新导出行类型（保持向后兼容）
export type {
  ChatSession,
  ChatMessageRow,
  ShortMemoryRow,
  LongMemoryRow,
  VideoTaskRow,
  CheckpointRow,
  OperationLog,
} from './db/types.js';

// ===== 会话 =====
export function createSession(id: string, title = '') {
  return getDb().createSession(id, title);
}
export function getSession(id: string) {
  return getDb().getSession(id);
}
export function getActiveSessions(userId = 'anonymous') {
  return getDb().getActiveSessions(userId);
}
export function updateSessionActivity(id: string): void {
  getDb().updateSessionActivity(id);
}
export function saveMessage(msg: import('./db/types.js').ChatMessageRow): void {
  getDb().saveMessage(msg);
}
export function getSessionMessages(sessionId: string, limit = 50) {
  return getDb().getSessionMessages(sessionId, limit);
}
export function deleteSessionMessages(sessionId: string): void {
  getDb().deleteSessionMessages(sessionId);
}

// ===== 短期记忆 =====
export function addShortMemory(m: Omit<import('./db/types.js').ShortMemoryRow, 'id' | 'created_at'>): string {
  return getDb().addShortMemory(m);
}
export function getShortMemories(sessionId: string, agentName?: string) {
  return getDb().getShortMemories(sessionId, agentName);
}
export function compressShortMemories(
  sessionId: string,
  agentName: string,
  summary: string,
  keepRecent: number,
): void {
  getDb().compressShortMemories(sessionId, agentName, summary, keepRecent);
}
export function clearSessionShortMemories(sessionId: string): void {
  getDb().clearSessionShortMemories(sessionId);
}

// ===== 长期记忆 =====
export function addLongMemory(m: Omit<import('./db/types.js').LongMemoryRow, 'access_count' | 'last_accessed'>): string {
  return getDb().addLongMemory(m);
}
export function getLongMemoriesByAgent(agentName: string, limit = 50) {
  return getDb().getLongMemoriesByAgent(agentName, limit);
}
export function searchLongMemories(query: string, limit = 20) {
  return getDb().searchLongMemories(query, limit);
}
export function getAllLongMemoriesWithEmbedding(limit = 200) {
  return getDb().getAllLongMemoriesWithEmbedding(limit);
}
export function incrementLongMemoryAccess(id: string): void {
  getDb().incrementLongMemoryAccess(id);
}
export function deleteLongMemory(id: string): void {
  getDb().deleteLongMemory(id);
}

// ===== 视频任务 =====
export function addVideoTask(t: Omit<import('./db/types.js').VideoTaskRow, 'created_at' | 'updated_at'>): void {
  getDb().addVideoTask(t);
}
export function updateVideoTaskStatus(taskId: string, status: string): void {
  getDb().updateVideoTaskStatus(taskId, status);
}
export function getPendingVideoTasks() {
  return getDb().getPendingVideoTasks();
}
export function cleanCompletedVideoTasks() {
  return getDb().cleanCompletedVideoTasks();
}

// ===== 检查点 =====
export function saveCheckpoint(cp: Omit<import('./db/types.js').CheckpointRow, 'id' | 'created_at' | 'updated_at'>): string {
  return getDb().saveCheckpoint(cp);
}
export function getCheckpoint(id: string) {
  return getDb().getCheckpoint(id);
}
export function getActiveCheckpoints(sessionId: string, agentName?: string) {
  return getDb().getActiveCheckpoints(sessionId, agentName);
}
export function getLatestCheckpoint(sessionId: string, agentName: string, stage?: string) {
  return getDb().getLatestCheckpoint(sessionId, agentName, stage);
}
export function updateCheckpointStatus(id: string, status: import('./db/types.js').CheckpointRow['status']): void {
  getDb().updateCheckpointStatus(id, status);
}
export function completeCheckpoint(id: string): void {
  getDb().completeCheckpoint(id);
}
export function failCheckpoint(id: string): void {
  getDb().failCheckpoint(id);
}
export function expireOldCheckpoints(maxAgeHours = 24): number {
  return getDb().expireOldCheckpoints(maxAgeHours);
}

// ===== 操作日志 =====
export function addOperationLog(log: import('./db/types.js').OperationLog): void {
  getDb().addOperationLog(log);
}

// ===== 生命周期 =====
export function flushAll(): void {
  getDb().flushAll();
}
export function closeDb(): void {
  getDb().closeDb();
}
