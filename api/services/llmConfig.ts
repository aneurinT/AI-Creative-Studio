/**
 * LLM 模型统一配置
 * 所有服务通过这里获取模型和 API 地址，方便切换供应商
 * 默认全部使用免费模型，付费模型作为备选
 */

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
