/**
 * LTX-Video 服务客户端（facade，向后兼容层）
 *
 * 原直接调用 Python 微服务的逻辑已迁移至 LtxBackend（./inference/ltxBackend.ts）。
 * 本文件保留旧导出函数签名，内部委托给 inferenceRegistry，
 * 保证现有调用方零改动。
 *
 * DURATION_TO_FRAMES / LTX_MODELS 硬编码已删除：
 * - DURATION_TO_FRAMES → LtxBackend.getCapabilities().durationToFrames
 * - LTX_MODELS → LtxBackend.getModels() 动态拉取
 */
import { inferenceRegistry } from './inference/index.js';

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

/** 获取 LTX 后端实例（若未注册则抛错） */
function getLtxBackend() {
  return inferenceRegistry.get('ltx');
}

/** 检查 LTX-Video 服务是否可用（保持原扁平返回结构） */
export async function checkLtxHealth(): Promise<{
  available: boolean;
  cudaAvailable?: boolean;
  gpuName?: string;
  gpuMemoryGb?: number;
  ltxVideoInstalled?: boolean;
  error?: string;
}> {
  const result = await getLtxBackend().healthCheck();
  return {
    available: result.available,
    error: result.error,
    cudaAvailable: result.details?.cudaAvailable,
    gpuName: result.details?.gpuName,
    gpuMemoryGb: result.details?.gpuMemoryGb,
    ltxVideoInstalled: result.details?.ltxVideoInstalled,
  };
}

/** 获取可用模型列表（保持原 {name, min_vram_gb, description} 结构） */
export async function getLtxModels(): Promise<
  Record<string, { name: string; min_vram_gb: number; description: string }>
> {
  const models = await getLtxBackend().getModels();
  const result: Record<string, { name: string; min_vram_gb: number; description: string }> = {};
  for (const [id, m] of Object.entries(models)) {
    result[id] = {
      name: m.name,
      min_vram_gb: m.minVramGb || 0,
      description: m.description || '',
    };
  }
  return result;
}

/** 创建 LTX-Video 生成任务（透传至后端 startTask） */
export async function createLtxVideoTask(params: LtxGenerateParams): Promise<LtxTaskResult> {
  return getLtxBackend().startTask(params);
}
