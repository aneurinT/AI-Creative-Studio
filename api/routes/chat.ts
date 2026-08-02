import { Router, type Request, type Response } from 'express';
import {
  createSession,
  getAllSessions,
  getSession,
  updateSession,
  addMessageToSession,
  deleteSession,
  clearAllSessions,
} from '../services/chatSessionService.js';

const router = Router();

// 辅助函数：从 req.user 获取 userId
function getUserId(req: Request): string {
  return req.user?.userId || 'anonymous';
}

/**
 * 创建新会话
 */
router.post('/sessions', (req: Request, res: Response) => {
  const { title } = req.body;
  const userId = getUserId(req);
  const result = createSession(userId, title);
  res.json(result);
});

/**
 * 获取当前用户的所有会话
 */
router.get('/sessions', (req: Request, res: Response) => {
  const userId = getUserId(req);
  const result = getAllSessions(userId);
  res.json(result);
});

/**
 * 获取单个会话
 */
router.get('/sessions/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = getUserId(req);
  const result = getSession(id);
  // 验证会话属于当前用户
  if (result.success && result.session && result.session.userId && result.session.userId !== userId) {
    res.status(403).json({ success: false, error: '无权访问此会话' });
    return;
  }
  res.json(result);
});

/**
 * 更新会话
 */
router.put('/sessions/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, messages } = req.body;
  const userId = getUserId(req);
  // 先验证所有权
  const existing = getSession(id);
  if (existing.success && existing.session && existing.session.userId && existing.session.userId !== userId) {
    res.status(403).json({ success: false, error: '无权修改此会话' });
    return;
  }
  const result = updateSession(id, { title, messages });
  res.json(result);
});

/**
 * 添加消息到会话
 */
router.post('/sessions/:id/messages', (req: Request, res: Response) => {
  const { id } = req.params;
  const message = req.body;
  const userId = getUserId(req);
  // 先验证所有权
  const existing = getSession(id);
  if (existing.success && existing.session && existing.session.userId && existing.session.userId !== userId) {
    res.status(403).json({ success: false, error: '无权操作此会话' });
    return;
  }
  const result = addMessageToSession(id, message);
  res.json(result);
});

/**
 * 删除单个会话
 */
router.delete('/sessions/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = getUserId(req);
  // 先验证所有权
  const existing = getSession(id);
  if (existing.success && existing.session && existing.session.userId && existing.session.userId !== userId) {
    res.status(403).json({ success: false, error: '无权删除此会话' });
    return;
  }
  const result = deleteSession(id);
  res.json(result);
});

/**
 * 清空当前用户的所有会话
 */
router.delete('/sessions', (req: Request, res: Response) => {
  const userId = getUserId(req);
  const result = clearAllSessions(userId);
  res.json(result);
});

export default router;