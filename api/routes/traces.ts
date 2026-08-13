import { Router, type Request, type Response } from 'express';
import { getDb } from '../services/db/index.js';

const router = Router();

/**
 * Agent 调度链路追踪路由
 *
 * 端点：
 *   GET /api/traces          - 列表（支持 sessionId/status/limit/offset 筛选）
 *   GET /api/traces/:traceId - 详情（返回 trace + 关联 spans，按 startTime 排序）
 */

// Trace 列表
router.get('/', (req: Request, res: Response): void => {
  try {
    const { sessionId, status, limit, offset } = req.query;
    const traces = getDb().getTraces({
      sessionId: sessionId as string | undefined,
      status: status as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });
    res.json({ success: true, traces, total: traces.length });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `查询 traces 失败: ${(error as Error).message}`,
    });
  }
});

// Trace 详情（含 spans 调用树）
router.get('/:traceId', (req: Request, res: Response): void => {
  try {
    const { traceId } = req.params;
    const result = getDb().getTrace(traceId);
    if (!result) {
      res.status(404).json({ success: false, error: 'Trace 不存在' });
      return;
    }
    res.json({ success: true, trace: result.trace, spans: result.spans });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `查询 trace 详情失败: ${(error as Error).message}`,
    });
  }
});

export default router;
