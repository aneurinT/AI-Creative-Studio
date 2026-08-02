/**
 * 分镜脚本检测与解析服务
 * 三层判断：正则快速检测 → AI 语义判断 → 结构化解析
 * 全部使用智谱免费模型
 */
import { fetchJSON } from './fetchUtils.js';

const ZHIPU_API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const MODEL = 'glm-4-flash';

// ========== 类型 ==========

export interface StoryboardScene {
  index: number;
  prompt: string;       // 英文生成 prompt
  description: string;  // 场景描述（中文）
  duration: number;     // 秒
  transition?: string;  // 过渡方式
  quality?: { score: number; issues: string[]; suggestions: string[] };
}

export interface StoryboardDetection {
  isStoryboard: boolean;
  confidence: number;        // 0-1
  source: 'regex' | 'ai' | 'none';
  scenes?: StoryboardScene[];
  summary?: string;          // 脚本概要
  warnings?: string[];       // 质量问题警告
  suggestions?: string[];    // 改进建议
  estimatedTotalDuration?: number;
}

// ========== 正则检测（毫秒级） ==========

const STORYBOARD_PATTERNS = [
  /^\d+[\.\)、\s:：-]/,           // 编号格式: 1. / 1) / 1、
  /^场景\s*\d+/i,                 // 场景N
  /^Scene\s*\d+/i,               // Scene N (英文)
  /^##?\s*\d+/,                   // Markdown 标题
  /^(开场|结尾|中段|高潮|过渡|转场)/,  // 中文叙事标记
  /^(opening|ending|climax|transition)/i, // 英文叙事标记
  /^\d+s\b|^\d+秒/,               // 时长标记
  /\b\d+\s*(秒|s)\b.*\b\d+\s*(秒|s)\b/, // 至少两处时长
];

/** 正则快速判断 + 解析 */
function regexDetect(text: string): StoryboardDetection | null {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;

  let matchCount = 0;
  for (const line of lines) {
    for (const pattern of STORYBOARD_PATTERNS) {
      if (pattern.test(line.trim())) { matchCount++; break; }
    }
  }

  const ratio = matchCount / lines.length;
  if (ratio < 0.3 && matchCount < 2) return null;

  const scenes = regexParseScenes(text);
  if (!scenes || scenes.length < 2) return null;

  const totalDuration = scenes.reduce((s, c) => s + c.duration, 0);

  return {
    isStoryboard: true,
    confidence: Math.min(ratio * 2, 0.85),
    source: 'regex',
    scenes,
    estimatedTotalDuration: totalDuration,
  };
}

function regexParseScenes(text: string): StoryboardScene[] | null {
  const lines = text.split('\n').filter(l => l.trim());
  const scenes: StoryboardScene[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    let desc = '';
    let duration = 10;

    const durMatch = trimmed.match(/(\d+)\s*秒|(\d+)\s*s\b/i);
    if (durMatch) {
      const d = parseInt(durMatch[1] || durMatch[2]);
      duration = Math.min(Math.max(d, 3), 30);
    }

    const numMatch = trimmed.match(/^(\d+)[\.\)、\s:：-]+(.+)/);
    const nameMatch = trimmed.match(/^场景\s*(\d+)[：:\s-]*(.+)/);
    const mdMatch = trimmed.match(/^##?\s*(\d+)[\s\.]+(.+)/);
    const labelMatch = trimmed.match(/^(开场|结尾|中段|高潮|过渡|转场|opening|ending|climax|transition)[：:\s-]*(.+)/i);

    const match = numMatch || nameMatch || mdMatch || labelMatch;
    if (match) {
      desc = (match[2] || '').replace(/\d+\s*秒|\d+\s*s\b/gi, '').trim();
      const prompt = desc.replace(/[。，！？、]/g, '').substring(0, 200);
      scenes.push({
        index: scenes.length + 1,
        prompt: prompt || desc,
        description: desc.substring(0, 50),
        duration,
      });
    } else if (trimmed.length > 10) {
      desc = trimmed.replace(/\d+\s*秒|\d+\s*s\b/gi, '').trim();
      scenes.push({
        index: scenes.length + 1,
        prompt: desc.substring(0, 200),
        description: desc.substring(0, 30),
        duration,
      });
    }
  }

  return scenes.length >= 2 ? scenes : null;
}

// ========== AI 深度判断 + 解析 ==========

/** 用智谱免费模型做深度判断 */
async function aiDetect(text: string): Promise<StoryboardDetection> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    // 无 Key → 回退正则
    const regexResult = regexDetect(text);
    return regexResult || { isStoryboard: false, confidence: 0, source: 'none' };
  }

  try {
    const data = await fetchJSON<{ choices: { message: { content: string } }[] }>(ZHIPU_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: `你是视频分镜脚本分析专家。分析用户输入的文本，判断是否为分镜脚本格式，并给出结构化解析和评估。

## 判断标准
分镜脚本特征（满足任3项即认为是）:
1. 有明确编号(1/2/3 或 场景1/场景2 或 Scene 1/Scene 2)
2. 每段有场景描述(画面/动作/运镜)
3. 有时长信息(5s/10秒)
4. 有多段(至少2段)
5. 有关键词: 开场/转场/高潮/ending/opening/climax

## 输出格式（严格JSON）
{
  "isStoryboard": true/false,
  "confidence": 0.85,
  "summary": "脚本概要（1句话）",
  "scenes": [
    {
      "index": 1,
      "description": "场景简述（中文,20字内）",
      "prompt": "英文视频prompt（含scene, action, camera, lighting关键要素）",
      "duration": 10,
      "transition": "过渡方式（可选）"
    }
  ],
  "warnings": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"],
  "estimatedTotalDuration": 45
}`,
          },
          {
            role: 'user',
            content: `请分析以下文本是否为分镜脚本，如果是请解析为结构化场景：\n\n${text.substring(0, 3000)}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      }),
    }, 15000);

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty AI response');

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in AI response');

    const result = JSON.parse(jsonMatch[0]);

    return {
      isStoryboard: result.isStoryboard ?? false,
      confidence: result.confidence ?? 0,
      source: 'ai',
      scenes: result.scenes?.map((s: any, i: number) => ({
        index: i + 1,
        prompt: s.prompt || s.description || '',
        description: s.description || `场景${i + 1}`,
        duration: Math.min(Math.max(s.duration || 10, 3), 30),
        transition: s.transition || '',
      })),
      summary: result.summary || '',
      warnings: result.warnings || [],
      suggestions: result.suggestions || [],
      estimatedTotalDuration: result.estimatedTotalDuration,
    };
  } catch (err) {
    console.warn('[StoryboardDetect] AI 判断失败，回退正则:', (err as Error).message);
    const regexResult = regexDetect(text);
    return regexResult || { isStoryboard: false, confidence: 0, source: 'none' };
  }
}

// ========== 质量评估 ==========

/** 评估分镜脚本质量，给出改进建议 */
async function assessStoryboardQuality(scenes: StoryboardScene[]): Promise<{
  score: number;
  issues: string[];
  suggestions: string[];
}> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey || scenes.length < 2) {
    return { score: 0.6, issues: [], suggestions: ['建议至少2个场景'] };
  }

  try {
    const data = await fetchJSON<{ choices: { message: { content: string } }[] }>(ZHIPU_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: `你是分镜脚本质量评审员。评估以下分镜脚本的质量（0-100分），找出问题并给出改进建议。

## 评分维度
- 叙事结构(30分): 是否有开场-发展-高潮-结尾的弧线
- 视觉连续性(25分): 场景之间是否有视觉承接
- prompt 质量(20分): 英文 prompt 是否包含场景/主体/光线/运镜
- 节奏控制(15分): 时长分配是否合理
- 过渡设计(10分): 是否有过渡方式说明

## 输出JSON
{"score":75,"issues":["问题1"],"suggestions":["建议1"]}`,
          },
          {
            role: 'user',
            content: scenes.map(s => `场景${s.index}: ${s.description} | prompt: ${s.prompt} | ${s.duration}秒`).join('\n'),
          },
        ],
        temperature: 0.2,
        max_tokens: 500,
      }),
    }, 10000);

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty');

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');

    const result = JSON.parse(jsonMatch[0]);
    return {
      score: result.score ?? 70,
      issues: result.issues || [],
      suggestions: result.suggestions || [],
    };
  } catch {
    return { score: 60, issues: [], suggestions: ['无法评估，请人工检查'] };
  }
}

// ========== 公开 API ==========

/**
 * 检测文本是否为分镜脚本（正则 + AI 双层判断）
 */
export async function detectStoryboard(text: string): Promise<StoryboardDetection> {
  if (!text || text.trim().length < 20) {
    return { isStoryboard: false, confidence: 0, source: 'none' };
  }

  // 1. 正则快速判断
  const regexResult = regexDetect(text);
  if (regexResult && regexResult.confidence >= 0.7) {
    console.log(`[Storyboard] 正则检测通过: ${regexResult.scenes?.length}个场景, 置信度${regexResult.confidence.toFixed(2)}`);
    return regexResult;
  }

  // 2. AI 深度判断
  console.log('[Storyboard] 正则不确定，启动AI判断...');
  const aiResult = await aiDetect(text);

  if (aiResult.isStoryboard) {
    console.log(`[Storyboard] AI判断通过: ${aiResult.scenes?.length}个场景, 置信度${aiResult.confidence.toFixed(2)}`);
  }

  return aiResult;
}

/**
 * 评估分镜脚本质量
 */
export async function reviewStoryboard(scenes: StoryboardScene[]): Promise<StoryboardDetection & { quality: any }> {
  const quality = await assessStoryboardQuality(scenes);

  const detection: StoryboardDetection = {
    isStoryboard: true,
    confidence: 0.9,
    source: 'ai',
    scenes: scenes.map((s, i) => ({
      ...s,
      quality: {
        score: quality.score,
        issues: quality.issues.slice(0, 3),
        suggestions: quality.suggestions.slice(0, 3),
      },
    })),
    warnings: quality.issues,
    suggestions: quality.suggestions,
    estimatedTotalDuration: scenes.reduce((s, c) => s + c.duration, 0),
  };

  return { ...detection, quality };
}
