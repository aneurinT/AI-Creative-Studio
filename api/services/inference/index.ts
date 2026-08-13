/**
 * 推理后端初始化模块
 *
 * 启动时根据环境变量注册启用的后端：
 * - LTX_ENABLED（默认 true）→ 注册 LtxBackend
 * - INFERENCE_DEFAULT_BACKEND（默认 ltx）→ 设为默认后端
 *
 * 未来扩展 SVD 后端时，在此处按 SVD_ENABLED 注册即可。
 */
import { inferenceRegistry } from './registry.js';
import { LtxBackend } from './ltxBackend.js';

export function initInferenceBackends(): void {
  const defaultBackend = process.env.INFERENCE_DEFAULT_BACKEND || 'ltx';

  // 注册 LTX 后端（默认启用）
  if (process.env.LTX_ENABLED !== 'false') {
    const ltx = new LtxBackend();
    inferenceRegistry.register(ltx, defaultBackend === 'ltx');
  }

  // 未来扩展：SVD（Stable Video Diffusion）后端
  // if (process.env.SVD_ENABLED === 'true') {
  //   const { SvdBackend } = await import('./svdBackend.js');
  //   inferenceRegistry.register(new SvdBackend(), defaultBackend === 'svd');
  // }

  if (!inferenceRegistry.hasAny()) {
    console.warn('[Inference] 未注册任何推理后端，本地视频生成功能将不可用');
  } else {
    console.log(`[Inference] 推理后端初始化完成，可用: ${inferenceRegistry.list().join(', ')}`);
  }
}

// 重新导出，方便其他模块统一从 inference/index.js 导入
export { inferenceRegistry } from './registry.js';
export type {
  InferenceBackend,
  InferenceTaskParams,
  InferenceTaskStatus,
  InferenceModelInfo,
  InferenceCapabilities,
} from './types.js';
