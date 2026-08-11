import { Router, type Request, type Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fetchWithTimeout } from '../services/fetchUtils.js';
import { analyzeImageWithText } from '../services/imageService.js';
import { reviewUserIntent, findMemoryMatch, recordMemory } from '../services/reviewAgent.js';
import { reviewVideoScript, reviewVideoParams, quickScoreVideoPrompt, reviewVideoFinal, analyzeFailure } from '../services/videoReviewAgent.js';
import { retrievePromptTemplate, retrieveVisualStyle, buildRAGContext, semanticRAG, seedKnowledgeBase } from '../services/ragKnowledge.js';
import { setSSEHeaders, sendSSEEvent, sendSSEEnd, sendSSEError, streamLLM } from '../services/sseService.js';
import { addOperationLog } from '../services/database.js';
import { recall, remember, recordAgentTurn, checkAndCompress, getAgentContext } from '../services/agentMemory.js';
import { toolRegistry } from '../services/toolRegistry.js';
import { smartRoute, supervisorRoute } from '../services/modelRouter.js';
import { llmQueue, llmCircuitBreaker } from '../services/concurrencyService.js';

import { CHAT_MODEL, CHAT_API, getChatApiKey, CHAT_FALLBACK_MODEL, CHAT_FALLBACK_API, getChatFallbackApiKey, REASONING_MODEL, REASONING_API, getReasoningApiKey, REASONING_FALLBACK_MODEL, REASONING_FALLBACK_API, getReasoningFallbackApiKey } from '../services/llmConfig.js';

const HERMES_PYTHON_PATH = process.platform === 'win32' ? 'python' : 'python3';
const HERMES_MODULE = 'hermes_cli.main';

const execAsync = promisify(exec);
const router = Router();

let hermesReady: boolean | null = null;

/** 异步检查 Hermes 是否可用（缓存结果 5 分钟） */
async function checkHermesInstalled(): Promise<boolean> {
  if (hermesReady !== null) return hermesReady;
  try {
    const { stdout } = await execAsync(
      `"${HERMES_PYTHON_PATH}" -m ${HERMES_MODULE} version`,
      { timeout: 10_000, windowsHide: true },
    );
    hermesReady = stdout.includes('Hermes Agent');
    return hermesReady;
  } catch {
    hermesReady = false;
    return false;
  }
}

/**
 * 调用推理模型进行深度意图分析（DeepSeek-R1 优先，GLM-Z1 降级）
 * 推理模型会自动进行 chain-of-thought 思考，分析用户真实意图
 * 返回 { action, params, response, reasoning } 或 null（失败时回退到指令模型）
 */
async function callReasoningLLM(message: string, history: any[]): Promise<{ action: string; params: Record<string, any>; response: string; reasoning: string } | null> {
  // 先尝试 DeepSeek-R1（免费推理模型）
  const r1Key = getReasoningApiKey();
  if (r1Key) {
    const result = await tryCallReasoningLLM(message, history, REASONING_API, r1Key, REASONING_MODEL, 'DeepSeek-R1');
    if (result) return result;
  }

  // DeepSeek-R1 不可用，降级到智谱 GLM-Z1（免费推理模型）
  const z1Key = getReasoningFallbackApiKey();
  if (z1Key) {
    console.log('[Reasoning] DeepSeek-R1 unavailable, falling back to GLM-Z1');
    const result = await tryCallReasoningLLM(message, history, REASONING_FALLBACK_API, z1Key, REASONING_FALLBACK_MODEL, 'GLM-Z1');
    if (result) return result;
  }

  console.warn('[Reasoning] All reasoning models unavailable');
  return null;
}

async function tryCallReasoningLLM(
  message: string,
  history: any[],
  apiUrl: string,
  apiKey: string,
  model: string,
  provider: string,
): Promise<{ action: string; params: Record<string, any>; response: string; reasoning: string } | null> {
  const systemPrompt = `你是 AI 创意助手的推理核心，负责深度理解用户的创作需求。

## 你的思考方式
你需要逐步推理（chain-of-thought）来分析用户的真实意图：

### 第0步：上下文关联分析（必须首先执行）
**仔细检查对话历史中是否存在之前的创作任务。如果有，必须分析当前请求与之前任务的关系：**

- 如果用户使用代词（"它"、"这个"、"那张图"、"刚才的视频"），说明用户指的是之前生成的作品，你必须从历史中找到对应的作品信息
- 如果用户说"修改一下"、"调整"、"换个风格"、"让它...起来"，说明用户想修改之前的结果
- 如果用户说"再生成一个"、"类似的"、"换个角度"，说明用户想要类似的新作品
- 如果用户提到了与之前任务相同的主题/角色/场景，说明存在延续性关联
- 如果历史中没有创作任务，或当前请求是全新的独立需求，则标注为"无关联"

**关联分析结论格式（在 reasoning 中体现）：**
- 有关联 → 明确指出关联的上一轮任务是什么（action类型、主题、关键参数）
- 无关联 → 说明这是全新的独立请求

### 第1步：语义理解
- 用户说了什么？核心关键词是什么？
- 如果第0步发现关联，用户说的"它/这个/那个"指代什么？
- 用户的情绪和期望是什么？

### 第2步：意图分类
分析用户属于以下哪种意图：
- **image**：生成图片/插画/海报/壁纸/头像
- **video**：生成视频/短片/动画/广告片/宣传片。**重要：如果用户要求的时长超过18秒（如"30秒"、"1分钟"、"长视频"），action 仍为 video，但 duration 参数要真实反映用户要求，并在 params 中设置 split: true**
- **compose**：用户要求同时生成图片和视频，比如"做一个花瓶的广告，要有图片和视频"、"生成海报和宣传片"、"图片视频都要"。当用户明确要求多产出物时使用此意图
- **modify-image**：修改已有图片（必须在第0步确认了关联的图片）
- **modify-video**：修改已有视频（必须在第0步确认了关联的视频）
- **remove-bg**：抠图/去背景
- **compose-image**：图片合成/拼接
- **general**：闲聊/问答/非创作类问题

**compose 意图特殊规则：**
- 用户说"广告"、"推广"、"营销"、"宣传"时，如果涉及具体产品，通常是 compose（图片+视频）
- compose 的 params 需包含：prompt（通用提示词）、style、duration、composeType: "image+video"
- 用户上传了图片并要求"生成宣传视频"时，action 为 video（不需要 compose，因为已有参考图）

**长视频拆分规则（重要）：**
- 当 duration > 18 秒时，在 params 中设置 split: true
- 在 response 中提示用户："🎬 检测到长视频需求（{duration}秒），将自动拆分为多段生成并拼接，请耐心等待..."

### 第3步：参数推理
根据用户描述和上下文关联推理出具体参数：
- prompt: 英文提示词，如果有关联，融入上一轮的作品特征（80-200词）
- style: realistic/cinematic/anime/3d/illustration，如果用户说"换个风格"，要明确切换
- duration: 视频时长（秒），默认10秒
- size: 图片尺寸，默认1024x1024
- contextFromPrevious: 如果有关联，填入上一轮的关键信息（主题/风格/角色等）

### 第4步：输出决策
基于以上推理，输出最终决策。

## 输出格式（严格JSON，不要其他文字）
{"action":"video","params":{"prompt":"提示词","style":"cinematic","duration":10,"contextFromPrevious":"上一轮生成了赛博朋克风格的猫"},"response":"基于上一轮的赛博朋克猫，现在生成..."}`;

  try {
    const response = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.slice(-10).map((m: any) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.role === 'assistant' && m.actionType
              ? `${m.content} [任务类型: ${m.actionType}, 参数: ${JSON.stringify(m.params || {}).substring(0, 200)}]`
              : m.content,
          })),
          { role: 'user', content: message },
        ],
        temperature: 0.6,
        max_tokens: 2000,
      }),
    }, 30000); // 推理模型需要更多时间思考

    if (!response.ok) {
      console.warn(`[${provider}] API failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    const choice = data.choices?.[0];
    const messageObj = choice?.message;

    // 推理模型返回结构：reasoning_content + content
    // DeepSeek-R1: message.reasoning_content + message.content
    // GLM-Z1: message.reasoning_content + message.content
    const reasoning = messageObj?.reasoning_content || choice?.reasoning_content || '';
    const content = messageObj?.content?.trim();

    if (!content) {
      console.warn(`[${provider}] Empty content, reasoning was:`, reasoning?.substring(0, 200));
      return null;
    }

    // 提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[${provider}] No JSON in content:`, content?.substring(0, 200));
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const action = (parsed.action || '').toLowerCase();
    const validActions = ['image', 'video', 'modify-image', 'modify-video', 'remove-bg', 'compose', 'compose-image', 'general'];
    const mappedAction = validActions.find(a => action.includes(a)) || 'general';
    const params = parsed.params || {};
    // 基于推理结果自动生成有实质内容的分析总结
    const analysisSummary = buildAnalysisSummary(mappedAction, params, reasoning);

    console.log(`[${provider}] Intent: ${mappedAction} | Summary: ${analysisSummary.substring(0, 80)}`);
    if (reasoning) {
      console.log(`[${provider}] Reasoning: ${reasoning.substring(0, 200)}...`);
    }

    return {
      action: mappedAction,
      params,
      response: analysisSummary,
      reasoning,
    };
  } catch (error) {
    console.warn(`[${provider}] Exception:`, (error as Error).message);
    return null;
  }
}

/**
 * 调用 LLM 进行意图识别（智谱优先，DeepSeek 降级）
 * 返回 { action, params, response } 或 null（失败时回退）
 */
async function callLLM(message: string, history: any[]): Promise<{ action: string; params: Record<string, any>; response: string } | null> {
  // 先尝试智谱 glm-4-flash（免费）
  const primaryKey = getChatApiKey();
  if (primaryKey) {
    const result = await tryCallLLM(message, history, CHAT_API, primaryKey, CHAT_MODEL, 'Zhipu');
    if (result) return result;
  }

  // 智谱不可用，降级到 DeepSeek
  const fallbackKey = getChatFallbackApiKey();
  if (fallbackKey) {
    console.log('[LLM] Zhipu unavailable, falling back to DeepSeek');
    const result = await tryCallLLM(message, history, CHAT_FALLBACK_API, fallbackKey, CHAT_FALLBACK_MODEL, 'DeepSeek');
    if (result) return result;
  }

  console.warn('[LLM] All LLM providers unavailable');
  return null;
}

async function tryCallLLM(
  message: string,
  history: any[],
  apiUrl: string,
  apiKey: string,
  model: string,
  provider: string,
): Promise<{ action: string; params: Record<string, any>; response: string } | null> {
  const systemPrompt = `你是 AI 创意助手，负责理解用户创作需求并精准识别意图。

## 重要：上下文关联（必须首先执行）
先检查对话历史中是否有之前的创作任务：
- 如果用户使用代词（"它"、"这个"、"刚才的"），说明指代历史中的作品 → 必须关联
- 如果用户说"修改"、"调整"、"换个风格"、"让它..."，说明想修改之前的结果 → 必须关联
- 如果用户说"再生成一个"、"类似的"，说明想要类似新作品 → 继承风格参数
- 如果历史中无创作任务或当前是完全新需求 → 无需关联
- 关联时，在 params 中加入 contextFromPrevious 字段，描述上一轮的内容

## Action 类型与识别规则

### image（图片生成）
关键词：画、生成图、制作图片、画一张、画个、插画、海报、壁纸
params: prompt, style, size(默认1024x1024), contextFromPrevious(如有)

### video（视频生成）  
关键词：视频、片子、短片、动画、制作视频、生成视频、拍一个、广告片
时长推断：用户说"15秒"→ duration:15 | "30秒"→ 30 | "1分钟"→ 60 | 没说→ 默认10
style: 广告/宣传 → cinematic | 动漫/卡通 → anime | 写实 → realistic
params: prompt, style, duration, contextFromPrevious(如有)

### modify-image / modify-video / remove-bg / compose-image / compose / general
修改类意图必须在 params 中带上 contextFromPrevious
compose 代表同时生成图片+视频（并行任务），compose-image 代表图片合成

## 输出格式（严格JSON，不要其他文字）
{"action":"video","params":{"prompt":"提示词","style":"realistic","duration":10,"contextFromPrevious":"上一轮生成了...猫"},"response":"基于上一轮的猫，现在生成..."}
{"action":"image","params":{"prompt":"提示词","style":"anime","size":"1024x1024","contextFromPrevious":"上一轮画了...风景"},"response":"基于上一轮的风景..."}
{"action":"general","params":{"query":"提问"},"response":"回答"}`;

  try {
    const response = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.slice(-10).map((m: any) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.role === 'assistant' && m.actionType
              ? `${m.content} [任务类型: ${m.actionType}, 参数: ${JSON.stringify(m.params || {}).substring(0, 200)}]`
              : m.content,
          })),
          { role: 'user', content: message },
        ],
        temperature: 0.7,
        max_tokens: 400,
      }),
    }, 15000); // 15 秒超时，比之前的 20 秒更快

    if (!response.ok) {
      console.warn(`[${provider}] API failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const action = (parsed.action || '').toLowerCase();
    const validActions = ['image', 'video', 'modify-image', 'modify-video', 'remove-bg', 'compose', 'compose-image', 'general'];
    const mappedAction = validActions.find(a => action.includes(a)) || 'general';
    const params = parsed.params || {};
    console.log(`[${provider}] Intent: ${mappedAction} | ${parsed.response?.substring(0, 50)}`);

    return {
      action: mappedAction,
      params,
      response: buildAnalysisSummary(mappedAction, params, ''),
    };
  } catch (error) {
    console.warn(`[${provider}] Exception:`, (error as Error).message);
    return null;
  }
}

/**
 * 根据推理结果自动生成有实质内容的分析总结
 * 替代原来敷衍的"我理解你的需求了，正在帮你处理..."
 */
function buildAnalysisSummary(action: string, params: Record<string, any>, reasoning: string): string {
  const styleMap: Record<string, string> = {
    realistic: '写实风格', anime: '动漫风格', cinematic: '电影感',
    '3d': '3D风格', illustration: '插画风格', fantasy: '奇幻风格',
    cyberpunk: '赛博朋克', 'oil-painting': '油画风格', cartoon: '卡通风格',
  };

  // 上下文关联信息
  const contextInfo = params.contextFromPrevious
    ? `\n🔗 **上下文关联：** 检测到与上一轮任务关联 → ${params.contextFromPrevious}`
    : '\n🆕 **全新任务：** 未检测到与历史任务的关联';

  switch (action) {
    case 'video': {
      const style = params.style ? (styleMap[params.style] || params.style) : '';
      const duration = params.duration || '10';
      const prompt = params.prompt || '';
      const promptPreview = prompt.length > 60 ? prompt.substring(0, 60) + '...' : prompt;
      const lines = [
        `📹 **分析结果：视频生成**`,
        `- 意图识别：用户想要生成一段视频`,
        `- 时长：${duration} 秒`,
      ];
      if (style) lines.push(`- 风格：${style}`);
      if (promptPreview) lines.push(`- 核心描述：${promptPreview}`);
      lines.push(contextInfo);
      lines.push(``);
      lines.push(`接下来将由故事创作专家编写脚本，视频制作专家提取参数并生成视频。`);
      return lines.join('\n');
    }
    case 'image': {
      const style = params.style ? (styleMap[params.style] || params.style) : '';
      const size = params.size || '1024x1024';
      const prompt = params.prompt || '';
      const promptPreview = prompt.length > 60 ? prompt.substring(0, 60) + '...' : prompt;
      const lines = [
        `🎨 **分析结果：图片生成**`,
        `- 意图识别：用户想要生成图片`,
        `- 尺寸：${size}`,
      ];
      if (style) lines.push(`- 风格：${style}`);
      if (promptPreview) lines.push(`- 核心描述：${promptPreview}`);
      lines.push(contextInfo);
      lines.push(``);
      lines.push(`接下来将由图像创作专家优化提示词并生成图片。`);
      return lines.join('\n');
    }
    case 'modify-image': {
      return `✏️ **分析结果：图片修改**\n- 意图识别：用户想要修改已有图片\n- 修改内容：${params.description || params.prompt || '根据用户描述进行修改'}\n\n接下来将根据修改需求重新生成图片。`;
    }
    case 'modify-video': {
      return `✂️ **分析结果：视频修改**\n- 意图识别：用户想要修改已有视频\n- 修改类型：${params.modifyType || '根据用户描述进行修改'}\n\n接下来将根据修改需求调整视频。`;
    }
    case 'remove-bg': {
      return `🖼️ **分析结果：智能抠图**\n- 意图识别：用户想要去除图片背景\n\n接下来将自动抠除背景，生成透明背景图片。`;
    }
    case 'compose-image': {
      return `🎭 **分析结果：图片合成**\n- 意图识别：用户想要合成/拼接图片\n\n接下来将提取主体并合成到新背景中。`;
    }
    case 'compose': {
      return `🎬🎨 **分析结果：复合创作（图片+视频）**\n- 意图识别：用户需要同时生成图片和视频\n\n接下来将并行执行图片和视频生成任务。`;
    }
    case 'general': {
      // 通用问答：如果 reasoning 存在，提取关键信息
      if (reasoning) {
        const keyPoints = reasoning.split(/[。.；;]/).filter(s => s.trim().length > 5).slice(0, 3);
        if (keyPoints.length > 0) {
          return `💬 **分析结果：通用问答**\n\n${keyPoints.map(p => `- ${p.trim()}`).join('\n')}`;
        }
      }
      return `💬 我理解你的问题，正在为你解答...`;
    }
    default:
      return `已收到你的需求，正在帮你处理...`;
  }
}

/**
 * 从 Hermes CLI 输出中解析 action 和 params
 * 支持多种输出格式：JSON、key:value、行式
 */
function parseHermesAction(output: string, originalMessage: string): { action: string; params: Record<string, any> } {
  const fallback = fallbackAnalyze(originalMessage);

  // 尝试 1: JSON 格式（以 { 或 [ 开头）
  const jsonMatch = output.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.action || parsed.Action || parsed.intent) {
        const action = (parsed.action || parsed.Action || parsed.intent || '').toLowerCase();
        const validActions = ['image', 'video', 'modify-image', 'modify-video', 'remove-bg', 'compose', 'general'];
        const mappedAction = validActions.find(a => action.includes(a)) || fallback.action;

        const params: Record<string, any> = {};
        const value = parsed.params || parsed.Parameters || parsed;
        params.prompt = value.prompt || value.description || value.Prompt || originalMessage;
        if (value.style || value.Style) params.style = value.style || value.Style;
        if (value.duration || value.Duration) params.duration = value.duration || value.Duration;
        if (value.size || value.Size) params.size = value.size || value.Size;

        return { action: mappedAction, params };
      }
    } catch {
      // JSON 解析失败，继续
    }
  }

  // 尝试 2: key:value 行格式
  const lines = output.split('\n');
  const kvMap: Record<string, string> = {};
  for (const line of lines) {
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*[:：]\s*(.+)/);
    if (kvMatch) {
      const key = kvMatch[1].toLowerCase().trim();
      const value = kvMatch[2].trim();
      if (!['session_id', 'timestamp', 'status'].includes(key)) {
        kvMap[key] = value;
      }
    }
  }

  if (kvMap.action || kvMap.intent) {
    const action = (kvMap.action || kvMap.intent || '').toLowerCase();
    const validActions = ['image', 'video', 'modify-image', 'modify-video', 'remove-bg', 'compose', 'general'];
    const mappedAction = validActions.find(a => action.includes(a)) || fallback.action;
    const params: Record<string, any> = {};
    params.prompt = kvMap.prompt || kvMap.description || originalMessage;
    if (kvMap.style) params.style = kvMap.style;
    if (kvMap.duration) params.duration = kvMap.duration;
    if (kvMap.size) params.size = kvMap.size;

    return { action: mappedAction, params };
  }

  // 尝试 3: 从响应文本中推断
  const responseLower = output.toLowerCase();
  if (responseLower.includes('视频') || responseLower.includes('video')) {
    return { action: 'video', params: { prompt: originalMessage, duration: '5' } };
  }

  // 回退
  return fallback;
}

function fallbackAnalyze(message: string): { action: string; params: Record<string, any> } {
  const lowerText = message.toLowerCase();

  if (lowerText.includes('修改') || lowerText.includes('更改') || lowerText.includes('换成') || lowerText.includes('改成')) {
    let modifyType = 'background';
    if (lowerText.includes('背景')) modifyType = 'background';
    else if (lowerText.includes('人物') || lowerText.includes('角色') || lowerText.includes('着装') || lowerText.includes('性别')) modifyType = 'character';
    else if (lowerText.includes('音乐') || lowerText.includes('bgm') || lowerText.includes('音效')) modifyType = 'music';
    else if (lowerText.includes('剧情') || lowerText.includes('故事') || lowerText.includes('情节')) modifyType = 'story';
    else if (lowerText.includes('风格')) modifyType = 'style';

    return {
      action: 'modify-video',
      params: { modifyType, description: message },
    };
  }

  let action = 'image';

  if (lowerText.includes('视频') || lowerText.includes('video')) {
    action = 'video';
  } else if (lowerText.includes('抠图') || lowerText.includes('去背景') || lowerText.includes('移除背景')) {
    action = 'remove-bg';
  } else if (lowerText.includes('合成') || lowerText.includes('组合') || lowerText.includes('叠加')) {
    action = 'compose-image';
  } else if ((lowerText.includes('广告') || lowerText.includes('宣传') || lowerText.includes('推广')) && (lowerText.includes('图片') || lowerText.includes('视频'))) {
    action = 'compose'; // 并行图片+视频
  }

  return {
    action,
    params: { prompt: message },
  };
}

// 判断是否为通用问答类指令（非图片/视频创作需求）
// 例如：天气查询、时间日期、知识问答、闲聊等
function isGeneralQuery(message: string): boolean {
  const lowerText = message.toLowerCase();

  // 创作类关键词：如果包含这些词，说明是图片/视频创作需求，不走通用问答
  const creativeKeywords = [
    '生成', '创作', '制作', '画', '描绘', '设计', '创建',
    '视频', 'video', '图片', '图像', 'image', 'picture',
    '抠图', '去背景', '移除背景', '合成', '组合', '叠加',
    '风格', '写实', '动漫', '电影', '卡通', '水彩', '油画',
    '修改', '更改', '换成', '改成',
  ];

  // 如果明确包含创作关键词，则不是通用问答
  if (creativeKeywords.some(kw => lowerText.includes(kw))) {
    return false;
  }

  // 通用问答类关键词
  const generalKeywords = [
    '天气', '气温', '温度', '下雨', '下雪', '天气预报',
    '今天', '明天', '后天', '日期', '时间', '几点', '星期',
    '什么是', '为什么', '怎么', '如何', '请问', '解释',
    '告诉', '介绍', '说明', '区别', '定义', '含义',
    '翻译', '计算', '算一下', '等于',
    '你好', '你是谁', '能做什么', '帮助', 'help',
    '新闻', '热点', '事件', '历史',
  ];

  // 疑问句式判断
  const questionPatterns = [
    /[?？]$/,          // 以问号结尾
    /^(什么是|为什么|怎么|如何|哪里|哪个|谁|何时|多少)/,
    /^(what|why|how|where|when|who|which)\s/i,
    /^(is|are|can|could|would|will|do|does|did)\s/i,
  ];

  // 包含通用问答关键词
  if (generalKeywords.some(kw => lowerText.includes(kw))) {
    return true;
  }

  // 匹配疑问句式
  if (questionPatterns.some(pattern => pattern.test(message))) {
    return true;
  }

  return false;
}

// 获取当前日期时间信息（用于通用问答）
function getDateTimeInfo(): string {
  const now = new Date();
  const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const dateStr = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `今天是 ${dateStr} ${days[now.getDay()]}，当前时间 ${timeStr}`;
}

// 生成通用问答的回复（当 Hermes 未安装或无法回答时的兜底）
function generateGeneralResponse(message: string): string {
  const lowerText = message.toLowerCase();

  // 日期时间类问题
  if (lowerText.includes('今天') && (lowerText.includes('几号') || lowerText.includes('日期') || lowerText.includes('星期'))) {
    return getDateTimeInfo();
  }
  if (lowerText.includes('时间') || lowerText.includes('几点')) {
    return getDateTimeInfo();
  }
  if (lowerText.includes('明天') && (lowerText.includes('几号') || lowerText.includes('星期'))) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const dateStr = tomorrow.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    return `明天是 ${dateStr} ${days[tomorrow.getDay()]}`;
  }

  // 天气类问题（本地无法获取实时天气，给出提示）
  if (lowerText.includes('天气') || lowerText.includes('气温') || lowerText.includes('下雨') || lowerText.includes('下雪')) {
    return `${getDateTimeInfo()}\n\n抱歉，我目前无法获取实时天气数据。建议您查看手机自带的天气应用或访问天气网站获取准确的天气信息。\n\n不过我可以帮您完成以下创作任务：\n- 🎨 生成图片\n- 📹 生成视频\n- ✨ 智能抠图\n- 🎭 图片合成`;
  }

  // 自我介绍
  if (lowerText.includes('你是谁') || lowerText.includes('你能做什么') || lowerText.includes('帮助') || lowerText.includes('help')) {
    return `我是你的 AI 创意助手，主要擅长以下创作任务：\n\n🎨 **生成图片** - 描述你想要的图片，我来帮你创作\n📹 **生成视频** - 描述视频内容和时长，AI 为你生成\n✨ **智能抠图** - 去除图片背景\n🎭 **图片合成** - 提取主体并合成到新背景\n\n我也具备一定的通用问答能力，可以回答日期时间、常识问题等。直接告诉我你的需求吧！`;
  }

  // 问候语
  if (lowerText.includes('你好') || lowerText.includes('hi') || lowerText.includes('hello') || lowerText.includes('嗨')) {
    const hour = new Date().getHours();
    const greeting = hour < 6 ? '凌晨好' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    return `${greeting}！我是你的 AI 创意助手。你可以让我生成图片、视频，或者问我一些问题。直接告诉我你的需求吧！`;
  }

  // 默认回复：引导用户使用创作功能或提供通用回答
  return `我理解你的问题。${getDateTimeInfo()}\n\n关于"${message}"，我作为 AI 创意助手，主要专注于图片和视频的创作生成。如果你需要：\n- 生成图片或视频，请描述你想要的内容\n- 智能抠图或图片合成，请上传图片\n\n如果你有其他创作类需求，请告诉我详细内容！`;
}

router.get('/health', async (req: Request, res: Response) => {
  const installed = await checkHermesInstalled();
  res.json({
    success: true,
    agentReady: installed,
  });
});

router.post('/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, history } = req.body;
    
    if (!message) {
      res.status(400).json({
        success: false,
        error: 'Message is required',
      });
      return;
    }

    // 优先判断是否为通用问答类指令（如天气、时间、常识等）
    // 若是，则直接返回通用回复，不走图片/视频创作流程
    if (isGeneralQuery(message)) {
      const generalResponse = generateGeneralResponse(message);
      res.json({
        success: true,
        response: generalResponse,
        action: 'general',
        params: { query: message },
      });
      return;
    }

    const isHermesInstalled = await checkHermesInstalled();

    // RAG 检索：向量优先 + 关键词回退
    const ragResult = await semanticRAG(message);
    console.log(`[RAG] 来源: ${ragResult.source}, 模板: ${ragResult.template?.description || '无'}, 风格: ${ragResult.style?.name || '无'}`);
    const ragContext = buildRAGContext(message, ragResult.template, ragResult.style);

    // 注入长期记忆上下文（跨会话知识召回）
    const sessionId = (req as any).sessionId || 'default';
    let memoryContext = '';
    try {
      const relevantMemories = await recall({ query: message, limit: 3 });
      if (relevantMemories.length > 0) {
        memoryContext = '【历史经验】\n' + relevantMemories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
        console.log(`[Memory] 召回 ${relevantMemories.length} 条相关长期记忆`);
      }
    } catch (e) { /* 记忆召回失败不影响主流程 */ }

    // 智能路由：决定使用大模型/小模型/本地知识库
    const historyLength = (history || []).length;
    const { decision } = await smartRoute(message, historyLength);
    console.log(`[Router] ${decision.tier} → ${decision.model} | ${decision.reason}`);

    // 如果智能路由决定直接用本地知识库，跳过 LLM 调用
    if (decision.tier === 'local' && ragResult.template) {
      const localAction = ragResult.template.keywords?.[0]?.includes('视频') ? 'video' : 'image';
      addOperationLog({ level: 'INFO', category: 'agent-operation', session_id: sessionId, operation: '智能路由', detail: `本地知识库直出: ${ragResult.template.description}`, result: 'success', metadata: JSON.stringify({ tier: 'local' }) });
      res.json({ success: true, response: `根据你的需求，我推荐：${ragResult.template.description}`, action: localAction, params: { prompt: message, ragContext } });
      return;
    }

    // ===== 调度 Agent 决策：根据场景选择模型 =====
    const supervisor = supervisorRoute({
      messageLength: message.length,
      historyLength,
      hasImages: false, // /chat 端点没有图片（图片走 chat-with-image）
    });
    console.log(`[Supervisor] ${supervisor.scenario} → ${supervisor.model} | ${supervisor.reason} | reasoning=${supervisor.useReasoning}`);

    let reasoningResult: any = null;
    // 只有调度 Agent 决定需要深度推理时才用推理模型
    if (supervisor.useReasoning) {
      reasoningResult = await llmCircuitBreaker.call(
        () => callReasoningLLM(message, history || []),
        () => Promise.resolve(null)
      );
    }
    if (reasoningResult) {
      if (ragResult.template) { reasoningResult.params.prompt = (reasoningResult.params.prompt || message) + ' | ' + ragResult.template.prompt.substring(0, 150); }
      if (ragResult.style) { reasoningResult.params.style = ragResult.style.keywords[0] === '动漫' ? 'anime' : reasoningResult.params.style; }
      if (ragContext) { reasoningResult.params.ragContext = ragContext; }
      res.json({
        success: true,
        response: reasoningResult.response,
        action: reasoningResult.action,
        params: reasoningResult.params,
        reasoning: reasoningResult.reasoning?.substring(0, 500), // 返回推理过程供前端展示
        modelUsed: 'reasoning',
      });
      return;
    }

    // 推理模型不可用，降级到指令模型（glm-4-flash / deepseek-chat）
    const llmResult = await llmCircuitBreaker.call(
      () => callLLM(message, history || []),
      () => Promise.resolve(null)
    );
    if (llmResult) {
      if (ragResult.template) { llmResult.params.prompt = (llmResult.params.prompt || message) + ' | ' + ragResult.template.prompt.substring(0, 150); }
      if (ragResult.style) { llmResult.params.style = ragResult.style.keywords[0] === '动漫' ? 'anime' : llmResult.params.style; }
      if (ragContext) { llmResult.params.ragContext = ragContext; }
      res.json({ success: true, response: llmResult.response, action: llmResult.action, params: llmResult.params, modelUsed: 'instruction' });

      // 异步存储长期记忆（不阻塞响应）
      remember({
        sessionId, agentName: 'hermes',
        category: 'user_intent',
        content: `用户说"${message.substring(0, 100)}" → 识别为 ${llmResult.action}`,
        importance: 0.4,
      }).catch(() => {});
      return;
    }

    if (isHermesInstalled) {
      try {
        const escapedMessage = message.replace(/"/g, '\\"');
        const cmd = `"${HERMES_PYTHON_PATH}" -m ${HERMES_MODULE} chat -q "${escapedMessage}" -Q`;

        const { stdout: output } = await execAsync(cmd, {
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1',
            LC_ALL: 'zh_CN.UTF-8',
            LANG: 'zh_CN.UTF-8',
            GLM_API_KEY: process.env.GLM_API_KEY || process.env.ZHIPU_API_KEY || '',
          },
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        });

        if (output) {
          const lines = output.split('\n');
          const sessionIdLine = lines.find(line => line.startsWith('session_id:'));
          const responseLines = lines.filter(line => !line.startsWith('session_id:'));
          const responseText = responseLines.join('\n').trim();

          // 从 Hermes 输出中提取 action 和 params（JSON 格式）
          const hermesResult = parseHermesAction(output, message);

          res.json({
            success: true,
            response: responseText || '我理解你的需求了，正在帮你处理...',
            action: hermesResult.action,
            params: hermesResult.params,
            sessionId: sessionIdLine?.replace('session_id:', '').trim(),
          });
        } else {
          const fallbackResult = fallbackAnalyze(message);
          res.json({
            success: true,
            response: buildAnalysisSummary(fallbackResult.action, fallbackResult.params, ''),
            action: fallbackResult.action,
            params: fallbackResult.params,
          });
        }
      } catch (err) {
        console.error('Hermes execution error:', (err as Error).message?.substring(0, 100));
        const fallbackResult = fallbackAnalyze(message);
        res.json({
          success: true,
          response: buildAnalysisSummary(fallbackResult.action, fallbackResult.params, ''),
          action: fallbackResult.action,
          params: fallbackResult.params,
        });
      }
    } else {
      const fallbackResult = fallbackAnalyze(message);
      res.json({
        success: true,
        response: buildAnalysisSummary(fallbackResult.action, fallbackResult.params, ''),
        action: fallbackResult.action,
        params: fallbackResult.params,
        agentReady: false,
      });
    }
  } catch (error) {
    console.error('Hermes chat error:', error);
    const fallbackResult = fallbackAnalyze(req.body.message || '');
    res.json({
      success: true,
      response: buildAnalysisSummary(fallbackResult.action, fallbackResult.params, ''),
      action: fallbackResult.action,
      params: fallbackResult.params,
    });
  }
});

/**
 * SSE 流式聊天端点
 * POST /api/hermes/chat/stream
 * body: { message, history, sessionId }
 */
router.post('/chat/stream', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const { message, history, sessionId } = req.body;
  if (!message) {
    res.status(400).json({ success: false, error: 'message is required' });
    return;
  }

  setSSEHeaders(res);

  try {
    const systemPrompt = `你是智能 AI 助手，请充分理解用户的每一句话。不要被预设的功能列表限制。你需要完整理解用户需求并自由决定任务类型。输出 JSON：{"action":"任务类型","params":{"具体参数"},"response":"你的分析回应","contextAnalysis":"关联分析"}`;

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...(history || []).slice(-5).map((m: any) => ({ role: m.role, content: (m.content || '').substring(0, 500) })),
      { role: 'user', content: message },
    ];

    sendSSEEvent(res, 'status', { status: 'thinking', message: '正在分析你的需求...' });

    const fullResponse = await streamLLM(res, messages, { temperature: 0.7, maxTokens: 500 });
    const parsed = parseHermesAction(fullResponse, message);

    sendSSEEvent(res, 'result', {
      action: parsed.action,
      params: parsed.params,
      response: fullResponse,
      contextAnalysis: '',
    });

    addOperationLog({
      level: 'INFO', category: 'api-request',
      session_id: sessionId || '',
      operation: 'SSE 流式聊天',
      detail: `action=${parsed.action}, ${message?.substring(0, 80)}`,
      duration_ms: Date.now() - startTime,
      result: 'success',
    });

    sendSSEEnd(res);
  } catch (error) {
    addOperationLog({
      level: 'ERROR', category: 'api-request',
      operation: 'SSE 流式聊天失败',
      detail: (error as Error).message?.substring(0, 200),
      duration_ms: Date.now() - startTime,
      result: 'failure', error_text: (error as Error).message,
    });
    sendSSEError(res, (error as Error).message);
  }
});

// 图片+文字混合聊天：用视觉模型理解图片和用户意图
router.post('/chat-with-image', async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageUrls, imageUrl, message } = req.body;
    // 兼容单图 imageUrl 和多图 imageUrls
    const urls: string[] = imageUrls || (imageUrl ? [imageUrl] : []);
    
    if (urls.length === 0 || !message) {
      res.status(400).json({ success: false, error: 'image(s) and message are required' });
      return;
    }

    console.log(`[Hermes+Vision] ${urls.length} images, Message: ${message}`);

    // 多图时用首图做视觉分析，所有图信息传入 prompt
    const primaryImage = urls[0];
    const extraImagesDesc = urls.length > 1
      ? `\n\n[额外提供 ${urls.length - 1} 张参考图]`
      : '';

    const visionResult = await analyzeImageWithText({
      imageUrl: primaryImage,
      message: message + extraImagesDesc,
    });

    if (!visionResult.success) {
      console.warn('[Hermes+Vision] Vision failed, fallback to text-only:', visionResult.error);
      const fallback = fallbackAnalyze(message);
      res.json({
        success: true,
        response: '图片分析暂时不可用，我用文字理解处理你的需求...',
        action: fallback.action,
        params: fallback.params,
      });
      return;
    }

    const multiDesc = urls.length > 1
      ? `📸 已分析 ${urls.length} 张图片：${visionResult.description || ''}`
      : `📸 已分析你的图片：${visionResult.description || ''}`;

    // 将参考图片 URL 注入 params，供后续 video/image 生成使用
    const params = {
      ...(visionResult.params || fallbackAnalyze(message).params),
      referenceImages: urls, // 参考图片列表
      referenceImage: primaryImage, // 主参考图
    };

    res.json({
      success: true,
      response: `${multiDesc}\n\n根据你的指令和图片，我准备帮你创作。`,
      action: visionResult.action || fallbackAnalyze(message).action,
      params,
    });
  } catch (error) {
    console.error('[Hermes+Vision] Error:', error);
    const fallback = fallbackAnalyze(req.body.message || '');
    res.json({
      success: true,
      response: buildAnalysisSummary(fallback.action, fallback.params, ''),
      action: fallback.action,
      params: fallback.params,
    });
  }
});

// 审核接口：检查 Agent 理解是否与用户意图一致
router.post('/review', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userMessage, agentAction, agentParams, agentDescription } = req.body;

    if (!userMessage || !agentAction) {
      res.status(400).json({ success: false, error: 'userMessage and agentAction are required' });
      return;
    }

    // 先检查自学习记忆，如果有匹配直接返回
    const memoryMatch = findMemoryMatch(userMessage);
    if (memoryMatch && memoryMatch.hitCount >= 3) {
      console.log(`[ReviewAgent] 📚 Memory match! Using learned result`);
      res.json({
        success: true,
        result: {
          passed: true,
          confidence: 0.9,
          explanation: `根据历史经验（使用 ${memoryMatch.hitCount} 次），此模式已验证正确`,
          status: 'passed',
          fromMemory: true,
        },
      });
      return;
    }

    const reviewResult = await reviewUserIntent(
      userMessage,
      agentAction,
      agentParams || {},
      agentDescription || '',
    );

    res.json({ success: true, result: reviewResult });
  } catch (error) {
    console.error('[ReviewRoute] Error:', error);
    res.json({
      success: true,
      result: { passed: true, confidence: 0.3, explanation: '审核服务异常，跳过审核', status: 'passed' },
    });
  }
});

// 自学习接口：记录用户的修正
router.post('/learn', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userMessage, correctAction, correctParams } = req.body;
    if (!userMessage || !correctAction) {
      res.status(400).json({ success: false, error: 'userMessage and correctAction are required' });
      return;
    }

    await recordMemory(userMessage, correctAction, correctParams || {});
    console.log(`[Learn] Recorded: "${userMessage.substring(0, 50)}" -> ${correctAction}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// 视频全流程审核接口
router.post('/video-review', async (req: Request, res: Response): Promise<void> => {
  try {
    const { stage, userPrompt, script, params, duration, style } = req.body;

    let result: any;
    switch (stage) {
      case 'script':
        result = await reviewVideoScript(userPrompt, script, duration || '18');
        break;
      case 'params':
        result = await reviewVideoParams(userPrompt, params || {});
        break;
      case 'quick':
        result = quickScoreVideoPrompt(params?.prompt || userPrompt || '', style || '', duration || '18');
        break;
      case 'final':
        result = await reviewVideoFinal(userPrompt, style || '', duration || '18', req.body.videoUrl || '');
        break;
      default:
        result = { passed: true, level: 'ok', message: '未知阶段' };
    }

    res.json({ success: true, result });
  } catch (error) {
    res.json({ success: false, error: (error as Error).message });
  }
});

/**
 * 失败分析：Agent 任务失败后，分析原因并给出优化建议
 * POST /api/hermes/failure-analysis
 */
router.post('/failure-analysis', async (req: Request, res: Response): Promise<void> => {
  try {
    const { errorMsg, userPrompt, style, duration, engine } = req.body;
    const result = await analyzeFailure(errorMsg || '', userPrompt || '', style || '', duration || '10', engine || '未知');
    res.json({ success: true, result });
  } catch (error) {
    res.json({ success: false, error: (error as Error).message });
  }
});

export default router;