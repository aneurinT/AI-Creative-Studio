import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addToVideoHistory } from './videoHistoryService.js';
import { setTaskProgress, getTaskProgress, updateTaskProgress, removeTaskProgress } from './videoTaskProgressService.js';

/**
 * LTX-Video 本地推理服务客户端
 *
 * 负责与 ltx-video-server Python 微服务通信，
 * 将本地生成的视频下载到 public/images 供前端访问。
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LTX_SERVER_URL = process.env.LTX_SERVER_URL || 'http://localhost:8000';
const imagesDir = path.join(__dirname, '../public/images');

/** 时长（秒）到 LTX-Video 帧数的映射（30fps） */
const DURATION_TO_FRAMES: Record<string, { num_frames: number; width: number; height: number }> = {
  '5': { num_frames: 121, width: 768, height: 512 },
  '10': { num_frames: 257, width: 768, height: 512 },
  '15': { num_frames: 421, width: 640, height: 416 },
  '18': { num_frames: 511, width: 640, height: 416 },
};

/** 可选模型列表 */
const LTX_MODELS: Record<string, { name: string; min_vram_gb: number; description: string }> = {
  'ltxv-2b-distilled': { name: 'LTX-Video 2B 蒸馏版', min_vram_gb: 6, description: '低显存，快速' },
  'ltxv-2b-dev': { name: 'LTX-Video 2B 开发版', min_vram_gb: 8, description: '低显存，高质量' },
  'ltxv-13b-distilled': { name: 'LTX-Video 13B 蒸馏版', min_vram_gb: 10, description: '速度与质量平衡' },
  'ltxv-13b-distilled-fp8': { name: 'LTX-Video 13B 蒸馏 FP8', min_vram_gb: 8, description: 'RTX 4090 推荐' },
  'ltxv-13b-dev': { name: 'LTX-Video 13B 开发版', min_vram_gb: 16, description: '最高质量' },
};

export interface LtxGenerateParams {
  prompt: string;
  style?: string;
  duration?: string;
  model?: string;
  seed?: number;
}

export interface LtxTaskResult {
  success: boolean;
  taskId?: string;
  error?: string;
  message?: string;
}

/** 检查 LTX-Video 服务是否可用 */
export async function checkLtxHealth(): Promise<{
  available: boolean;
  cudaAvailable?: boolean;
  gpuName?: string;
  gpuMemoryGb?: number;
  ltxVideoInstalled?: boolean;
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${LTX_SERVER_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { available: false, error: `LTX 服务返回 ${response.status}` };
    }

    const data = (await response.json()) as Record<string, any>;
    return {
      available: true,
      cudaAvailable: data.cuda_available,
      gpuName: data.gpu_name,
      gpuMemoryGb: data.gpu_memory_gb,
      ltxVideoInstalled: data.ltx_video_installed,
    };
  } catch (error) {
    return {
      available: false,
      error: `无法连接 LTX 服务: ${(error as Error).message}`,
    };
  }
}

/** 获取可用模型列表 */
export function getLtxModels() {
  return LTX_MODELS;
}

/**
 * 创建 LTX-Video 生成任务（异步）
 * 立即返回 taskId，后台轮询 LTX 服务获取结果
 */
export async function createLtxVideoTask(params: LtxGenerateParams): Promise<LtxTaskResult> {
  const { prompt, style = '', duration = '5', model = 'ltxv-2b-distilled', seed } = params;

  // 验证时长（LTX-Video 适合短视频，限制在18秒以内）
  const targetDuration = parseInt(duration);
  if (targetDuration > 18) {
    return {
      success: false,
      error: 'LTX-Video 本地模型仅支持18秒以内的视频。更长的视频请使用 Agnes Video API。',
    };
  }

  const frameConfig = DURATION_TO_FRAMES[duration] || DURATION_TO_FRAMES['5'];

  // 组合提示词
  const fullPrompt = style ? `${prompt}，${style}` : prompt;

  console.log(`[LTX-Video] Creating task: prompt="${fullPrompt.substring(0, 80)}", duration=${duration}s, model=${model}`);

  try {
    // 向 Python 微服务提交生成任务
    const response = await fetch(`${LTX_SERVER_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: fullPrompt,
        model,
        width: frameConfig.width,
        height: frameConfig.height,
        num_frames: frameConfig.num_frames,
        frame_rate: 30,
        seed: seed || Math.floor(Math.random() * 1000000),
        offload_to_cpu: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      let errorData: Record<string, any> = {};
      try { errorData = errorText ? JSON.parse(errorText) : {} } catch { errorData = { rawResponse: errorText.substring(0, 200) } }
      return {
        success: false,
        error: errorData.detail || `LTX 服务返回错误: ${response.status}`,
      };
    }

    const data = (await response.json()) as Record<string, any>;
    const ltxTaskId = data.task_id as string;

    if (!ltxTaskId) {
      return { success: false, error: 'LTX 服务未返回任务ID' };
    }

    // 使用统一的 taskId 格式（ltx_ 前缀，与 videoTaskProgress 兼容）
    const taskId = ltxTaskId;

    // 初始化持久化进度记录
    setTaskProgress(taskId, {
      progress: 0,
      status: 'processing',
      taskType: 'normal',
      prompt,
      style,
      duration,
    });

    // 后台轮询 LTX 服务状态
    setTimeout(async () => {
      await pollLtxTask(taskId, ltxTaskId, prompt, style, duration);
    }, 100);

    return {
      success: true,
      taskId,
      message: `LTX-Video 本地生成任务已创建（模型: ${LTX_MODELS[model]?.name || model}）`,
    };
  } catch (error) {
    console.error(`[LTX-Video] Create task error: ${error}`);
    return {
      success: false,
      error: `创建 LTX 视频任务失败: ${(error as Error).message}`,
    };
  }
}

/** 后台轮询 LTX 服务任务状态 */
async function pollLtxTask(
  taskId: string,
  ltxTaskId: string,
  prompt: string,
  style: string,
  duration: string,
) {
  const maxPolls = 120; // 最多轮询 120 次（10分钟）
  const pollInterval = 5000; // 5秒一次

  console.log(`[LTX-Video] Background polling started for task ${taskId}`);

  for (let i = 0; i < maxPolls; i++) {
    try {
      // 检查任务是否已被取消
      const taskStatus = getTaskProgress(taskId)
      if (taskStatus?.status === 'cancelled') {
        console.log(`[LTX-Video] Task ${taskId} was cancelled, stopping background poll`)
        return
      }

      await new Promise((r) => setTimeout(r, pollInterval));

      const response = await fetch(`${LTX_SERVER_URL}/status/${ltxTaskId}`);

      if (!response.ok) {
        console.error(`[LTX-Video] Status check failed: ${response.status}`);
        continue;
      }

      const statusData = (await response.json()) as Record<string, any>;
      console.log(`[LTX-Video] Poll ${i + 1}: status=${statusData.status}, progress=${statusData.progress || 0}%`);

      // 更新进度
      const progressMap: Record<string, number> = {
        processing: 20,
        loading_model: 30,
        preparing: 40,
        generating: 60,
        finalizing: 90,
      };
      const currentProgress = statusData.progress || progressMap[statusData.status] || Math.min(10 + i * 2, 85);
      updateTaskProgress(taskId, { progress: currentProgress });

      // 任务完成
      if (statusData.status === 'completed') {
        console.log(`[LTX-Video] Task ${taskId} completed, downloading video...`);

        // 从 LTX 服务下载视频文件
        const videoResponse = await fetch(`${LTX_SERVER_URL}/video/${ltxTaskId}`);
        if (!videoResponse.ok) {
          setTaskProgress(taskId, {
            progress: 0,
            status: 'failed',
            error: '下载视频文件失败',
            taskType: 'normal',
          });
          return;
        }

        const arrayBuffer = await videoResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // 保存到 public/images（异步写入，避免阻塞事件循环）
        await fs.promises.mkdir(imagesDir, { recursive: true });
        const videoFileName = `${Date.now()}.mp4`;
        const videoPath = path.join(imagesDir, videoFileName);
        await fs.promises.writeFile(videoPath, buffer);
        const savedUrl = `/images/${videoFileName}`;

        // 添加到历史记录
        addToVideoHistory({
          prompt,
          style,
          duration: `${duration}秒 (LTX本地)`,
          videoUrl: savedUrl,
        });

        setTaskProgress(taskId, {
          progress: 100,
          status: 'completed',
          videoUrl: savedUrl,
          taskType: 'normal',
        });

        console.log(`[LTX-Video] Task ${taskId} video saved: ${savedUrl}`);
        return;
      }

      // 任务失败
      if (statusData.status === 'failed') {
        console.error(`[LTX-Video] Task ${taskId} failed: ${statusData.error}`);
        setTaskProgress(taskId, {
          progress: 0,
          status: 'failed',
          error: statusData.error || 'LTX 视频生成失败',
          taskType: 'normal',
        });
        return;
      }
    } catch (error) {
      console.error(`[LTX-Video] Poll error (attempt ${i + 1}): ${error}`);
    }
  }

  // 超时
  console.error(`[LTX-Video] Task ${taskId} timed out after ${maxPolls * pollInterval / 1000}s`);
  setTaskProgress(taskId, {
    progress: 0,
    status: 'failed',
    error: 'LTX 视频生成超时（超过10分钟）',
    taskType: 'normal',
  });
}
