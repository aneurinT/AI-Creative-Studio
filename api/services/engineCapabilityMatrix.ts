/**
 * 引擎能力标签矩阵
 *
 * 结构化标注每个视频/图片引擎的能力维度，
 * 供 Orchestrator 和前端做智能引擎推荐。
 */

export type EngineCategory = 'video' | 'image';

export type VideoStyle =
  | 'cinematic' | 'realistic' | 'anime' | 'cartoon'
  | 'product' | 'landscape' | 'portrait' | 'abstract'
  | 'social_media' | 'long_form';

export interface EngineCapability {
  /** 引擎标识（与 video.ts 的 engine 选择一致） */
  id: string;
  /** 显示名称 */
  displayName: string;
  /** 引擎类别 */
  category: EngineCategory;
  /** 是否需要 API Key */
  requiresApiKey: boolean;
  /** 对应的环境变量名 */
  envKey: string;

  // —— 视频能力 ——
  /** 最大视频时长（秒） */
  maxDurationSec?: number;
  /** 支持的分辨率列表 */
  resolutions?: string[];
  /** 帧率 */
  frameRate?: number;
  /** 是否支持原生音频 */
  nativeAudio?: boolean;
  /** 是否支持图生视频 */
  imageToVideo?: boolean;
  /** 是否支持首尾帧控制 */
  firstLastFrame?: boolean;
  /** 是否免费 */
  free?: boolean;

  // —— 风格擅长点（评分 0-10）——
  styleStrengths?: Partial<Record<VideoStyle, number>>;

  // —— 其他特性 ——
  /** 生成速度评分（1-10，10 最快） */
  speedScore?: number;
  /** 画质评分（1-10） */
  qualityScore?: number;
  /** 描述 */
  description?: string;
}

// ======================== 引擎能力矩阵 ========================

export const ENGINE_CAPABILITY_MATRIX: EngineCapability[] = [
  {
    id: 'agnes',
    displayName: 'Agnes Video V2.0',
    category: 'video',
    requiresApiKey: true,
    envKey: 'AGNES_VIDEO_API_KEY',
    maxDurationSec: 18,
    resolutions: ['1080p', '720p', '480p'],
    frameRate: 24,
    nativeAudio: false,
    imageToVideo: false,
    firstLastFrame: false,
    free: false,
    styleStrengths: {
      cinematic: 8, realistic: 7, anime: 6, product: 7,
      landscape: 8, portrait: 7, social_media: 6, long_form: 5,
    },
    speedScore: 5,
    qualityScore: 8,
    description: '高质量通用视频生成，支持 1080p，但限流严格（2次/分钟）',
  },
  {
    id: 'cogvideox-flash',
    displayName: '智谱 CogVideoX-Flash',
    category: 'video',
    requiresApiKey: true,
    envKey: 'ZHIPU_API_KEY',
    maxDurationSec: 6,
    resolutions: ['1080p'],
    frameRate: 24,
    nativeAudio: false,
    imageToVideo: false,
    firstLastFrame: false,
    free: true,
    styleStrengths: {
      cinematic: 5, realistic: 6, anime: 7, cartoon: 8,
      product: 6, landscape: 5, portrait: 6, social_media: 8,
    },
    speedScore: 7,
    qualityScore: 6,
    description: '免费快速生成，适合短视频和动画风格，限流宽松',
  },
  {
    id: 'cogvideox-3',
    displayName: '智谱 CogVideoX-3',
    category: 'video',
    requiresApiKey: true,
    envKey: 'ZHIPU_API_KEY',
    maxDurationSec: 10,
    resolutions: ['1080p'],
    frameRate: 24,
    nativeAudio: false,
    imageToVideo: true,
    firstLastFrame: false,
    free: false,
    styleStrengths: {
      cinematic: 7, realistic: 7, anime: 7, product: 7,
      landscape: 6, portrait: 7, social_media: 7, long_form: 6,
    },
    speedScore: 6,
    qualityScore: 7,
    description: '付费版，支持图生视频，画质和时长优于 Flash 版',
  },
  {
    id: 'wanx-video',
    displayName: '通义万相视频',
    category: 'video',
    requiresApiKey: true,
    envKey: 'DASHSCOPE_API_KEY',
    maxDurationSec: 10,
    resolutions: ['1080p'],
    frameRate: 24,
    nativeAudio: false,
    imageToVideo: true,
    firstLastFrame: false,
    free: false,
    styleStrengths: {
      cinematic: 6, realistic: 7, anime: 6, product: 8,
      landscape: 7, portrait: 6, social_media: 7, long_form: 5,
    },
    speedScore: 6,
    qualityScore: 7,
    description: '阿里云通义万相，产品展示和广告风格表现优秀',
  },
  {
    id: 'seedance',
    displayName: 'Seedance 2.0',
    category: 'video',
    requiresApiKey: true,
    envKey: 'SEEDANCE_API_KEY',
    maxDurationSec: 10,
    resolutions: ['1080p', '720p'],
    frameRate: 24,
    nativeAudio: true,
    imageToVideo: true,
    firstLastFrame: true,
    free: false,
    styleStrengths: {
      cinematic: 9, realistic: 8, anime: 7, product: 7,
      landscape: 8, portrait: 9, social_media: 7, long_form: 7,
    },
    speedScore: 5,
    qualityScore: 9,
    description: '火山方舟 Seedance 2.0，支持原生音频和首尾帧，电影级画质',
  },
  {
    id: 'ltx',
    displayName: 'LTX-Video（本地 GPU）',
    category: 'video',
    requiresApiKey: false,
    envKey: 'LTX_SERVER_URL',
    maxDurationSec: 18,
    resolutions: ['720p', '480p'],
    frameRate: 24,
    nativeAudio: false,
    imageToVideo: true,
    firstLastFrame: false,
    free: true,
    styleStrengths: {
      cinematic: 6, realistic: 6, anime: 5, product: 5,
      landscape: 6, portrait: 5, social_media: 6, long_form: 4,
    },
    speedScore: 4,
    qualityScore: 5,
    description: '本地 GPU 推理，无需 API Key，隐私安全但需 GPU 环境',
  },

  // —— 图片引擎 ——
  {
    id: 'trae',
    displayName: 'Trae AI 内置图片',
    category: 'image',
    requiresApiKey: false,
    envKey: '',
    resolutions: ['1024x1024', '1024x1792', '1792x1024'],
    free: true,
    styleStrengths: {
      realistic: 7, product: 7, landscape: 7, portrait: 7,
      social_media: 8, abstract: 6,
    },
    speedScore: 8,
    qualityScore: 7,
    description: '内置图片生成，无需配置，快速出图',
  },
  {
    id: 'wanx',
    displayName: '通义万相',
    category: 'image',
    requiresApiKey: true,
    envKey: 'DASHSCOPE_API_KEY',
    resolutions: ['1024*1024', '1024*1792', '1792*1024'],
    free: false,
    styleStrengths: {
      realistic: 8, product: 9, landscape: 7, portrait: 8,
      abstract: 7, social_media: 7,
    },
    speedScore: 7,
    qualityScore: 8,
    description: '阿里云通义万相，产品/广告图片表现优秀',
  },
  {
    id: 'cogview',
    displayName: '智谱 CogView-4',
    category: 'image',
    requiresApiKey: true,
    envKey: 'ZHIPU_API_KEY',
    resolutions: ['1024*1024', '1024*1792', '1792*1024'],
    free: false,
    styleStrengths: {
      realistic: 7, anime: 8, cartoon: 9, landscape: 7,
      portrait: 7, abstract: 8, social_media: 7,
    },
    speedScore: 7,
    qualityScore: 7,
    description: '智谱 CogView，动漫/卡通风格擅长',
  },
  {
    id: 'volcengine',
    displayName: '火山方舟 Seedream',
    category: 'image',
    requiresApiKey: true,
    envKey: 'VOLCENGINE_API_KEY',
    resolutions: ['1024*1024', '1024*1792', '1792*1024'],
    free: false,
    styleStrengths: {
      realistic: 9, cinematic: 8, portrait: 9, landscape: 8,
      product: 8, social_media: 7,
    },
    speedScore: 6,
    qualityScore: 9,
    description: '火山方舟 Seedream，写实/人像画质最佳',
  },
];

// ======================== 风格关键词映射 ========================

const STYLE_KEYWORD_MAP: Record<string, VideoStyle[]> = {
  '电影': ['cinematic'],
  '影院': ['cinematic'],
  '大片': ['cinematic'],
  'cinematic': ['cinematic'],
  '写实': ['realistic'],
  '真实': ['realistic'],
  '照片': ['realistic'],
  'realistic': ['realistic'],
  '动漫': ['anime'],
  '二次元': ['anime'],
  'anime': ['anime'],
  '卡通': ['cartoon'],
  'cartoon': ['cartoon'],
  '产品': ['product'],
  '商品': ['product'],
  '广告': ['product'],
  'product': ['product'],
  '风景': ['landscape'],
  '自然': ['landscape'],
  '航拍': ['landscape'],
  'landscape': ['landscape'],
  '人像': ['portrait'],
  '人物': ['portrait'],
  'portrait': ['portrait'],
  '抽象': ['abstract'],
  '艺术': ['abstract'],
  'abstract': ['abstract'],
  '短视频': ['social_media'],
  '抖音': ['social_media'],
  '快手': ['social_media'],
  '小红书': ['social_media'],
  '社媒': ['social_media'],
  '长视频': ['long_form'],
  '故事': ['long_form'],
  '叙事': ['long_form'],
};

// ======================== 引擎推荐逻辑 ========================

export interface EngineRecommendation {
  engine: string;
  score: number;
  reason: string;
}

/**
 * 根据 prompt 语义和用户需求推荐最优视频引擎
 *
 * 评分维度：
 * 1. 风格匹配度（prompt 关键词 → 风格 → 引擎擅长评分）
 * 2. 时长需求（引擎 maxDuration >= 用户需求）
 * 3. 可用性（API Key 是否配置）
 * 4. 画质/速度偏好
 */
export function recommendEngine(
  prompt: string,
  options: {
    duration?: number;
    preferQuality?: boolean;
    preferSpeed?: boolean;
    preferFree?: boolean;
    requireAudio?: boolean;
    requireImageToVideo?: boolean;
  } = {},
): EngineRecommendation[] {
  const {
    duration = 10,
    preferQuality = false,
    preferSpeed = false,
    preferFree = false,
    requireAudio = false,
    requireImageToVideo = false,
  } = options;

  const lowerPrompt = prompt.toLowerCase();

  // 1. 从 prompt 中提取风格关键词
  const detectedStyles = new Set<VideoStyle>();
  for (const [keyword, styles] of Object.entries(STYLE_KEYWORD_MAP)) {
    if (lowerPrompt.includes(keyword.toLowerCase())) {
      styles.forEach((s) => detectedStyles.add(s));
    }
  }

  // 2. 筛选可用引擎并评分
  const candidates = ENGINE_CAPABILITY_MATRIX.filter((e) => e.category === 'video');

  const scored = candidates
    .filter((e) => {
      if (e.maxDurationSec !== undefined && e.maxDurationSec < duration) return false;
      if (requireAudio && !e.nativeAudio) return false;
      if (requireImageToVideo && !e.imageToVideo) return false;
      // 检查 API Key 是否配置
      if (e.requiresApiKey && e.envKey) {
        if (!process.env[e.envKey]) return false;
      }
      return true;
    })
    .map((e) => {
      let score = 50;
      const reasons: string[] = [];

      // 风格匹配评分（权重 30%）
      if (e.styleStrengths && detectedStyles.size > 0) {
        let styleScore = 0;
        let matchCount = 0;
        for (const style of detectedStyles) {
          const strength = e.styleStrengths[style] || 0;
          if (strength > 0) {
            styleScore += strength;
            matchCount++;
          }
        }
        if (matchCount > 0) {
          const avgStyleScore = styleScore / matchCount;
          score += avgStyleScore * 3;
          reasons.push(`风格匹配(${avgStyleScore.toFixed(1)})`);
        }
      }

      // 画质评分（权重 20%）
      if (preferQuality && e.qualityScore !== undefined) {
        score += e.qualityScore * 2;
        reasons.push(`画质(${e.qualityScore})`);
      }

      // 速度评分（权重 20%）
      if (preferSpeed && e.speedScore !== undefined) {
        score += e.speedScore * 2;
        reasons.push(`速度(${e.speedScore})`);
      }

      // 免费优先（权重 15%）
      if (preferFree && e.free) {
        score += 15;
        reasons.push('免费');
      }

      // 原生音频加分
      if (e.nativeAudio) {
        score += 5;
        reasons.push('原生音频');
      }

      // 图生视频加分
      if (e.imageToVideo) {
        score += 3;
        reasons.push('支持图生视频');
      }

      // 时长富余度加分
      if (e.maxDurationSec && e.maxDurationSec >= duration + 5) {
        score += 5;
        reasons.push('时长充足');
      }

      return {
        engine: e.id,
        score: Math.round(score),
        reason: reasons.join(', ') || '默认推荐',
      };
    })
    .sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * 获取引擎能力详情
 */
export function getEngineCapability(engineId: string): EngineCapability | undefined {
  return ENGINE_CAPABILITY_MATRIX.find((e) => e.id === engineId);
}

/**
 * 列出所有可用引擎（API Key 已配置）
 */
export function listAvailableEngines(category?: EngineCategory): EngineCapability[] {
  return ENGINE_CAPABILITY_MATRIX.filter((e) => {
    if (category && e.category !== category) return false;
    if (e.requiresApiKey && e.envKey && !process.env[e.envKey]) return false;
    return true;
  });
}
