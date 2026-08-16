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
import { createCheckpoint, resolveCheckpoint, rejectCheckpoint, getLatestState, getSessionProgress, completeAgentCheckpoints, CHECKPOINT_STAGES } from '../services/checkpointService.js';

import { CHAT_MODEL, CHAT_API, getChatApiKey, CHAT_FALLBACK_MODEL, CHAT_FALLBACK_API, getChatFallbackApiKey, REASONING_MODEL, REASONING_API, getReasoningApiKey, REASONING_FALLBACK_MODEL, REASONING_FALLBACK_API, getReasoningFallbackApiKey } from '../services/llmConfig.js';
import { localLlmService } from '../services/localLlmService.js';

const HERMES_PYTHON_PATH = process.platform === 'win32' ? 'python' : 'python3';
const HERMES_MODULE = 'hermes_cli.main';

const execAsync = promisify(exec);
const router = Router();

let hermesReady: boolean | null = null;

/** 紧凑共享意图识别提示词（3处复用，减少token消耗） */
const SHARED_INTENT_PROMPT = `你是AI创意工坊意图识别器。检查对话历史关联后，将用户意图分类为8种之一。

意图类型：
- image:画/图/照片 | video:视频/片子/动画(>18秒设split:true) | compose:图片+视频都要
- modify-image/modify-video:修改已有作品(历史中有关联时，用户未说"新"则默认modify)
- remove-bg:抠图 | compose-image:合成拼接 | general:非创作问答

上下文关联规则：历史assistant消息含[上一轮任务]标注。"长一点/短一点/变成15秒"→modify-video提取原prompt。"改风格/调整"→modify-*。"再生成"→modify-*。无关联→全新创作。

参数：prompt(英文80-200词) style(realistic/cinematic/anime/3d/illustration) duration(默认10) split(>18秒true) modifyInstruction(修改要求原文) contextFromPrevious(关联信息)

输出严格JSON：{"action":"video","params":{"prompt":"...","style":"cinematic","duration":10,"split":false},"response":"友好中文回复"}`;

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
  const systemPrompt = SHARED_INTENT_PROMPT;

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
          ...history.slice(-6).map((m: any) => {
            let content = (m.content || '').substring(0, 500);
            if (m.role === 'assistant' && m.actionType) {
              const ctxParts: string[] = [`[上一轮任务: ${m.actionType}]`];
              if (m.params?.prompt) ctxParts.push(`原始描述: ${m.params.prompt}`);
              if (m.params?.style) ctxParts.push(`风格: ${m.params.style}`);
              if (m.params?.duration) ctxParts.push(`时长: ${m.params.duration}秒`);
              content = `${ctxParts.join(' | ')}\n${content}`;
            }
            return { role: m.role === 'user' ? 'user' : 'assistant', content };
          }),
          { role: 'user', content: message },
        ],
        temperature: 0.6,
        max_tokens: 800,
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

    let parsed: any;
    try { parsed = JSON.parse(jsonMatch[0]); } catch { return null; }
    const action = (parsed.action || '').toLowerCase();
    const validActions = ['modify-image', 'modify-video', 'compose-image', 'remove-bg', 'compose', 'image', 'video', 'general'];
    const mappedAction = validActions.find(a => action === a || action.startsWith(a)) || 'general';
    const params = parsed.params || {};
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
  const systemPrompt = SHARED_INTENT_PROMPT;

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
          ...history.slice(-6).map((m: any) => {
            let content = (m.content || '').substring(0, 500);
            if (m.role === 'assistant' && m.actionType) {
              const ctxParts: string[] = [`[上一轮任务: ${m.actionType}]`];
              if (m.params?.prompt) ctxParts.push(`原始描述: ${m.params.prompt}`);
              if (m.params?.style) ctxParts.push(`风格: ${m.params.style}`);
              if (m.params?.duration) ctxParts.push(`时长: ${m.params.duration}秒`);
              content = `${ctxParts.join(' | ')}\n${content}`;
            }
            return { role: m.role === 'user' ? 'user' : 'assistant', content };
          }),
          { role: 'user', content: message },
        ],
        temperature: 0.7,
        max_tokens: 300,
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

    let parsed: any;
    try { parsed = JSON.parse(jsonMatch[0]); } catch { return null; }
    const action = (parsed.action || '').toLowerCase();
    const validActions = ['modify-image', 'modify-video', 'compose-image', 'remove-bg', 'compose', 'image', 'video', 'general'];
    const mappedAction = validActions.find(a => action === a || action.startsWith(a)) || 'general';
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
 * 调用本地 Qwen3-4B 模型进行意图识别（零成本、低延迟）
 * 作为首轮推理优先调用，成功则跳过云端 API，失败时回退到 callLLM
 */
async function callLocalLLM(message: string, history: any[]): Promise<{ action: string; params: Record<string, any>; response: string } | null> {
  if (process.env.LOCAL_LLM_ENABLED !== 'true') return null;

  const modelName = 'qwen3-4b';
  if (!localLlmService.modelExists(modelName)) {
    console.warn('[LocalLLM] 模型文件不存在，跳过本地推理');
    return null;
  }

  try {
    const chatHistory = (history || []).slice(-6).map((m: any) => {
      let content = (m.content || '').substring(0, 500);
      if (m.role === 'assistant' && m.actionType) {
        const ctxParts: string[] = [`[上一轮任务: ${m.actionType}]`];
        if (m.params?.prompt) ctxParts.push(`原始描述: ${m.params.prompt}`);
        if (m.params?.style) ctxParts.push(`风格: ${m.params.style}`);
        if (m.params?.duration) ctxParts.push(`时长: ${m.params.duration}秒`);
        content = `${ctxParts.join(' | ')}\n${content}`;
      }
      return { role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content };
    });

    const result = await localLlmService.generate(message, {
      model: modelName,
      systemPrompt: SHARED_INTENT_PROMPT,
      maxTokens: 400,
      temperature: 0.5,
      history: chatHistory,
    });

    if (!result.success || !result.text) {
      console.warn(`[LocalLLM] 推理失败: ${result.error || '无输出'}`);
      return null;
    }

    const text = result.text.trim();
    console.log(`[LocalLLM] 原始输出 (${result.durationMs}ms): ${text.substring(0, 120)}...`);

    // 必须包含有效 JSON 且有 action 字段，否则视为本地模型未理解
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[LocalLLM] 输出不含 JSON，跳过本地推理');
      return null;
    }

    let parsedJson: any;
    try { parsedJson = JSON.parse(jsonMatch[0]); } catch { return null; }

    const rawAction = (parsedJson.action || parsedJson.Action || parsedJson.intent || '').toLowerCase();
    if (!rawAction) {
      console.warn('[LocalLLM] JSON 中无 action 字段，跳过');
      return null;
    }

    const parsed = parseHermesAction(text, message);
    console.log(`[LocalLLM] 意图识别成功: ${parsed.action}`);

    return {
      action: parsed.action,
      params: parsed.params,
      response: parsed.response || parsedJson.response || parsedJson.Response || buildAnalysisSummary(parsed.action, parsed.params, ''),
    };
  } catch (error) {
    console.warn('[LocalLLM] 异常:', (error as Error).message?.substring(0, 100));
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
function parseHermesAction(output: string, originalMessage: string): { action: string; params: Record<string, any>; response?: string } {
  const fallback = fallbackAnalyze(originalMessage);

  // 尝试 1: JSON 格式（贪婪匹配，捕获完整JSON含嵌套大括号）
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.action || parsed.Action || parsed.intent) {
        const action = (parsed.action || parsed.Action || parsed.intent || '').toLowerCase();
        const validActions = ['modify-image', 'modify-video', 'remove-bg', 'compose', 'image', 'video', 'general'];
        const mappedAction = validActions.find(a => action === a || action.startsWith(a)) || fallback.action;

        const params: Record<string, any> = {};
        const value = parsed.params || parsed.Parameters || parsed;
        params.prompt = value.prompt || value.description || value.Prompt || originalMessage;
        if (value.style || value.Style) params.style = value.style || value.Style;
        if (value.duration || value.Duration) params.duration = value.duration || value.Duration;
        if (value.size || value.Size) params.size = value.size || value.Size;

        return { action: mappedAction, params, response: parsed.response || parsed.Response || '' };
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
    const validActions = ['modify-image', 'modify-video', 'remove-bg', 'compose', 'image', 'video', 'general'];
    const mappedAction = validActions.find(a => action === a || action.startsWith(a)) || fallback.action;
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

  const modifyKeywords = ['修改', '更改', '换成', '改成', '长一点', '短一点', '加长', '缩短', '延长',
    '变成', '变长', '再生成', '重新生成', '换个风格', '换风格', '调整'];
  if (modifyKeywords.some(kw => lowerText.includes(kw))) {
    let modifyType = 'general';
    if (lowerText.includes('背景')) modifyType = 'background';
    else if (lowerText.includes('人物') || lowerText.includes('角色') || lowerText.includes('着装') || lowerText.includes('性别')) modifyType = 'character';
    else if (lowerText.includes('音乐') || lowerText.includes('bgm') || lowerText.includes('音效')) modifyType = 'music';
    else if (lowerText.includes('剧情') || lowerText.includes('故事') || lowerText.includes('情节')) modifyType = 'story';
    else if (lowerText.includes('风格')) modifyType = 'style';
    else if (lowerText.includes('长') || lowerText.includes('短') || lowerText.includes('秒')) modifyType = 'duration';
    else if (lowerText.includes('再生成') || lowerText.includes('重新')) modifyType = 'regenerate';

    const durationMatch = lowerText.match(/(\d+)\s*秒|(\d+)\s*s\b/);
    const duration = durationMatch ? parseInt(durationMatch[1] || durationMatch[2]) : undefined;

    return {
      action: 'modify-video',
      params: { modifyType, description: message, ...(duration && { duration }) },
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
    'hello', 'hi ', '嗨', '早上好', '下午好', '晚上好', '再见', 'bye',
    '谢谢', '感谢', 'thanks', 'ok', '好的', '收到',
    '新闻', '热点', '事件',
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
    const { decision } = await smartRoute(message, historyLength, false, ragResult);
    console.log(`[Router] ${decision.tier} → ${decision.model} | ${decision.reason}`);

    // 如果智能路由决定直接用本地知识库，跳过 LLM 调用
    if (decision.tier === 'local' && ragResult.template) {
      const localAction = ragResult.template.keywords?.[0]?.includes('视频') ? 'video' : 'image';
      addOperationLog({ level: 'INFO', category: 'agent-operation', session_id: sessionId, operation: '智能路由', detail: `本地知识库直出: ${ragResult.template.description}`, result: 'success', metadata: JSON.stringify({ tier: 'local' }) });
      res.json({ success: true, response: `根据你的需求，我推荐：${ragResult.template.description}`, action: localAction, params: { prompt: message, ragContext } });
      return;
    }

    // ===== 优先尝试本地 Qwen3-4B 推理（零成本、低延迟，30秒超时） =====
    const contextualMessage = memoryContext ? `${message}\n\n${memoryContext}` : message;
    const localTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 30000));
    const localResult = await Promise.race([
      callLocalLLM(contextualMessage, history || []),
      localTimeout,
    ]);
    if (localResult) {
      if (res.headersSent) return;
      if (ragResult.template) { localResult.params.prompt = (localResult.params.prompt || message) + ' | ' + ragResult.template.prompt.substring(0, 150); }
      if (ragResult.style) { localResult.params.style = ragResult.style.keywords[0] === '动漫' ? 'anime' : localResult.params.style; }
      if (ragContext) { localResult.params.ragContext = ragContext; }

      const cpId = createCheckpoint({
        sessionId, agentName: 'hermes',
        stage: CHECKPOINT_STAGES.HERMES_INTENT_DETECTED,
        state: { userMessage: message, action: localResult.action, params: localResult.params, response: localResult.response, modelUsed: 'local' },
        summary: `本地模型识别意图: ${localResult.action}`,
      });

      res.json({ success: true, response: localResult.response, action: localResult.action, params: localResult.params, modelUsed: 'local', checkpointId: cpId });
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
        () => callReasoningLLM(contextualMessage, history || []),
        () => Promise.resolve(null)
      );
    }
    if (reasoningResult) {
      if (ragResult.template) { reasoningResult.params.prompt = (reasoningResult.params.prompt || message) + ' | ' + ragResult.template.prompt.substring(0, 150); }
      if (ragResult.style) { reasoningResult.params.style = ragResult.style.keywords[0] === '动漫' ? 'anime' : reasoningResult.params.style; }
      if (ragContext) { reasoningResult.params.ragContext = ragContext; }

      // Checkpoint: 意图识别完成
      const cpId = createCheckpoint({
        sessionId, agentName: 'hermes',
        stage: CHECKPOINT_STAGES.HERMES_INTENT_DETECTED,
        state: { userMessage: message, action: reasoningResult.action, params: reasoningResult.params, response: reasoningResult.response, modelUsed: 'reasoning', reasoning: reasoningResult.reasoning },
        summary: `推理模型识别意图: ${reasoningResult.action}`,
      });

      res.json({
        success: true,
        response: reasoningResult.response,
        action: reasoningResult.action,
        params: reasoningResult.params,
        reasoning: reasoningResult.reasoning?.substring(0, 500), // 返回推理过程供前端展示
        modelUsed: 'reasoning',
        checkpointId: cpId,
      });
      return;
    }

    // 推理模型不可用，降级到指令模型（glm-4-flash / deepseek-chat）
    const llmResult = await llmCircuitBreaker.call(
      () => callLLM(contextualMessage, history || []),
      () => Promise.resolve(null)
    );
    if (llmResult) {
      if (ragResult.template) { llmResult.params.prompt = (llmResult.params.prompt || message) + ' | ' + ragResult.template.prompt.substring(0, 150); }
      if (ragResult.style) { llmResult.params.style = ragResult.style.keywords[0] === '动漫' ? 'anime' : llmResult.params.style; }
      if (ragContext) { llmResult.params.ragContext = ragContext; }

      // Checkpoint: 意图识别完成（指令模型）
      const cpId = createCheckpoint({
        sessionId, agentName: 'hermes',
        stage: CHECKPOINT_STAGES.HERMES_INTENT_DETECTED,
        state: { userMessage: message, action: llmResult.action, params: llmResult.params, response: llmResult.response, modelUsed: 'instruction' },
        summary: `指令模型识别意图: ${llmResult.action}`,
      });

      res.json({ success: true, response: llmResult.response, action: llmResult.action, params: llmResult.params, modelUsed: 'instruction', checkpointId: cpId });

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
    if (res.headersSent) return;
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

  // 通用问答预检查：非创作类消息直接返回自然语言回复，不走创作流程
  if (isGeneralQuery(message)) {
    setSSEHeaders(res);
    const generalResponse = generateGeneralResponse(message);
    sendSSEEvent(res, 'status', { status: 'done', message: generalResponse });
    sendSSEEvent(res, 'result', {
      action: 'general',
      params: { query: message },
      response: generalResponse,
      contextAnalysis: '',
    });
    sendSSEEnd(res);
    return;
  }

  setSSEHeaders(res);

  try {
    const systemPrompt = SHARED_INTENT_PROMPT;

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...(history || []).slice(-6).map((m: any) => {
        let content = (m.content || '').substring(0, 500);
        if (m.role === 'assistant' && m.actionType) {
          const ctxParts: string[] = [];
          ctxParts.push(`[上一轮任务: ${m.actionType}]`);
          if (m.params?.prompt) ctxParts.push(`原始描述: ${m.params.prompt}`);
          if (m.params?.style) ctxParts.push(`风格: ${m.params.style}`);
          if (m.params?.duration) ctxParts.push(`时长: ${m.params.duration}秒`);
          content = `${ctxParts.join(' | ')}\n${content}`;
        }
        return { role: m.role, content };
      }),
      { role: 'user', content: message },
    ];

    sendSSEEvent(res, 'status', { status: 'thinking', message: '正在分析你的需求...' });

    const fullResponse = await streamLLM(res, messages, { temperature: 0.7, maxTokens: 500 });
    const parsed = parseHermesAction(fullResponse, message);

    // 提取 LLM 返回的 response 字段，避免向用户展示原始 JSON
    const displayResponse = parsed.response
      || buildAnalysisSummary(parsed.action, parsed.params, '');

    sendSSEEvent(res, 'result', {
      action: parsed.action,
      params: parsed.params,
      response: displayResponse,
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

/**
 * 检查点查询：获取会话的所有活跃检查点（用于前端展示执行进度）
 * GET /api/hermes/checkpoints?sessionId=xxx
 */
router.get('/checkpoints', (req: Request, res: Response): void => {
  try {
    const sessionId = (req.query.sessionId as string) || (req as any).sessionId || 'default';
    const progress = getSessionProgress(sessionId);
    res.json({ success: true, checkpoints: progress });
  } catch (error) {
    res.json({ success: false, error: (error as Error).message });
  }
});

/**
 * 检查点恢复：获取最近的检查点状态用于恢复
 * GET /api/hermes/checkpoints/latest?sessionId=xxx&agentName=hermes
 */
router.get('/checkpoints/latest', (req: Request, res: Response): void => {
  try {
    const sessionId = (req.query.sessionId as string) || (req as any).sessionId || 'default';
    const agentName = (req.query.agentName as string) || 'hermes';
    const stage = req.query.stage as string | undefined;
    const latest = getLatestState(sessionId, agentName, stage as any);
    if (!latest) {
      res.json({ success: true, found: false, message: '没有可恢复的检查点' });
      return;
    }
    res.json({ success: true, found: true, checkpoint: latest });
  } catch (error) {
    res.json({ success: false, error: (error as Error).message });
  }
});

/**
 * 完成检查点：标记检查点为已完成
 * POST /api/hermes/checkpoints/complete
 */
router.post('/checkpoints/complete', (req: Request, res: Response): void => {
  try {
    const { checkpointId } = req.body;
    if (!checkpointId) {
      res.status(400).json({ success: false, error: 'checkpointId is required' });
      return;
    }
    resolveCheckpoint(checkpointId);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: (error as Error).message });
  }
});

/**
 * 完成 Agent 的所有检查点：任务流完全结束时调用
 * POST /api/hermes/checkpoints/complete-all
 */
router.post('/checkpoints/complete-all', (req: Request, res: Response): void => {
  try {
    const sessionId = (req.body.sessionId as string) || (req as any).sessionId || 'default';
    const agentName = (req.body.agentName as string) || 'hermes';
    const count = completeAgentCheckpoints(sessionId, agentName);
    res.json({ success: true, completedCount: count });
  } catch (error) {
    res.json({ success: false, error: (error as Error).message });
  }
});

export default router;