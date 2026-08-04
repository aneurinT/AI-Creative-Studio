/**
 * LLM 模型统一配置
 * 所有服务通过这里获取模型和 API 地址，方便切换供应商
 * 默认全部使用免费模型，付费模型作为备选
 *
 * 架构说明：
 *   - 推理模型（Reasoning Model）：用于需要深度思考的任务（意图分析、审核、复杂决策）
 *     如 DeepSeek-R1、GLM-Z1，会自动进行 chain-of-thought 推理
 *   - 指令模型（Instruction Model）：用于简单任务（参数提取、格式转换）
 *     如 glm-4-flash、deepseek-chat
 */

// ============================================================
// 推理模型（Reasoning Models）— 免费，适合深度思考
// ============================================================

/** DeepSeek-R1 推理模型（免费，支持 64K 上下文，深度思考） */
export const REASONING_MODEL = 'deepseek-reasoner';
export const REASONING_API = 'https://api.deepseek.com/v1/chat/completions';
export function getReasoningApiKey(): string | undefined {
  return process.env.DEEPSEEK_API_KEY;
}

/** 智谱 GLM-Z1 推理模型（免费，国产推理模型备选） */
export const REASONING_FALLBACK_MODEL = 'glm-z1-flash';
export const REASONING_FALLBACK_API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
export function getReasoningFallbackApiKey(): string | undefined {
  return process.env.ZHIPU_API_KEY;
}

// ============================================================
// 指令模型（Instruction Models）— 免费，适合快速响应
// ============================================================

// 意图识别（聊天入口）— 默认智谱 glm-4-flash 免费，DeepSeek 备选
export const CHAT_MODEL = 'glm-4-flash';
export const CHAT_API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
export function getChatApiKey(): string | undefined {
  return process.env.ZHIPU_API_KEY || process.env.DEEPSEEK_API_KEY;
}

// DeepSeek 备选（当智谱不可用时自动降级）
export const CHAT_FALLBACK_MODEL = 'deepseek-chat';
export const CHAT_FALLBACK_API = 'https://api.deepseek.com/v1/chat/completions';
export function getChatFallbackApiKey(): string | undefined {
  return process.env.DEEPSEEK_API_KEY;
}

// 视频 Agent（脚本创作、分镜、审核）— 智谱 glm-4-flash 免费
export const VIDEO_MODEL = 'glm-4-flash';
export const VIDEO_API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
export function getVideoApiKey(): string | undefined {
  return process.env.ZHIPU_API_KEY;
}

// Embedding — 智谱 embedding-2
export const EMBED_MODEL = 'embedding-2';
export const EMBED_API = 'https://open.bigmodel.cn/api/paas/v4/embeddings';

// 图片理解（视觉）— 智谱 glm-4v-flash 免费
export const VISION_MODEL = 'glm-4v-flash';
export const VISION_API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

// 审核 — 智谱 glm-4-flash 免费
export const REVIEW_MODEL = 'glm-4-flash';
