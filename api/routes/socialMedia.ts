/**
 * 自媒体平台发布路由 (Social Media Publishing Routes)
 *
 * 提供抖音/快手/小红书的授权、内容发布、发布历史等 API 端点。
 */

import { Router, type Request, type Response } from 'express';
import { socialMediaService } from '../services/socialMediaService.js';
import { scheduledPublishService } from '../services/scheduledPublishService.js';
import type { SocialPlatform, PublishContent } from '../services/socialMediaService.js';

const router = Router();

// ==================== 平台配置 ====================

/** GET /api/social/config — 获取所有平台配置 */
router.get('/config', (req: Request, res: Response) => {
  const configs = socialMediaService.getAllPlatformConfigs();
  res.json({ success: true, data: configs });
});

/** GET /api/social/config/:platform — 获取指定平台配置 */
router.get('/config/:platform', (req: Request, res: Response) => {
  const platform = req.params.platform as SocialPlatform;
  const config = socialMediaService.getPlatformConfig(platform);
  if (!config) {
    res.status(404).json({ success: false, error: `不支持的平台: ${platform}` });
    return;
  }
  res.json({ success: true, data: config });
});

// ==================== OAuth 授权 ====================

/** GET /api/social/auth/:platform — 生成 OAuth 授权 URL */
router.get('/auth/:platform', (req: Request, res: Response) => {
  const { platform } = req.params as { platform: SocialPlatform };
  const { redirectUri, state } = req.query;

  if (!redirectUri || !state) {
    res.status(400).json({ success: false, error: 'redirectUri and state are required' });
    return;
  }

  try {
    const authUrl = socialMediaService.generateAuthUrl(platform, redirectUri as string, state as string);
    res.json({ success: true, data: { authUrl } });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/** POST /api/social/auth/:platform/callback — OAuth 回调处理 */
router.post('/auth/:platform/callback', (req: Request, res: Response) => {
  const { platform } = req.params as { platform: SocialPlatform };
  const { code, openId, userId } = req.body;

  if (!code) {
    res.status(400).json({ success: false, error: 'code is required' });
    return;
  }

  // Mock: 模拟 Token 换取
  const mockToken = {
    platform,
    accessToken: `mock_access_token_${platform}_${Date.now()}`,
    refreshToken: `mock_refresh_token_${platform}_${Date.now()}`,
    expiresAt: Date.now() + 7200 * 1000, // 2 小时
    openId: openId || `mock_openid_${platform}`,
    userId: userId || 'default',
    scope: ['user_info', 'video.publish', 'video.upload', 'data.read'],
  };

  socialMediaService.saveToken(mockToken);

  res.json({
    success: true,
    data: {
      platform,
      expiresAt: mockToken.expiresAt,
      scope: mockToken.scope,
    },
  });
});

/** GET /api/social/auth/:platform/status — 检查授权状态 */
router.get('/auth/:platform/status', (req: Request, res: Response) => {
  const { platform } = req.params as { platform: SocialPlatform };
  const { userId } = req.query;
  const isValid = socialMediaService.isTokenValid(platform, userId as string);
  res.json({ success: true, data: { platform, authorized: isValid } });
});

/** POST /api/social/auth/:platform/revoke — 撤销授权 */
router.post('/auth/:platform/revoke', (req: Request, res: Response) => {
  const { platform } = req.params as { platform: SocialPlatform };
  const { userId } = req.body;
  const revoked = socialMediaService.revokeToken(platform, userId as string);
  res.json({
    success: true,
    data: { platform, revoked, message: revoked ? '已解绑' : '未找到授权记录' },
  });
});

// ==================== 内容发布 ====================

/** POST /api/social/publish/:platform — 发布内容到指定平台 */
router.post('/publish/:platform', async (req: Request, res: Response) => {
  const { platform } = req.params as { platform: SocialPlatform };
  const { content, userId } = req.body as { content: PublishContent; userId?: string };

  if (!content || !content.title) {
    res.status(400).json({ success: false, error: 'content.title is required' });
    return;
  }

  // 验证内容
  const validation = socialMediaService.validateContent(platform, content);
  if (!validation.valid) {
    res.status(400).json({ success: false, errors: validation.errors });
    return;
  }

  const result = await socialMediaService.publishToPlatform(platform, content, userId);
  res.status(result.success ? 200 : 400).json({ success: result.success, data: result });
});

/** POST /api/social/publish — 一键发布到多个平台 */
router.post('/publish', async (req: Request, res: Response) => {
  const { platforms, content, userId } = req.body as {
    platforms: SocialPlatform[];
    content: PublishContent;
    userId?: string;
  };

  if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
    res.status(400).json({ success: false, error: 'platforms is required (non-empty array)' });
    return;
  }

  if (!content || !content.title) {
    res.status(400).json({ success: false, error: 'content.title is required' });
    return;
  }

  const results = await socialMediaService.publishToMultiple(platforms, content, userId);

  const allSuccess = Object.values(results).every((r) => r.success);
  res.status(allSuccess ? 200 : 207).json({
    success: allSuccess,
    data: {
      results,
      publishedCount: Object.values(results).filter((r) => r.success).length,
      totalCount: platforms.length,
    },
  });
});

// ==================== 发布历史 ====================

/** GET /api/social/history — 获取发布历史 */
router.get('/history', (req: Request, res: Response) => {
  const { platform } = req.query;
  const history = socialMediaService.getPublishHistory(platform as SocialPlatform | undefined);
  res.json({
    success: true,
    data: {
      history,
      total: history.length,
      successCount: history.filter((r) => r.success).length,
    },
  });
});

/** GET /api/social/health — 服务健康检查 */
router.get('/health', (req: Request, res: Response) => {
  const configs = socialMediaService.getAllPlatformConfigs();
  const authStatus = configs.map((c) => ({
    platform: c.platform,
    name: c.name,
    authorized: socialMediaService.isTokenValid(c.platform),
  }));

  res.json({
    success: true,
    status: 'healthy',
    platforms: authStatus,
  });
});

// ==================== 定时发布调度 ====================

/** POST /api/social/schedule — 创建定时发布任务 */
router.post('/schedule', (req: Request, res: Response) => {
  const { platforms, content, intervalMinutes, userId } = req.body as {
    platforms: SocialPlatform[];
    content: PublishContent;
    intervalMinutes: number;
    userId?: string;
  };

  if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
    res.status(400).json({ success: false, error: 'platforms is required (non-empty array)' });
    return;
  }

  if (!content || !content.title) {
    res.status(400).json({ success: false, error: 'content.title is required' });
    return;
  }

  if (!intervalMinutes || intervalMinutes < 10) {
    res.status(400).json({ success: false, error: 'intervalMinutes must be >= 10' });
    return;
  }

  const task = scheduledPublishService.createTask(platforms, content, intervalMinutes, userId);
  res.status(201).json({ success: true, data: task });
});

/** GET /api/social/schedules — 获取所有定时任务 */
router.get('/schedules', (req: Request, res: Response) => {
  const tasks = scheduledPublishService.getAllTasks();
  res.json({ success: true, data: tasks });
});

/** GET /api/social/schedule/:id — 获取单个定时任务 */
router.get('/schedule/:id', (req: Request, res: Response) => {
  const task = scheduledPublishService.getTask(req.params.id);
  if (!task) {
    res.status(404).json({ success: false, error: '任务不存在' });
    return;
  }
  res.json({ success: true, data: task });
});

/** PATCH /api/social/schedule/:id — 更新定时任务（启用/暂停/修改间隔） */
router.patch('/schedule/:id', (req: Request, res: Response) => {
  const { enabled, intervalMinutes, content } = req.body as {
    enabled?: boolean;
    intervalMinutes?: number;
    content?: Partial<PublishContent>;
  };

  const task = scheduledPublishService.updateTask(req.params.id, { enabled, intervalMinutes, content });
  if (!task) {
    res.status(404).json({ success: false, error: '任务不存在' });
    return;
  }
  res.json({ success: true, data: task });
});

/** DELETE /api/social/schedule/:id — 删除定时任务 */
router.delete('/schedule/:id', (req: Request, res: Response) => {
  const deleted = scheduledPublishService.deleteTask(req.params.id);
  if (!deleted) {
    res.status(404).json({ success: false, error: '任务不存在' });
    return;
  }
  res.json({ success: true, data: { deleted: true } });
});

/** POST /api/social/schedule/:id/run — 立即执行一次定时任务 */
router.post('/schedule/:id/run', async (req: Request, res: Response) => {
  const result = await scheduledPublishService.executeTaskNow(req.params.id);
  if (!result.success && result.results.error === '任务不存在') {
    res.status(404).json({ success: false, error: '任务不存在' });
    return;
  }
  res.json({ success: result.success, data: result.results });
});

export default router;