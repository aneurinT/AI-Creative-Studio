/**
 * 多人协同服务
 *
 * 核心能力：
 * 1. 多用户会话隔离（每个用户独立 session，可共享到协作房间）
 * 2. 协作房间管理（创建/加入/离开/消息广播）
 * 3. 操作互斥锁（防止多人同时修改同一资源）
 * 4. 操作历史（undo/redo 支持）
 * 5. 在线状态追踪
 */
import { createSession, getSession, saveMessage } from './database.js';
import { addOperationLog } from './database.js';

// ===== 类型定义 =====

export interface CollaborationUser {
  userId: string;
  username: string;
  joinedAt: string;
  online: boolean;
  lastActive: string;
}

export interface CollaborationRoom {
  roomId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  users: CollaborationUser[];
  sessions: string[];      // 关联的会话 ID
  taskQueue: string[];     // 待处理任务 ID
  activeTask: string | null; // 当前正在处理的任务
}

export interface CollaborationMessage {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  content: string;
  type: 'user_message' | 'agent_response' | 'system' | 'task_update';
  timestamp: number;
  sessionId?: string;
}

export interface OperationLock {
  resourceId: string;
  lockedBy: string;
  lockedAt: string;
  expiresAt: string;
}

// ===== 协作房间存储（内存） =====

const rooms = new Map<string, CollaborationRoom>();
const messages = new Map<string, CollaborationMessage[]>();
const locks = new Map<string, OperationLock>();
const onlineUsers = new Map<string, Set<string>>(); // roomId -> userIds

// ===== 协作房间管理 =====

/** 创建协作房间 */
export function createRoom(roomId: string, name: string, creatorId: string, creatorName: string): CollaborationRoom {
  const now = new Date().toISOString();
  const room: CollaborationRoom = {
    roomId, name, createdBy: creatorId, createdAt: now,
    users: [{ userId: creatorId, username: creatorName, joinedAt: now, online: true, lastActive: now }],
    sessions: [], taskQueue: [], activeTask: null,
  };
  rooms.set(roomId, room);
  addOperationLog({
    level: 'INFO', category: 'collaboration',
    session_id: roomId, operation: 'create_room',
    detail: `${creatorName} 创建协作房间: ${name}`,
  });
  return room;
}

/** 加入协作房间 */
export function joinRoom(roomId: string, userId: string, username: string): CollaborationRoom | null {
  const room = rooms.get(roomId);
  if (!room) return null;

  const existing = room.users.find(u => u.userId === userId);
  const now = new Date().toISOString();
  if (existing) {
    existing.online = true;
    existing.lastActive = now;
  } else {
    room.users.push({ userId, username, joinedAt: now, online: true, lastActive: now });
  }

  if (!onlineUsers.has(roomId)) onlineUsers.set(roomId, new Set());
  onlineUsers.get(roomId)!.add(userId);

  addOperationLog({
    level: 'INFO', category: 'collaboration',
    session_id: roomId, operation: 'join_room',
    detail: `${username} 加入协作房间`,
  });

  return room;
}

/** 离开协作房间 */
export function leaveRoom(roomId: string, userId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;

  const user = room.users.find(u => u.userId === userId);
  if (user) {
    user.online = false;
    user.lastActive = new Date().toISOString();
  }

  onlineUsers.get(roomId)?.delete(userId);

  addOperationLog({
    level: 'INFO', category: 'collaboration',
    session_id: roomId, operation: 'leave_room',
    detail: `${user?.username || userId} 离开协作房间`,
  });
}

/** 获取房间信息 */
export function getRoom(roomId: string): CollaborationRoom | undefined {
  return rooms.get(roomId);
}

/** 获取所有房间 */
export function listRooms(): CollaborationRoom[] {
  return Array.from(rooms.values());
}

// ===== 消息广播 =====

/** 发送消息到协作房间 */
export function broadcastMessage(msg: Omit<CollaborationMessage, 'id' | 'timestamp'>): CollaborationMessage {
  const fullMsg: CollaborationMessage = {
    ...msg,
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
  };

  if (!messages.has(msg.roomId)) {
    messages.set(msg.roomId, []);
  }
  messages.get(msg.roomId)!.push(fullMsg);

  // 持久化用户消息
  if (msg.type === 'user_message' && msg.sessionId) {
    saveMessage({
      id: fullMsg.id,
      session_id: msg.sessionId,
      role: 'user',
      content: msg.content,
      action_type: '', params: '{}',
      generated_image: '', generated_video: '', original_prompt: '',
      is_generating: 0, progress: 0,
      agent_thoughts: '[]', agent_process: '{}', modify_history: '[]',
      timestamp: fullMsg.timestamp,
    });
  }

  return fullMsg;
}

/** 获取房间消息历史 */
export function getRoomMessages(roomId: string, limit = 50): CollaborationMessage[] {
  return (messages.get(roomId) || []).slice(-limit);
}

// ===== 操作互斥锁 =====

/** 尝试获取锁 */
export function tryLock(resourceId: string, userId: string, ttlMs = 30000): boolean {
  const now = Date.now();
  const existing = locks.get(resourceId);
  if (existing && now < new Date(existing.expiresAt).getTime()) {
    return existing.lockedBy === userId; // 同一用户可重入
  }

  locks.set(resourceId, {
    resourceId,
    lockedBy: userId,
    lockedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  });
  return true;
}

/** 释放锁 */
export function releaseLock(resourceId: string, userId: string): boolean {
  const lock = locks.get(resourceId);
  if (lock && lock.lockedBy === userId) {
    locks.delete(resourceId);
    return true;
  }
  return false;
}

/** 清理过期锁 */
export function cleanExpiredLocks(): number {
  const now = Date.now();
  let count = 0;
  locks.forEach((lock, key) => {
    if (now > new Date(lock.expiresAt).getTime()) {
      locks.delete(key);
      count++;
    }
  });
  return count;
}

// ===== 在线状态 =====

/** 获取房间在线用户数 */
export function getOnlineCount(roomId: string): number {
  return onlineUsers.get(roomId)?.size || 0;
}

/** 获取房间在线用户列表 */
export function getOnlineUsers(roomId: string): string[] {
  return Array.from(onlineUsers.get(roomId) || []);
}

/** 更新用户最后活跃时间 */
export function touchUser(roomId: string, userId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const user = room.users.find(u => u.userId === userId);
  if (user) user.lastActive = new Date().toISOString();
}

// 定期清理过期锁
setInterval(cleanExpiredLocks, 60000);
