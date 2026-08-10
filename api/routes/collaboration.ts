import { Router, type Request, type Response } from 'express';
import {
  createRoom, joinRoom, leaveRoom, getRoom, listRooms,
  broadcastMessage, getRoomMessages, tryLock, releaseLock,
  getOnlineCount, getOnlineUsers, touchUser,
} from '../services/collaborationService.js';

const router = Router();

/** POST /api/collaboration/rooms — 创建协作房间 */
router.post('/rooms', (req: Request, res: Response) => {
  const { roomId, name, userId, username } = req.body;
  if (!roomId || !name || !userId) {
    res.status(400).json({ success: false, error: 'roomId, name, userId required' });
    return;
  }
  const room = createRoom(roomId, name, userId, username || userId);
  res.json({ success: true, room });
});

/** POST /api/collaboration/rooms/:roomId/join — 加入房间 */
router.post('/rooms/:roomId/join', (req: Request, res: Response) => {
  const { userId, username } = req.body;
  const room = joinRoom(req.params.roomId, userId, username || userId);
  if (!room) { res.status(404).json({ success: false, error: '房间不存在' }); return; }
  res.json({ success: true, room, onlineCount: getOnlineCount(req.params.roomId) });
});

/** POST /api/collaboration/rooms/:roomId/leave — 离开房间 */
router.post('/rooms/:roomId/leave', (req: Request, res: Response) => {
  const { userId } = req.body;
  leaveRoom(req.params.roomId, userId);
  res.json({ success: true });
});

/** GET /api/collaboration/rooms — 获取所有房间 */
router.get('/rooms', (req: Request, res: Response) => {
  res.json({ success: true, rooms: listRooms() });
});

/** GET /api/collaboration/rooms/:roomId — 获取房间详情 */
router.get('/rooms/:roomId', (req: Request, res: Response) => {
  const room = getRoom(req.params.roomId);
  if (!room) { res.status(404).json({ success: false, error: '房间不存在' }); return; }
  res.json({ success: true, room, onlineCount: getOnlineCount(req.params.roomId) });
});

/** POST /api/collaboration/rooms/:roomId/messages — 发送消息 */
router.post('/rooms/:roomId/messages', (req: Request, res: Response) => {
  const { userId, username, content, type, sessionId } = req.body;
  if (!userId || !content) {
    res.status(400).json({ success: false, error: 'userId and content required' });
    return;
  }
  touchUser(req.params.roomId, userId);
  const msg = broadcastMessage({
    roomId: req.params.roomId, userId, username: username || userId,
    content, type: type || 'user_message', sessionId,
  });
  res.json({ success: true, message: msg });
});

/** GET /api/collaboration/rooms/:roomId/messages — 获取消息历史 */
router.get('/rooms/:roomId/messages', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json({ success: true, messages: getRoomMessages(req.params.roomId, limit) });
});

/** POST /api/collaboration/lock — 获取操作锁 */
router.post('/lock', (req: Request, res: Response) => {
  const { resourceId, userId, ttlMs } = req.body;
  if (!resourceId || !userId) {
    res.status(400).json({ success: false, error: 'resourceId and userId required' });
    return;
  }
  const ok = tryLock(resourceId, userId, ttlMs || 30000);
  res.json({ success: true, locked: ok });
});

/** POST /api/collaboration/unlock — 释放操作锁 */
router.post('/unlock', (req: Request, res: Response) => {
  const { resourceId, userId } = req.body;
  const ok = releaseLock(resourceId, userId);
  res.json({ success: ok });
});

/** GET /api/collaboration/rooms/:roomId/online — 在线用户数 */
router.get('/rooms/:roomId/online', (req: Request, res: Response) => {
  res.json({ success: true, onlineCount: getOnlineCount(req.params.roomId), users: getOnlineUsers(req.params.roomId) });
});

export default router;
