/**
 * 办公工具集成路由 (Office Tools Integration Routes)
 *
 * 提供钉钉/飞书/企业微信的消息发送、任务通知、Webhook 管理等 API 端点。
 */

import { Router, type Request, type Response } from 'express';
import { officeService } from '../services/officeService.js';
import type { OfficePlatform, SendMessageRequest, OfficeMessage, MessageType } from '../services/officeService.js';

const router = Router();

// ==================== 平台配置 ====================

/** GET /api/office/config — 获取所有平台配置 */
router.get('/config', (req: Request, res: Response) => {
  const configs = officeService.getAllPlatformConfigs();
  res.json({ success: true, data: configs });
});

/** GET /api/office/config/:platform — 获取指定平台配置 */
router.get('/config/:platform', (req: Request, res: Response) => {
  const platform = req.params.platform as OfficePlatform;
  const config = officeService.getPlatformConfig(platform);
  if (!config) {
    res.status(404).json({ success: false, error: `不支持的平台: ${platform}` });
    return;
  }
  res.json({ success: true, data: config });
});

// ==================== 消息发送 ====================

/** POST /api/office/send/:platform — 发送消息到指定平台 */
router.post('/send/:platform', async (req: Request, res: Response) => {
  const { platform } = req.params as { platform: OfficePlatform };
  const { target, message } = req.body as { target: SendMessageRequest['target']; message: OfficeMessage };

  if (!message) {
    res.status(400).json({ success: false, error: 'message is required' });
    return;
  }

  const request: SendMessageRequest = { platform, target, message };
  const result = await officeService.sendMessage(request);

  res.status(result.success ? 200 : 400).json({ success: result.success, data: result });
});

/** POST /api/office/send — 批量发送消息到多个平台 */
router.post('/send', async (req: Request, res: Response) => {
  const { platforms, target, message } = req.body as {
    platforms: OfficePlatform[];
    target: SendMessageRequest['target'];
    message: OfficeMessage;
  };

  if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
    res.status(400).json({ success: false, error: 'platforms is required (non-empty array)' });
    return;
  }

  if (!message) {
    res.status(400).json({ success: false, error: 'message is required' });
    return;
  }

  const results = await officeService.sendToMultiple(platforms, { target, message });

  const allSuccess = Object.values(results).every((r) => r.success);
  res.status(allSuccess ? 200 : 207).json({
    success: allSuccess,
    data: {
      results,
      sentCount: Object.values(results).filter((r) => r.success).length,
      totalCount: platforms.length,
    },
  });
});

// ==================== 任务通知 ====================

/** POST /api/office/notify/task-complete — AI 任务完成通知 */
router.post('/notify/task-complete', async (req: Request, res: Response) => {
  const { platforms, taskInfo } = req.body as {
    platforms: OfficePlatform[];
    taskInfo: {
      taskType: 'image' | 'video';
      taskId: string;
      title: string;
      resultUrl?: string;
      duration?: string;
    };
  };

  if (!platforms || !taskInfo) {
    res.status(400).json({ success: false, error: 'platforms and taskInfo are required' });
    return;
  }

  const results = await officeService.notifyTaskComplete(platforms, taskInfo);

  const allSuccess = Object.values(results).every((r) => r.success);
  res.status(allSuccess ? 200 : 207).json({
    success: allSuccess,
    data: { results },
  });
});

// ==================== 消息模板 ====================

/** POST /api/office/preview — 预览消息模板渲染效果 */
router.post('/preview', (req: Request, res: Response) => {
  const { platform, msgType, params } = req.body as {
    platform: OfficePlatform;
    msgType: MessageType;
    params: Record<string, string>;
  };

  if (!platform || !msgType) {
    res.status(400).json({ success: false, error: 'platform and msgType are required' });
    return;
  }

  const config = officeService.getPlatformConfig(platform);
  if (!config) {
    res.status(404).json({ success: false, error: `不支持的平台: ${platform}` });
    return;
  }

  if (!config.supportedMessageTypes.includes(msgType)) {
    res.status(400).json({
      success: false,
      error: `${platform} 不支持消息类型: ${msgType}`,
      supportedTypes: config.supportedMessageTypes,
    });
    return;
  }

  // 根据参数生成消息预览
  let preview: any = {};
  switch (msgType) {
    case 'text':
      preview = {
        msgType: 'text',
        content: { text: params.text || '这是一条测试消息' },
      };
      break;
    case 'markdown':
      preview = {
        msgType: 'markdown',
        content: {
          title: params.title || '消息标题',
          text: params.text || '### 这是一条 Markdown 消息\n\n- 项目 1\n- 项目 2',
        },
      };
      break;
    case 'news':
      preview = {
        msgType: 'news',
        content: {
          articles: [
            {
              title: params.title || '文章标题',
              description: params.description || '文章描述',
              url: params.url || 'https://example.com',
              picurl: params.picurl,
            },
          ],
        },
      };
      break;
    default:
      preview = { msgType, content: { text: '不支持预览的消息类型' } };
  }

  res.json({ success: true, data: { platform, preview } });
});

// ==================== 发送历史 ====================

/** GET /api/office/history — 获取发送历史 */
router.get('/history', (req: Request, res: Response) => {
  const { platform } = req.query;
  const history = officeService.getSendHistory(platform as OfficePlatform | undefined);
  res.json({
    success: true,
    data: {
      history,
      total: history.length,
      successCount: history.filter((r) => r.success).length,
    },
  });
});

/** GET /api/office/health — 服务健康检查 */
router.get('/health', (req: Request, res: Response) => {
  const configs = officeService.getAllPlatformConfigs();
  res.json({
    success: true,
    status: 'healthy',
    platforms: configs.map((c) => ({
      platform: c.platform,
      name: c.name,
      supportedMessageTypes: c.supportedMessageTypes,
    })),
  });
});

export default router;