/**
 * LTX-Video 推理后端实现
 *
 * 封装与 ltx-video-server Python 微服务的交互，实现 InferenceBackend 接口。
 * - DURATION_TO_FRAMES 作为后端特有能力（通过 getCapabilities 暴露，消除主服务硬编码）
 * - getModels 动态拉取（消除与 server.py 的 MODEL_CONFIGS 重复定义）
 * - 轮询逻辑保留在 backend 内部
 *
 * ltxVideoService.ts 改为本 backend 的薄 facade，保留旧导出签名向后兼容。
 */
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  InferenceBackend,
  InferenceTaskParams,
  InferenceTaskStatus,
  InferenceModelInfo,
  InferenceCapabilities,
} from './types.js';
import { addToVideoHistory } from '../videoHistoryService.js';
import {
  setTaskProgress,
  getTaskProgress,
  updateTaskProgress,
  removeTaskProgress,
} from '../videoTaskProgressService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const imagesDir = path.join(__dirname, '../../public/images');

/** 时长（秒）到 LTX-Video 帧数的映射（30fps，LTX 特有，属后端能力） */
const DURATION_TO_FRAMES: Record<string, { numFrames: number; width: number; height: number }> = {
  '5': { numFrames: 121, width: 768, height: 512 },
  '10': { numFrames: 257, width: 768, height: 512 },
  '15': { numFrames: 421, width: 640, height: 416 },
  '18': { numFrames: 511, width: 640, height: 416 },
};

/** 内置 fallback 模型列表（getModels 拉取失败时使用） */
const FALLBACK_MODELS: Record<string, InferenceModelInfo> = {
  'ltxv-2b-distilled': { id: 'ltxv-2b-distilled', name: 'LTX-Video 2B 蒸馏版', minVramGb: 6, description: '低显存，快速' },
  'ltxv-2b-dev': { id: 'ltxv-2b-dev', name: 'LTX-Video 2B 开发版', minVramGb: 8, description: '低显存，高质量' },
  'ltxv-13b-distilled': { id: 'ltxv-13b-distilled', name: 'LTX-Video 13B 蒸馏版', minVramGb: 10, description: '速度与质量平衡' },
  'ltxv-13b-distilled-fp8': { id: 'ltxv-13b-distilled-fp8', name: 'LTX-Video 13B 蒸馏 FP8', minVramGb: 8, description: 'RTX 4090 推荐' },
  'ltxv-13b-dev': { id: 'ltxv-13b-dev', name: 'LTX-Video 13B 开发版', minVramGb: 16, description: '最高质量' },
};

export class LtxBackend implements InferenceBackend {
  readonly name = 'ltx';
  private serverUrl: string;
  private modelsCache: Record<string, InferenceModelInfo> | null = null;
  private modelsCacheTime = 0;
  private static readonly MODELS_CACHE_TTL = 60_000; // 1 分钟

  constructor(serverUrl?: string) {
    this.serverUrl = serverUrl || process.env.LTX_SERVER_URL || 'http://localhost:8000';
  }

  getCapabilities(): InferenceCapabilities {
    return {
      supportsImageToVideo: true,
      supportsNegativePrompt: true,
      maxDurationSec: 18,
      supportedResolutions: [
        { width: 768, height: 512 },
        { width: 640, height: 416 },
      ],
      durationToFrames: DURATION_TO_FRAMES,
    };
  }

  async healthCheck(): Promise<{ available: boolean; error?: string; details?: Record<string, any> }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.serverUrl}/health`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        return { available: false, error: `LTX 服务返回 ${response.status}` };
      }

      const data = (await response.json()) as Record<string, any>;
      return {
        available: true,
        details: {
          cudaAvailable: data.cuda_available,
          gpuName: data.gpu_name,
          gpuMemoryGb: data.gpu_memory_gb,
          ltxVideoInstalled: data.ltx_video_installed,
          defaultModel: data.default_model,
          activeTasks: data.active_tasks,
        },
      };
    } catch (error) {
      return { available: false, error: `无法连接 LTX 服务: ${(error as Error).message}` };
    }
  }

  async getModels(): Promise<Record<string, InferenceModelInfo>> {
    // 缓存命中
    if (this.modelsCache && Date.now() - this.modelsCacheTime < LtxBackend.MODELS_CACHE_TTL) {
      return this.modelsCache;
    }

    try {
      const response = await fetch(`${this.serverUrl}/models`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const data = (await response.json()) as { models: Record<string, any>; default?: string };
        const models: Record<string, InferenceModelInfo> = {};
        for (const [id, cfg] of Object.entries(data.models || {})) {
          const c = cfg as any;
          models[id] = {
            id,
            name: c.name || id,
            minVramGb: c.min_vram_gb,
            description: c.description,
          };
        }
        this.modelsCache = models;
        this.modelsCacheTime = Date.now();
        return models;
      }
    } catch {
      /* 拉取失败，使用 fallback */
    }

    this.modelsCache = FALLBACK_MODELS;
    this.modelsCacheTime = Date.now();
    return FALLBACK_MODELS;
  }

  async startTask(params: InferenceTaskParams): Promise<{
    success: boolean;
    taskId?: string;
    error?: string;
    message?: string;
  }> {
    const { prompt, style = '', duration = '10', model = 'ltxv-2b-distilled', seed } = params;

    // 验证时长（LTX-Video 适合短视频，限制在 maxDurationSec 以内）
    const targetDuration = parseInt(duration);
    if (targetDuration > this.getCapabilities().maxDurationSec) {
      return {
        success: false,
        error: `LTX-Video 本地模型仅支持 ${this.getCapabilities().maxDurationSec} 秒以内的视频。更长的视频请使用 Agnes Video API。`,
      };
    }

    const caps = this.getCapabilities();
    const frameConfig = caps.durationToFrames?.[duration] || caps.durationToFrames?.['5'];
    if (!frameConfig) {
      return { success: false, error: `不支持的时长: ${duration}` };
    }

    // 组合提示词
    const fullPrompt = style ? `${prompt}，${style}` : prompt;

    console.log(`[LTX-Backend] Creating task: prompt="${fullPrompt.substring(0, 80)}", duration=${duration}s, model=${model}`);

    try {
      const response = await fetch(`${this.serverUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: fullPrompt,
          model,
          width: frameConfig.width,
          height: frameConfig.height,
          num_frames: frameConfig.numFrames,
          frame_rate: 30,
          seed: seed || Math.floor(Math.random() * 1000000),
          offload_to_cpu: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let errorData: Record<string, any> = {};
        try {
          errorData = errorText ? JSON.parse(errorText) : {};
        } catch {
          errorData = { rawResponse: errorText.substring(0, 200) };
        }
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

      const taskId = ltxTaskId; // 与 videoTaskProgress 兼容的 taskId 格式

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
        await this.pollLtxTask(taskId, ltxTaskId, prompt, style, duration);
      }, 100);

      const models = await this.getModels();
      return {
        success: true,
        taskId,
        message: `LTX-Video 本地生成任务已创建（模型: ${models[model]?.name || model}）`,
      };
    } catch (error) {
      console.error(`[LTX-Backend] Create task error: ${error}`);
      return {
        success: false,
        error: `创建 LTX 视频任务失败: ${(error as Error).message}`,
      };
    }
  }

  async queryStatus(taskId: string): Promise<{
    success: boolean;
    status?: InferenceTaskStatus;
    error?: string;
  }> {
    const progressInfo = getTaskProgress(taskId);
    if (!progressInfo) {
      return {
        success: false,
        error: 'LTX 任务记录不存在或已过期，请重新生成',
      };
    }

    const status: InferenceTaskStatus = {
      status: progressInfo.status,
      progress: progressInfo.progress || 0,
      videoUrl: progressInfo.videoUrl,
      error: progressInfo.error,
    };

    // 完成或失败后延迟清理进度记录
    if (progressInfo.status === 'completed' || progressInfo.status === 'failed') {
      setTimeout(() => removeTaskProgress(taskId), 5 * 60 * 1000);
    }

    return { success: true, status };
  }

  async cancelTask(taskId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // 调用 LTX 服务删除任务
      await fetch(`${this.serverUrl}/task/${taskId}`, { method: 'DELETE' });
      removeTaskProgress(taskId);
      return { success: true };
    } catch (error) {
      return { success: false, error: `取消任务失败: ${(error as Error).message}` };
    }
  }

  /** 后台轮询 LTX 服务任务状态（从 ltxVideoService 迁移） */
  private async pollLtxTask(
    taskId: string,
    ltxTaskId: string,
    prompt: string,
    style: string,
    duration: string,
  ): Promise<void> {
    const maxPolls = 120; // 最多轮询 120 次（10分钟）
    const pollInterval = 5000; // 5秒一次

    console.log(`[LTX-Backend] Background polling started for task ${taskId}`);

    for (let i = 0; i < maxPolls; i++) {
      try {
        // 检查任务是否已被取消
        const taskStatus = getTaskProgress(taskId);
        if (taskStatus?.status === 'cancelled') {
          console.log(`[LTX-Backend] Task ${taskId} was cancelled, stopping background poll`);
          return;
        }

        await new Promise(r => setTimeout(r, pollInterval));

        const response = await fetch(`${this.serverUrl}/status/${ltxTaskId}`);
        if (!response.ok) {
          console.error(`[LTX-Backend] Status check failed: ${response.status}`);
          continue;
        }

        const statusData = (await response.json()) as Record<string, any>;
        console.log(`[LTX-Backend] Poll ${i + 1}: status=${statusData.status}, progress=${statusData.progress || 0}%`);

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
          console.log(`[LTX-Backend] Task ${taskId} completed, downloading video...`);

          const videoResponse = await fetch(`${this.serverUrl}/video/${ltxTaskId}`);
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

          console.log(`[LTX-Backend] Task ${taskId} video saved: ${savedUrl}`);
          return;
        }

        // 任务失败
        if (statusData.status === 'failed') {
          console.error(`[LTX-Backend] Task ${taskId} failed: ${statusData.error}`);
          setTaskProgress(taskId, {
            progress: 0,
            status: 'failed',
            error: statusData.error || 'LTX 视频生成失败',
            taskType: 'normal',
          });
          return;
        }
      } catch (error) {
        console.error(`[LTX-Backend] Poll error (attempt ${i + 1}): ${error}`);
      }
    }

    // 超时
    console.error(`[LTX-Backend] Task ${taskId} timed out after ${(maxPolls * pollInterval) / 1000}s`);
    setTaskProgress(taskId, {
      progress: 0,
      status: 'failed',
      error: 'LTX 视频生成超时（超过10分钟）',
      taskType: 'normal',
    });
  }
}
