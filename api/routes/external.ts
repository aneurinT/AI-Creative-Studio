/**
 * 外部 SaaS API 路由
 *
 * 目标：将 Agent 编排能力封装为对外 API，提供按调用量计费的 SaaS 模式
 *
 * 依赖：
 *  - 已有 quotaService 作为配额/计费基础
 *  - 编排器 orchestrator 的 runOrchestration 一体化入口
 *
 * 鉴权：
 *  - 使用 X-API-Key 请求头（由外部系统为每个租户分配）
 *  - 与内部 JWT 鉴权分离，形成独立的对外开放通道
 */

import { Router, type Request, type Response } from 'express';
import { runOrchestration } from '../services/orchestrator.js';
import { checkQuota, recordUsage } from '../services/quotaService.js';

const router = Router();

// 外部 API Key 存储（实际生产可对接数据库）
// 格式：{ apiKey: { tenantId, name, tier, rateLimitPerMin } }
const apiKeys = new Map<string, { tenantId: string; name: string; tier: 'free' | 'pro' | 'enterprise'; rateLimitPerMin: number }>();

// 内存中简单的速率限制：apiKey → 最近一分钟内的调用次数
const rateLimitMap = new Map<string, Array<number>>();

// 初始化一些示例外部 API Key（生产应从数据库加载）
function initDefaultKeys(): void {
  const preset = process.env.SAAS_API_KEYS;
  if (preset) {
    preset.split(',').forEach((pair, idx) => {
      const [key, tier] = pair.split(':');
      if (key) {
        apiKeys.set(key.trim(), {
          tenantId: `tenant_${idx}`,
          name: `租户${idx + 1}`,
          tier: (tier as any) || 'free',
          rateLimitPerMin: tier === 'pro' ? 30 : tier === 'enterprise' ? 100 : 10,
        });
      }
    });
  }
}
initDefaultKeys();

// ======================== 鉴权中间件 ========================

function authenticateSaaS(req: Request, res: Response, next: () => void): void {
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) {
    res.status(401).json({ success: false, error: '缺少 X-API-Key' });
    return;
  }

  const tenant = apiKeys.get(apiKey);
  if (!tenant) {
    res.status(401).json({ success: false, error: '无效的 API Key' });
    return;
  }

  // 速率限制检查
  const now = Date.now();
  const windowStart = now - 60_000;
  const timestamps = (rateLimitMap.get(apiKey) || []).filter((t) => t > windowStart);
  if (timestamps.length >= tenant.rateLimitPerMin) {
    res.status(429).json({
      success: false,
      error: `请求过于频繁，每分钟最多 ${tenant.rateLimitPerMin} 次`,
      retryAfter: Math.ceil((timestamps[0] + 60_000 - now) / 1000),
    });
    return;
  }
  timestamps.push(now);
  rateLimitMap.set(apiKey, timestamps);

  // 配额检查（使用内部 quotaService）
  const quotaKey = `saas-${tenant.tier}`;
  const quota = checkQuota(quotaKey);
  if (!quota.allowed) {
    res.status(429).json({ success: false, error: '配额不足，请升级套餐或等待重置' });
    return;
  }

  (req as any).tenant = tenant;
  (req as any).apiKey = apiKey;
  next();
}

// ======================== 路由 ========================

/**
 * GET /api/external/status — 健康检查（无需鉴权）
 */
router.get('/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'Agent Orchestration SaaS API',
    version: '1.0.0',
    uptime: process.uptime(),
    tenants: apiKeys.size,
  });
});

/**
 * POST /api/external/orchestrate — 调用 Agent 编排（SaaS 主入口）
 *
 * Body:
 *  {
 *    "message": "帮我生成一张赛博朋克风格的海报",
 *    "context": { ... 可选的上下文 ... },
 *    "history": [... 可选的对话历史 ...]
 *  }
 */
router.post('/orchestrate', authenticateSaaS, async (req: Request, res: Response) => {
  try {
    const { message, context, history } = req.body || {};
    const tenant = (req as any).tenant;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ success: false, error: 'message 字段必填且为字符串' });
      return;
    }

    if (message.length > 5000) {
      res.status(400).json({ success: false, error: 'message 长度不能超过 5000 字符' });
      return;
    }

    const startTs = Date.now();
    const result = await runOrchestration({
      userMessage: message,
      userId: tenant.tenantId,
      history: history || [],
      imageContext: context?.imageContext,
      videoContext: context?.videoContext,
    });

    // 记录本次调用
    const quotaKey = `saas-${tenant.tier}`;
    recordUsage(quotaKey);

    // 计费事件（实际生产可对接 billing 服务）
    console.log(`[SaaS] orchestrate call | tenant=${tenant.tenantId} | tier=${tenant.tier} | duration=${Date.now() - startTs}ms | success=${result.success}`);

    res.json({
      success: result.success,
      traceId: result.traceId,
      durationMs: result.durationMs,
      output: result.output,
      error: result.error,
      billing: {
        tier: tenant.tier,
        unitPrice: getUnitPrice(tenant.tier),
        units: 1,
      },
    });
  } catch (error) {
    console.error('[SaaS] orchestrate error:', error);
    res.status(500).json({
      success: false,
      error: `编排执行异常: ${(error as Error).message}`,
    });
  }
});

/**
 * POST /api/external/image-to-image — 图生图 SaaS 端点
 */
router.post('/image-to-image', authenticateSaaS, async (req: Request, res: Response) => {
  try {
    const { sourceImage, instruction, style, model, size } = req.body || {};
    const tenant = (req as any).tenant;

    if (!sourceImage || !instruction) {
      res.status(400).json({ success: false, error: 'sourceImage 和 instruction 必填' });
      return;
    }

    // 复用内部多模态服务
    const { imageToImage } = await import('../services/multimodalService.js');
    const result = await imageToImage({ sourceImage, instruction, style, model, size });

    const quotaKey = `saas-${tenant.tier}`;
    recordUsage(quotaKey);

    res.json({
      success: result.success,
      imageUrl: result.imageUrl,
      sourceDescription: result.sourceDescription,
      finalPrompt: result.finalPrompt,
      error: result.error,
      billing: { tier: tenant.tier, unitPrice: getUnitPrice(tenant.tier), units: 1 },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/external/video-understand — 视频理解 SaaS 端点
 */
router.post('/video-understand', authenticateSaaS, async (req: Request, res: Response) => {
  try {
    const { videoUrl, mode, frameCount, focus } = req.body || {};
    const tenant = (req as any).tenant;

    if (!videoUrl) {
      res.status(400).json({ success: false, error: 'videoUrl 必填' });
      return;
    }

    const { understandVideo } = await import('../services/multimodalService.js');
    const result = await understandVideo({ videoUrl, mode, frameCount, focus });

    const quotaKey = `saas-${tenant.tier}`;
    recordUsage(quotaKey);

    res.json({
      ...result,
      billing: { tier: tenant.tier, unitPrice: getUnitPrice(tenant.tier), units: 1 },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/external/quota — 查询当前租户配额
 */
router.get('/quota', authenticateSaaS, (req: Request, res: Response) => {
  const tenant = (req as any).tenant;
  const quotaKey = `saas-${tenant.tier}`;
  const quota = checkQuota(quotaKey);
  res.json({
    tenantId: tenant.tenantId,
    tier: tenant.tier,
    quota,
  });
});

/**
 * POST /api/external/keys — 创建新的外部 API Key（管理操作）
 * 实际生产应加上更强的管理员鉴权
 */
router.post('/keys', (req: Request, res: Response) => {
  const { tenantId, name, tier = 'free' } = req.body || {};
  if (!tenantId || !name) {
    res.status(400).json({ success: false, error: 'tenantId 和 name 必填' });
    return;
  }
  const newKey = `sk-saas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  apiKeys.set(newKey, {
    tenantId,
    name,
    tier: tier as any,
    rateLimitPerMin: tier === 'pro' ? 30 : tier === 'enterprise' ? 100 : 10,
  });
  res.json({ success: true, apiKey: newKey, tenantId, name, tier });
});

/**
 * DELETE /api/external/keys/:key — 撤销 API Key
 */
router.delete('/keys/:key', (req: Request, res: Response) => {
  const key = req.params.key;
  if (apiKeys.delete(key)) {
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Key 不存在' });
  }
});

// ======================== 内部工具 ========================

function getUnitPrice(tier: string): number {
  switch (tier) {
    case 'pro': return 0.5;
    case 'enterprise': return 1.2;
    default: return 0.1;
  }
}

export default router;
