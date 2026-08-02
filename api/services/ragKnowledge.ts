/**
 * Agent RAG 知识检索系统 v2
 * 关键词 + 向量混合检索，支持知识库 CRUD
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { hybridSearch, vectorSearch, keywordSearch, addDocuments, getAllDocuments, isEmbeddingReady } from './vectorStore.js';
import { fetchWithTimeout } from './fetchUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========== 知识库定义（种子数据） ==========

interface KnowledgeEntry {
  keywords: string[];
  description: string;
  prompt: string;
  style: string;
  params?: Record<string, any>;
}

interface StyleEntry {
  name: string;
  keywords: string[];
  visualDesc: string;
  mood: string;
  lighting: string;
  color: string;
  camera: string;
  examples: string[];
}

const promptTemplates: KnowledgeEntry[] = [
  {
    keywords: ['广告', '宣传', 'TVC', 'commercial', '广告片', '品牌', '推广'],
    description: '商业广告视频',
    prompt: 'Cinematic product commercial, elegant visual storytelling, hero product shot with soft studio lighting, lifestyle scenes with natural light, clean composition, brand color accents, smooth dolly and tracking shots, 4k quality',
    style: 'cinematic',
    params: { duration: 15 },
  },{
    keywords: ['抖音', '短视频', 'tiktok', '竖屏', '社媒', 'viral'],
    description: '社媒短视频',
    prompt: 'Social media vertical video, fast-paced energetic editing, eye-catching visuals, trending aesthetic, vibrant colors, close-up shots, dynamic transitions, engaging content style',
    style: 'realistic',
    params: { duration: 10 },
  },{
    keywords: ['Vlog', '生活', '日常', '记录', '博客'],
    description: '生活Vlog',
    prompt: 'Natural lifestyle vlog, handheld camera feel, warm ambient lighting, real locations, candid moments, soft color grading, relaxed pacing, authentic atmosphere',
    style: 'realistic',
    params: { duration: 15 },
  },{
    keywords: ['教程', '教学', 'howto', 'tutorial', '演示', '指南'],
    description: '教程/演示视频',
    prompt: 'Clean tutorial video, bright even lighting, top-down overhead shots, close-up detail views, minimal background, professional studio setup, clear product demonstration',
    style: 'realistic',
    params: { duration: 10 },
  },{
    keywords: ['婚礼', 'wedding', '结婚', '婚纱', '恋爱'],
    description: '婚礼/爱情视频',
    prompt: 'Romantic wedding cinematic, golden hour backlight, shallow depth of field, slow motion intimate moments, soft dreamy colors, elegant venue details, emotional storytelling',
    style: 'cinematic',
    params: { duration: 15 },
  },{
    keywords: ['科技', '产品', '数码', '手机', 'tech', '电子产品'],
    description: '科技产品展示',
    prompt: 'Futuristic tech product showcase, sleek modern setting, blue-neon accent lighting, macro close-up details, smooth orbiting camera, premium materials texture, minimal design aesthetic',
    style: '3d',
    params: { duration: 10 },
  },{
    keywords: ['美食', 'food', '料理', '吃饭', '厨房', '烹饪'],
    description: '美食视频',
    prompt: 'Delicious food cinematography, warm natural lighting, shallow depth of field, steam and fresh ingredients close-up, wooden table setting, appetizing colors, slow motion pouring and cutting shots',
    style: 'cinematic',
    params: { duration: 10 },
  },{
    keywords: ['旅行', 'travel', '风景', '旅游', '户外', '自然'],
    description: '旅行风景视频',
    prompt: 'Breathtaking travel cinematography, drone aerial shots, golden hour landscapes, smooth gimbal movement, vibrant natural colors, diverse locations transition, inspirational adventure mood',
    style: 'cinematic',
    params: { duration: 15 },
  },{
    keywords: ['动漫', 'anime', '二次元', '动画', '卡通'],
    description: '动漫风格',
    prompt: 'Beautiful anime art style, cel shaded, vibrant colors, detailed background, character focused, dramatic lighting, smooth animation feeling, Japanese animation aesthetic',
    style: 'anime',
    params: { duration: 10 },
  },{
    keywords: ['运动', 'sport', '健身', '篮球', '足球', '跑步'],
    description: '运动视频',
    prompt: 'Dynamic sports cinematography, high-speed camera, dramatic angles, action freeze moments, sweat and motion details, stadium atmosphere, intense energy, slow motion key moments',
    style: 'cinematic',
    params: { duration: 10 },
  },
];

const visualStyles: StyleEntry[] = [
  {
    name: 'cinematic/电影感',
    keywords: ['电影', 'cinematic', '电影感', '大片', '好莱坞'],
    visualDesc: 'Cinematic style with shallow depth of field, 24fps film look, anamorphic lens flares, dramatic color grading with teal-orange palette, smooth dolly and crane movements',
    mood: 'Epic, emotional, immersive',
    lighting: 'Three-point studio lighting, golden hour backlight, dramatic shadows',
    color: 'Teal and orange, desaturated shadows, rich skin tones',
    camera: 'Dolly, crane, steadicam, slow motion',
    examples: ['电影预告片', '品牌大片', 'Nike广告'],
  },{
    name: '新海诚/Makoto Shinkai',
    keywords: ['新海诚', 'shinkai', '你的名字', '天气之子'],
    visualDesc: 'Ethereal beauty, vivid blue skies with detailed cumulus clouds, brilliant sunlight rays (god rays), lens flares, reflections in puddles, train stations, urban landscapes with emotional solitude',
    mood: 'Nostalgic, romantic, bittersweet',
    lighting: 'Bright sunlit scenes, dramatic crepuscular rays, soft diffused interior light',
    color: 'Vibrant cyan sky, warm golden sunlight, saturated greenery, magenta-purple twilight',
    camera: 'Wide establishing shots, slow pans, dramatic zooms into sky',
    examples: ['你的名字', '天气之子', '秒速5厘米'],
  },{
    name: '赛博朋克/cyberpunk',
    keywords: ['赛博朋克', 'cyberpunk', '未来', '科幻', '霓虹'],
    visualDesc: 'Cyberpunk aesthetic with neon-soaked streets, rain-slicked surfaces, holographic displays, dense urban verticality, high-tech low-life contrast, smoke and steam atmospherics',
    mood: 'Gritty, futuristic, mysterious',
    lighting: 'Neon tubes in magenta/cyan, volumetric fog, under-lighting from street level',
    color: 'Neon pink, electric blue, deep purple shadows, teal highlights',
    camera: 'Low angle, tracking through crowds, aerial drone through canyons',
    examples: ['银翼杀手', '赛博朋克2077', '攻壳机动队'],
  },{
    name: 'Wes Anderson/韦斯安德森',
    keywords: ['韦斯安德森', 'wes anderson', '对称', '复古', '粉色'],
    visualDesc: 'Symmetrical composition, pastel color palettes, flat perspective, precise framing, vintage props and costumes, whimsical stop-motion feel, centered subjects',
    mood: 'Whimsical, nostalgic, precise, charming',
    lighting: 'Even flat lighting, no harsh shadows, soft fill from both sides',
    color: 'Pastel pink, mint green, mustard yellow, muted earth tones',
    camera: 'Static centered shots, smooth 90-degree pans, overhead flat lays',
    examples: ['布达佩斯大饭店', '月升王国', '犬之岛'],
  },{
    name: '纪录片/纪实',
    keywords: ['纪录片', 'documentary', '真实', '纪实', '写实'],
    visualDesc: 'Naturalistic documentary style, available light only, handheld camera with subtle shake, real environments, candid expressions, minimal post-processing',
    mood: 'Authentic, raw, intimate',
    lighting: 'Natural window light, practical lamps, golden hour exterior',
    color: 'Desaturated natural tones, slight warm push, film grain texture',
    camera: 'Handheld shoulder rig, subtle zoom, following action, POV',
    examples: ['BBC纪录片', '国家地理', '人物访谈'],
  },{
    name: '极简/北欧',
    keywords: ['极简', '北欧', 'minimal', '简约', '干净', '白色'],
    visualDesc: 'Clean minimalist aesthetic, abundant natural light, white and neutral spaces, geometric composition, single focal point, negative space emphasis',
    mood: 'Calm, modern, sophisticated',
    lighting: 'Soft diffused daylight from large windows, no harsh shadows',
    color: 'White, beige, light grey, subtle wood accents, occasional pop color',
    camera: 'Slow smooth movements, static shots, gentle slide reveals',
    examples: ['Apple广告', 'MUJI', '宜家'],
  },
];

// ========== 种子数据初始化 ==========

let seeded = false;

/** 将种子数据导入向量库 */
export async function seedKnowledgeBase(): Promise<number> {
  if (seeded) return 0;

  // 检查是否已导入
  const existing = getAllDocuments();
  if (existing.length >= promptTemplates.length + visualStyles.length) {
    seeded = true;
    console.log(`[RAG] 知识库已有 ${existing.length} 条记录，跳过种子导入`);
    return 0;
  }

  const entries: Array<{ type: 'prompt_template' | 'visual_style'; title: string; content: string; searchText: string; metadata: Record<string, any> }> = [];

  for (const t of promptTemplates) {
    entries.push({
      type: 'prompt_template',
      title: t.description,
      content: t.prompt,
      searchText: `${t.description} ${t.keywords.join(' ')} ${t.prompt}`,
      metadata: { keywords: t.keywords, style: t.style, params: t.params || {} },
    });
  }

  for (const s of visualStyles) {
    entries.push({
      type: 'visual_style',
      title: s.name,
      content: s.visualDesc,
      searchText: `${s.name} ${s.keywords.join(' ')} ${s.visualDesc} ${s.mood} ${s.lighting} ${s.color} ${s.camera}`,
      metadata: { keywords: s.keywords, mood: s.mood, lighting: s.lighting, color: s.color, camera: s.camera, examples: s.examples },
    });
  }

  const count = await addDocuments(entries);
  seeded = true;
  console.log(`[RAG] 种子数据导入完成: ${count} 条`);
  return count;
}

// ========== RAG 检索引擎 ==========

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[，。,\.！!？?\s]+/g, ' ')
    .split(' ')
    .filter(t => t.length > 0);
}

function matchScore(queryTokens: string[], entryTokens: string[]): number {
  const hit = queryTokens.filter(t => entryTokens.includes(t)).length;
  return hit / Math.max(queryTokens.length, 1);
}

/** 关键词检索（旧版兼容，用于快速回退） */
export function retrievePromptTemplate(userMessage: string): KnowledgeEntry | null {
  const queryTokens = tokenize(userMessage);
  let best: KnowledgeEntry | null = null;
  let bestScore = 0;

  for (const entry of promptTemplates) {
    const entryTokens = tokenize(entry.keywords.join(' '));
    const score = matchScore(queryTokens, entryTokens);
    if (score > 0.15 && score > bestScore) { best = entry; bestScore = score; }
  }
  return best;
}

export function retrieveVisualStyle(userMessage: string): StyleEntry | null {
  const queryTokens = tokenize(userMessage);
  let best: StyleEntry | null = null;
  let bestScore = 0;

  for (const entry of visualStyles) {
    const entryTokens = tokenize(entry.keywords.join(' '));
    const score = matchScore(queryTokens, entryTokens);
    if (score > 0.1 && score > bestScore) { best = entry; bestScore = score; }
  }
  return best;
}

/**
 * 向量检索 Prompt 模板（新版，语义匹配）
 */
export async function retrievePromptTemplateVector(userMessage: string): Promise<{
  template: KnowledgeEntry | null;
  vectorMatch: { title: string; content: string; score: number; metadata: Record<string, any> } | null;
}> {
  // 先尝试向量检索
  const results = await hybridSearch(userMessage, 3, 0.35);
  const vecMatch = results.find(r => r.document.type === 'prompt_template');

  if (vecMatch && vecMatch.score >= 0.35) {
    // 映射回 KnowledgeEntry
    const template: KnowledgeEntry = {
      keywords: vecMatch.document.metadata.keywords || [],
      description: vecMatch.document.title,
      prompt: vecMatch.document.content,
      style: vecMatch.document.metadata.style || 'realistic',
      params: vecMatch.document.metadata.params || {},
    };
    return {
      template,
      vectorMatch: {
        title: vecMatch.document.title,
        content: vecMatch.document.content,
        score: vecMatch.score,
        metadata: vecMatch.document.metadata,
      },
    };
  }

  // 回退关键词
  return {
    template: retrievePromptTemplate(userMessage),
    vectorMatch: null,
  };
}

/**
 * 向量检索视觉风格
 */
export async function retrieveVisualStyleVector(userMessage: string): Promise<{
  style: StyleEntry | null;
  vectorMatch: { title: string; content: string; score: number; metadata: Record<string, any> } | null;
}> {
  const results = await hybridSearch(userMessage, 3, 0.35);
  const vecMatch = results.find(r => r.document.type === 'visual_style');

  if (vecMatch && vecMatch.score >= 0.35) {
    const style: StyleEntry = {
      name: vecMatch.document.title,
      keywords: vecMatch.document.metadata.keywords || [],
      visualDesc: vecMatch.document.content,
      mood: vecMatch.document.metadata.mood || '',
      lighting: vecMatch.document.metadata.lighting || '',
      color: vecMatch.document.metadata.color || '',
      camera: vecMatch.document.metadata.camera || '',
      examples: vecMatch.document.metadata.examples || [],
    };
    return { style, vectorMatch: { title: vecMatch.document.title, content: vecMatch.document.content, score: vecMatch.score, metadata: vecMatch.document.metadata } };
  }

  return { style: retrieveVisualStyle(userMessage), vectorMatch: null };
}

// ========== 语义 RAG（兼容旧版） ==========

export async function semanticRAG(userMessage: string): Promise<{
  template: KnowledgeEntry | null;
  style: StyleEntry | null;
  enhancedPrompt: string;
  source: 'keyword' | 'vector' | 'llm';
}> {
  // 1. 向量检索优先（整体 12 秒超时兜底）
  const [tmplResult, styleResult] = await Promise.race([
    Promise.all([
      retrievePromptTemplateVector(userMessage),
      retrieveVisualStyleVector(userMessage),
    ]),
    new Promise<[any, any]>(resolve => setTimeout(() => {
      console.warn('[RAG] 检索超时，降级关键词');
      resolve([{ template: retrievePromptTemplate(userMessage), vectorMatch: null }, { style: retrieveVisualStyle(userMessage), vectorMatch: null }]);
    }, 12_000)),
  ]);

  const template = tmplResult.template;
  const style = styleResult.style;
  let source: 'keyword' | 'vector' | 'llm' = 'keyword';

  if (tmplResult.vectorMatch || styleResult.vectorMatch) {
    source = 'vector';
    console.log(`[RAG] 向量匹配: ${tmplResult.vectorMatch?.title || '无'} (${(tmplResult.vectorMatch?.score || 0).toFixed(2)}), ${styleResult.vectorMatch?.title || '无'} (${(styleResult.vectorMatch?.score || 0).toFixed(2)})`);
  }

  if (template && style) {
    return {
      template, style,
      enhancedPrompt: [template.prompt, style.visualDesc].join('. '),
      source,
    };
  }

  // 2. 向量不够 -> LLM 兜底
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return {
      template, style,
      enhancedPrompt: template?.prompt || style?.visualDesc || userMessage,
      source,
    };
  }

  try {
    const isDeepSeek = apiKey === process.env.DEEPSEEK_API_KEY;
    const model = isDeepSeek ? 'deepseek-chat' : 'glm-4-flash';
    const url = isDeepSeek
      ? 'https://api.deepseek.com/v1/chat/completions'
      : 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'system',
          content: `你是知识检索员。根据用户需求匹配最佳提示词模板和视觉风格。返回 JSON：{"templateIdx": -1, "styleIdx": -1, "enhancedPrompt": "..."}，-1不匹配`,
        }, {
          role: 'user',
          content: userMessage,
        }],
        temperature: 0.3,
        max_tokens: 200,
      }),
    }, 8000);

    if (!response.ok) throw new Error(`API ${response.status}`);

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty');

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');

    const result = JSON.parse(jsonMatch[0]);
    const llmTmpl = result.templateIdx >= 0 ? promptTemplates[result.templateIdx] : template;
    const llmStyle = result.styleIdx >= 0 ? visualStyles[result.styleIdx] : style;

    return {
      template: llmTmpl,
      style: llmStyle,
      enhancedPrompt: result.enhancedPrompt || llmTmpl?.prompt || userMessage,
      source: 'llm',
    };
  } catch {
    return { template, style, enhancedPrompt: template?.prompt || userMessage, source };
  }
}

export function buildRAGContext(message: string, template: KnowledgeEntry | null, style: StyleEntry | null): string {
  const parts: string[] = [];

  if (template) {
    parts.push(`[RAG 匹配: ${template.description}]\n标准模板: ${template.prompt}`);
    if (template.style) parts.push(`推荐风格: ${template.style}`);
  }

  if (style) {
    parts.push(`\n[RAG 匹配: ${style.name}风格]\n视觉描述: ${style.visualDesc}\n光线: ${style.lighting}\n色调: ${style.color}\n运镜: ${style.camera}`);
  }

  return parts.join('\n');
}
