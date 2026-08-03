/**
 * 免费视频生成服务
 * 1. 智谱 CogVideoX-Flash — 完全免费，异步 API
 * 2. 通义万相视频生成 — 新用户 50 秒免费额度，异步 API
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { checkQuota, recordUsage } from './quotaService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, '../config.json');

/** 加载用户自定义的 API Key 配置（config.json 优先级高于 .env） */
function loadVideoConfig(): Record<string, any> {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch {}
  return {}
}

/** 获取视频模型的 API Key（config.json > .env） */
function getVideoApiKey(model: string): string | undefined {
  const config = loadVideoConfig()
  if (model === 'cogvideox' && config.models?.['cogvideox-flash']?.apiKey) {
    return config.models['cogvideox-flash'].apiKey
  }
  if (model === 'wanx-video' && config.models?.['wanx-video']?.apiKey) {
    return config.models['wanx-video'].apiKey
  }
  if (model === 'seedance' && config.models?.seedance?.apiKey) {
    return config.models.seedance.apiKey
  }
  return undefined
}

// ========== 智谱 CogVideoX-Flash (完全免费) ==========

const ZHIPU_VIDEO_API = 'https://open.bigmodel.cn/api/paas/v4/videos/generations';
const ZHIPU_VIDEO_RESULT_API = 'https://open.bigmodel.cn/api/paas/v4/async-result';

export async function generateZhipuVideo(params: {
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  duration?: number;
}): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const apiKey = getVideoApiKey('cogvideox') || process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return { success: false, error: '未配置智谱 API Key' };
  }

  try {
    const body: Record<string, any> = {
      model: 'cogvideox-flash',
      prompt: params.prompt,
      size: '960x960',
    };

    // 支持多张参考图（取首图，CogVideoX 主要只用一张）
    const imgUrl = params.imageUrls?.[0] || params.imageUrl;
    if (imgUrl) {
      body.image_url = imgUrl;
    }

    // 添加 30 秒超时
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(ZHIPU_VIDEO_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json() as Record<string, any>;

    if (!response.ok) {
      return { success: false, error: data.error?.message || `智谱视频API失败 (${response.status})` };
    }

    const taskId = data.id || data.task_id;
    if (!taskId) {
      return { success: false, error: '智谱视频API未返回任务ID' };
    }

    console.log(`[ZhipuVideo] Task created: ${taskId}`);
    return { success: true, taskId };
  } catch (error) {
    return { success: false, error: `智谱视频API异常: ${(error as Error).message}` };
  }
}

export async function checkZhipuVideoStatus(taskId: string): Promise<{
  success: boolean;
  status: string;
  videoUrl?: string;
  error?: string;
}> {
  const apiKey = getVideoApiKey('cogvideox') || process.env.ZHIPU_API_KEY;
  if (!apiKey) return { success: false, status: 'failed', error: '无 API Key' };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const response = await fetch(`${ZHIPU_VIDEO_RESULT_API}/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await response.json() as Record<string, any>;

    if (!response.ok) {
      return { success: false, status: 'failed', error: data.error?.message || `查询失败 (${response.status})` };
    }

    const taskStatus = data.task_status || data.status || 'processing';

    if (taskStatus === 'SUCCESS' || taskStatus === 'success') {
      const videoResult = data.video_result || data.video_url;
      const videoUrl = Array.isArray(videoResult)
        ? videoResult[0]?.url
        : typeof videoResult === 'string'
          ? videoResult
          : videoResult?.url;
      return { success: true, status: 'completed', videoUrl };
    }

    if (taskStatus === 'FAIL' || taskStatus === 'fail' || taskStatus === 'failed') {
      return { success: false, status: 'failed', error: data.error?.message || '视频生成失败' };
    }

    return { success: true, status: 'processing' };
  } catch (error) {
    return { success: false, status: 'failed', error: (error as Error).message };
  }
}

// ========== 通义万相视频生成 (50秒免费额度) ==========

const WANX_VIDEO_API = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';

export async function generateWanxVideo(params: {
  prompt: string;
  duration?: number;
  style?: string;
}): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const apiKey = getVideoApiKey('wanx-video') || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return { success: false, error: '未配置阿里百炼 DashScope API Key' };
  }

  try {
    const body: Record<string, any> = {
      model: 'wan2.6-t2v',
      input: {
        prompt: params.prompt,
      },
      parameters: {
        duration: params.duration || 5,
        n: 1,
      },
    };

    const response = await fetch(WANX_VIDEO_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as Record<string, any>;

    if (!response.ok) {
      return { success: false, error: data.message || data.error || `万相视频API失败 (${response.status})` };
    }

    const taskId = data.output?.task_id || data.task_id;
    if (!taskId) {
      return { success: false, error: '万相视频API未返回任务ID' };
    }

    console.log(`[WanxVideo] Task created: ${taskId}`);
    return { success: true, taskId };
  } catch (error) {
    return { success: false, error: `万相视频API异常: ${(error as Error).message}` };
  }
}

export async function checkWanxVideoStatus(taskId: string): Promise<{
  success: boolean;
  status: string;
  videoUrl?: string;
  error?: string;
}> {
  const apiKey = getVideoApiKey('wanx-video') || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return { success: false, status: 'failed', error: '无 API Key' };

  try {
    // DashScope 异步任务查询端点
    const response = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const data = await response.json() as Record<string, any>;

    if (!response.ok) {
      return { success: false, status: 'failed', error: data.message || `查询失败 (${response.status})` };
    }

    const taskStatus = data.output?.task_status || 'PENDING';

    if (taskStatus === 'SUCCEEDED') {
      const videoUrl = data.output?.video_url || data.output?.results?.[0]?.video_url;
      return { success: true, status: 'completed', videoUrl };
    }

    if (taskStatus === 'FAILED') {
      return { success: false, status: 'failed', error: data.output?.message || '视频生成失败' };
    }

    return { success: true, status: 'processing' };
  } catch (error) {
    return { success: false, status: 'failed', error: (error as Error).message };
  }
}

// ========== 完整生成流程 ==========

export type FreeVideoModel = 'cogvideox' | 'wanx-video' | 'seedance';

/**
 * 创建免费视频任务
 */
// 免费视频引擎并发控制：避免同时提交过多任务触发 API 限流
const FREE_VIDEO_CONCURRENT_LIMIT = 2;
let freeVideoActiveCount = 0;
const freeVideoQueue: Array<() => void> = [];

async function acquireFreeVideoSlot(): Promise<void> {
  if (freeVideoActiveCount < FREE_VIDEO_CONCURRENT_LIMIT) {
    freeVideoActiveCount++;
    return;
  }
  return new Promise<void>(resolve => {
    freeVideoQueue.push(() => {
      freeVideoActiveCount++;
      resolve();
    });
  });
}

function releaseFreeVideoSlot(): void {
  freeVideoActiveCount = Math.max(0, freeVideoActiveCount - 1);
  if (freeVideoQueue.length > 0) {
    const next = freeVideoQueue.shift()!;
    // 使用 setImmediate 避免递归调用栈溢出
    setImmediate(next);
  }
}

export async function createFreeVideoTask(params: {
  model: FreeVideoModel;
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  duration?: number;
  style?: string;
}): Promise<{ success: boolean; taskId?: string; error?: string }> {
  // 配额检查
  const quotaMap: Record<string, string> = {
    cogvideox: 'cogvideox-flash',
    'wanx-video': 'wanx-video',
    seedance: 'seedance',
  }
  const quotaKey = quotaMap[params.model]
  if (quotaKey) {
    const quotaCheck = checkQuota(quotaKey)
    if (!quotaCheck.allowed) {
      return { success: false, error: quotaCheck.reason || '额度不足' }
    }
  }

  await acquireFreeVideoSlot();

  try {
    let result: { success: boolean; taskId?: string; error?: string }

    if (params.model === 'cogvideox') {
      result = await generateZhipuVideo({
        prompt: params.prompt,
        imageUrl: params.imageUrl,
        imageUrls: params.imageUrls,
        duration: params.duration,
      })
    } else if (params.model === 'wanx-video') {
      result = await generateWanxVideo({
        prompt: params.prompt,
        duration: params.duration || 5,
        style: params.style,
      })
    } else if (params.model === 'seedance') {
      result = await generateSeedanceVideo(params)
    } else {
      return { success: false, error: `不支持的模型: ${params.model}` }
    }

    // 任务创建成功后记录使用
    if (result.success && quotaKey) {
      recordUsage(quotaKey)
    }

    return result
  } finally {
    releaseFreeVideoSlot();
  }
}

// ========== Seedance 2.0 (火山引擎 ARK) ==========

const SEEDANCE_API = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
const SEEDANCE_MODEL = 'doubao-seedance-2-0-260128'; // 标准版，也可用 Fast 版 doubao-seedance-2-0-250428

export async function generateSeedanceVideo(params: {
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  duration?: number;
}): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const apiKey = getVideoApiKey('seedance') || process.env.SEEDANCE_API_KEY;
  if (!apiKey) {
    return { success: false, error: '未配置 Seedance API Key' };
  }

  try {
    const allImageUrls = params.imageUrls || (params.imageUrl ? [params.imageUrl] : []);
    const firstImage = allImageUrls[0];

    // 解析完整 URL
    let imageRagUrl = '';
    if (firstImage) {
      imageRagUrl = firstImage.startsWith('/')
        ? `http://localhost:${process.env.PORT || '3001'}${firstImage}`
        : firstImage;
    }

    const body: Record<string, any> = {
      model: SEEDANCE_MODEL,
      resolution: '1080p',
      ratio: '16:9',
      duration: Math.min(Math.max(params.duration || 5, 5), 15), // 支持 5/10/15 秒
      watermark: false,
    };

    // 图生视频模式：图片放在 image 顶层字段
    if (imageRagUrl) {
      body.image = { image_url: imageRagUrl };
    }
    body.content = [{ type: 'text', text: params.prompt }];

    const response = await fetch(SEEDANCE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as Record<string, any>;

    if (!response.ok) {
      return { success: false, error: data.message || data.error?.message || `Seedance API失败 (${response.status})` };
    }

    const taskId = data.id;
    if (!taskId) {
      return { success: false, error: 'Seedance API未返回任务ID' };
    }

    console.log(`[Seedance] Task created: ${taskId}`);
    return { success: true, taskId };
  } catch (error) {
    return { success: false, error: `Seedance API异常: ${(error as Error).message}` };
  }
}

export async function checkSeedanceStatus(taskId: string): Promise<{
  success: boolean;
  status: string;
  videoUrl?: string;
  error?: string;
}> {
  const apiKey = getVideoApiKey('seedance') || process.env.SEEDANCE_API_KEY;
  if (!apiKey) return { success: false, status: 'failed', error: '无 API Key' };

  try {
    const response = await fetch(`${SEEDANCE_API}/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const data = await response.json() as Record<string, any>;

    if (!response.ok) {
      return { success: false, status: 'failed', error: data.message || `查询失败 (${response.status})` };
    }

    const taskStatus = data.status || 'queued';

    if (taskStatus === 'succeeded') {
      // Seedance 可能返回不同格式的 content：数组、对象、或直接 URL
      let videoUrl = data.video_url || '';
      const rawContent = data.content;
      
      if (Array.isArray(rawContent)) {
        const videoContent = rawContent.find((c: any) => c.type === 'video' || c.video_url);
        videoUrl = videoContent?.video_url || videoContent?.url || videoUrl;
      } else if (rawContent && typeof rawContent === 'object') {
        videoUrl = rawContent.video_url || rawContent.url || videoUrl;
      } else if (typeof rawContent === 'string' && rawContent.startsWith('http')) {
        videoUrl = rawContent;
      }
      
      if (videoUrl) {
        return { success: true, status: 'completed', videoUrl };
      }
      return { success: false, status: 'failed', error: '视频URL未找到' };
    }

    if (taskStatus === 'failed' || taskStatus === 'expired' || taskStatus === 'canceled') {
      return { success: false, status: 'failed', error: data.error?.message || `任务${taskStatus}` };
    }

    return { success: true, status: 'processing' };
  } catch (error) {
    return { success: false, status: 'failed', error: (error as Error).message };
  }
}

/**
 * 查询免费视频任务状态（支持 cogvideox / wanx-video / seedance）
 */
export async function checkFreeVideoStatus(model: FreeVideoModel, taskId: string) {
  if (model === 'cogvideox') {
    return checkZhipuVideoStatus(taskId);
  }
  if (model === 'wanx-video') {
    return checkWanxVideoStatus(taskId);
  }
  if (model === 'seedance') {
    return checkSeedanceStatus(taskId);
  }
  return { success: false, status: 'failed', error: `不支持的模型: ${model}` };
}
