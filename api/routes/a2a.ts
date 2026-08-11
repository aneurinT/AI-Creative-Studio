/**
 * A2A (Agent-to-Agent) Protocol Routes
 *
 * 基于 Google A2A v1.0 规范的 REST API 端点。
 * 提供 Agent Card 发现、Task 创建/查询/取消等能力。
 */

import { Router, type Request, type Response } from 'express';
import { a2aService } from '../services/a2aService.js';

const router = Router();

const getBaseUrl = (req: Request): string => {
  return `${req.protocol}://${req.get('host') || 'localhost:3001'}`;
};

// ==================== Agent Card ====================

/** GET /.well-known/agent-card.json — Agent 发现端点 */
router.get('/.well-known/agent-card.json', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  const agentCard = a2aService.generateAgentCard(baseUrl);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(agentCard);
});

/** GET /api/a2a/agent-card — Agent Card 别名 */
router.get('/agent-card', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  const agentCard = a2aService.generateAgentCard(baseUrl);
  res.json({ success: true, data: agentCard });
});

// ==================== Task API ====================

/** POST /api/a2a/tasks — 创建新 Task */
router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const { message, sessionId, acceptedOutputModes, metadata } = req.body;

    if (!message || !message.parts || !Array.isArray(message.parts)) {
      res.status(400).json({ success: false, error: 'Invalid message format. Expected { message: { parts: [...] } }' });
      return;
    }

    const task = await a2aService.createTask({
      sessionId,
      message: {
        messageId: message.messageId || `msg-${Date.now()}`,
        role: message.role || 'user',
        parts: message.parts,
        metadata: message.metadata,
      },
      acceptedOutputModes,
      metadata,
    });

    res.status(201).json({ success: true, task });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/a2a/tasks — 列出所有 Task（支持过滤） */
router.get('/tasks', (req: Request, res: Response) => {
  const { sessionId, state } = req.query;
  const tasks = a2aService.listTasks({
    sessionId: sessionId as string | undefined,
    state: state as any,
  });

  res.json({
    success: true,
    tasks,
    stats: a2aService.getTaskStats(),
  });
});

/** GET /api/a2a/tasks/:taskId — 获取单个 Task 状态 */
router.get('/tasks/:taskId', (req: Request, res: Response) => {
  const task = a2aService.getTask(req.params.taskId);

  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found' });
    return;
  }

  res.json({ success: true, task });
});

/** DELETE /api/a2a/tasks/:taskId — 取消 Task */
router.delete('/tasks/:taskId', (req: Request, res: Response) => {
  const cancelled = a2aService.cancelTask(req.params.taskId);

  if (!cancelled) {
    res.status(404).json({ success: false, error: 'Task not found or already completed' });
    return;
  }

  const task = a2aService.getTask(req.params.taskId);
  res.json({ success: true, task });
});

/** POST /api/a2a/tasks/:taskId/messages — 向 Task 追加消息 */
router.post('/tasks/:taskId/messages', (req: Request, res: Response) => {
  const { message } = req.body;
  const taskId = req.params.taskId;

  const task = a2aService.getTask(taskId);
  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found' });
    return;
  }

  if (['completed', 'failed', 'canceled'].includes(task.status.state)) {
    res.status(400).json({ success: false, error: `Cannot add message to ${task.status.state} task` });
    return;
  }

  const added = a2aService.addMessage(taskId, {
    messageId: message.messageId || `msg-${Date.now()}`,
    role: message.role || 'user',
    parts: message.parts || [],
    metadata: message.metadata,
  });

  if (!added) {
    res.status(500).json({ success: false, error: 'Failed to add message' });
    return;
  }

  res.json({ success: true, task: a2aService.getTask(taskId) });
});

/** GET /api/a2a/tasks/:taskId/artifacts — 获取 Task 产物 */
router.get('/tasks/:taskId/artifacts', (req: Request, res: Response) => {
  const task = a2aService.getTask(req.params.taskId);

  if (!task) {
    res.status(404).json({ success: false, error: 'Task not found' });
    return;
  }

  res.json({ success: true, artifacts: task.artifacts || [] });
});

/** GET /api/a2a/stats — 获取 A2A 服务统计 */
router.get('/stats', (req: Request, res: Response) => {
  res.json({ success: true, stats: a2aService.getTaskStats() });
});

/** GET /api/a2a/health — A2A 服务健康检查 */
router.get('/health', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  res.json({
    success: true,
    status: 'healthy',
    protocolVersion: '1.0',
    agentCard: `${baseUrl}/.well-known/agent-card.json`,
    tasksEndpoint: `${baseUrl}/api/a2a/tasks`,
    stats: a2aService.getTaskStats(),
  });
});

export default router;