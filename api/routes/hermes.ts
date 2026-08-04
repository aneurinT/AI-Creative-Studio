import { Router, type Request, type Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fetchWithTimeout } from '../services/fetchUtils.js';
import { analyzeImageWithText } from '../services/imageService.js';
import { reviewUserIntent, findMemoryMatch, recordMemory } from '../services/reviewAgent.js';
import { reviewVideoScript, reviewVideoParams, quickScoreVideoPrompt, reviewVideoFinal, analyzeFailure } from '../services/videoReviewAgent.js';
import { retrievePromptTemplate, retrieveVisualStyle, buildRAGContext, semanticRAG, seedKnowledgeBase } from '../services/ragKnowledge.js';
import { logUserAction, logAgentOperation } from '../services/loggerService.js';

import { CHAT_MODEL, CHAT_API, getChatApiKey, CHAT_FALLBACK_MODEL, CHAT_FALLBACK_API, getChatFallbackApiKey } from '../services/llmConfig.js';

const HERMES_PYTHON_PATH = process.platform === 'win32' ? 'python' : 'python3';
const HERMES_MODULE = 'hermes_cli.main';

const execAsync = promisify(exec);
const router = Router();

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
  const systemPrompt = `你是一个智能 AI 助手，请充分理解用户的每一句话，进行深度分析。

## 核心原则（非常重要）
不要被任何预设的"功能列表"限制你的判断。你需要：
1. **完整理解用户需求**：用户可能想要多种操作的组合，可能是复杂工作流，不要简单归类
2. **分析历史关联**：用户说的"它"、"刚才的"、"再"、"继续"、"一样的"等，要结合历史对话理解
3. **自由决定任务类型**：根据你对用户意图的理解，自己决定最合适的 action 和处理方式
4. **给出有洞察力的回应**：不只是"收到，正在处理"，而是展示你对需求的理解

## 任务分析流程（你需要默默完成这些分析，然后输出结果）
1. 用户的核心目标是什么？
2. 与历史对话有什么关联？
3. 需要哪些步骤来完成？
4. 有哪些隐含需求？（用户没说但可能需要的）

## action 类型参考（仅供参考，你可以根据需要自由组合）
- 需要生成/创作 → image / video
- 需要修改已有的 → modify-image / modify-video
- 需要处理图片 → remove-bg / compose / ocr
- 通用问题 → general

## 输出格式（JSON）
{"action":"你判断的任务类型","params":{"具体参数"},"response":"你对需求的理解和回应","contextAnalysis":"与历史对话的关联分析"}`;

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
          ...history.slice(-5).map((m: any) => {
            // 构建富上下文历史消息
            let enrichedContent = m.content;
            if (m.role === 'assistant') {
              if (m.actionType === 'image' && m.originalPrompt) {
                enrichedContent += ` [原始图片prompt: ${m.originalPrompt}]`;
              }
              if (m.actionType === 'video' && m.originalPrompt) {
                enrichedContent += ` [原始视频prompt: ${m.originalPrompt}]`;
              }
            }
            return { role: m.role === 'user' ? 'user' : 'assistant', content: enrichedContent };
          }),
          { role: 'user', content: message },
        ],
        temperature: 0.7,
        max_tokens: 500,
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
    // 不再限制 action 白名单，agent 可以自由决定任务类型
    const action = (parsed.action || 'general').toLowerCase();

    console.log(`[${provider}] Intent: ${action} | ${parsed.response?.substring(0, 80)}`);

    return {
      action,
      params: parsed.params || {},
      response: parsed.response || '我理解你的需求了，正在帮你处理...',
      contextAnalysis: parsed.contextAnalysis || '',
    };
  } catch (error) {
    console.warn(`[${provider}] Exception:`, (error as Error).message);
    return null;
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
        const action = (parsed.action || parsed.Action || parsed.intent || 'general').toLowerCase();
        const params: Record<string, any> = {};
        const value = parsed.params || parsed.Parameters || parsed;
        params.prompt = value.prompt || value.description || value.Prompt || originalMessage;
        if (value.style || value.Style) params.style = value.style || value.Style;
        if (value.duration || value.Duration) params.duration = value.duration || value.Duration;
        if (value.size || value.Size) params.size = value.size || value.Size;
        // 透传所有额外参数，不限制
        for (const [k, v] of Object.entries(value)) {
          if (!['prompt', 'style', 'duration', 'size'].includes(k)) {
            params[k] = v;
          }
        }
        return { action, params };
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
    const action = (kvMap.action || kvMap.intent || 'general').toLowerCase();
    const params: Record<string, any> = {};
    params.prompt = kvMap.prompt || kvMap.description || originalMessage;
    if (kvMap.style) params.style = kvMap.style;
    if (kvMap.duration) params.duration = kvMap.duration;
    if (kvMap.size) params.size = kvMap.size;
    // 透传额外参数
    for (const [k, v] of Object.entries(kvMap)) {
      if (!['action', 'intent', 'prompt', 'description', 'style', 'duration', 'size'].includes(k)) {
        params[k] = v;
      }
    }
    return { action, params };
  }

  // 回退
  return fallback;
}

function fallbackAnalyze(message: string): { action: string; params: Record<string, any> } {
  const lowerText = message.toLowerCase();

  // 检测修改类意图
  if (lowerText.includes('修改') || lowerText.includes('更改') || lowerText.includes('换成') || lowerText.includes('改成')) {
    const isVideo = lowerText.includes('视频') || lowerText.includes('video');
    const isImage = lowerText.includes('图片') || lowerText.includes('图像') || lowerText.includes('image') || lowerText.includes('图');
    let modifyType = 'general';
    if (lowerText.includes('背景')) modifyType = 'background';
    else if (lowerText.includes('人物') || lowerText.includes('角色') || lowerText.includes('着装')) modifyType = 'character';
    else if (lowerText.includes('音乐') || lowerText.includes('bgm') || lowerText.includes('音效')) modifyType = 'music';
    else if (lowerText.includes('剧情') || lowerText.includes('故事') || lowerText.includes('情节')) modifyType = 'story';
    else if (lowerText.includes('风格')) modifyType = 'style';

    return {
      action: isVideo ? 'modify-video' : isImage ? 'modify-image' : 'modify-video',
      params: { modifyType, description: message, prompt: message },
    };
  }

  // 检测任务类型
  let action = 'image'; // 默认图片
  if (lowerText.includes('视频') || lowerText.includes('video') || lowerText.includes('片子') || lowerText.includes('短片')) {
    action = 'video';
  } else if (lowerText.includes('抠图') || lowerText.includes('去背景') || lowerText.includes('移除背景') || lowerText.includes('removebg')) {
    action = 'remove-bg';
  } else if (lowerText.includes('合成') || lowerText.includes('组合') || lowerText.includes('叠加')) {
    action = 'compose';
  } else if (lowerText.includes('识别') || lowerText.includes('ocr') || lowerText.includes('提取文字') || lowerText.includes('识别文字')) {
    action = 'ocr';
  } else if (isGeneralQuery(message)) {
    action = 'general';
  }

  return {
    action,
    params: { prompt: message },
  };
}

// 判断是否为通用问答类指令
// 不再严格排除"创作类关键词"，让 agent 自行判断
function isGeneralQuery(message: string): boolean {
  const lowerText = message.toLowerCase();

  // 疑问句式判断
  const questionPatterns = [
    /[?？]$/,
    /^(什么是|为什么|怎么|如何|哪里|哪个|谁|何时|多少)/,
    /^(what|why|how|where|when|who|which)\s/i,
  ];

  // 纯粹的知识问答/闲聊
  const pureGeneralKeywords = [
    '天气', '气温', '温度', '下雨', '下雪', '天气预报',
    '你好', '你是谁', '能做什么', '帮助', 'help',
    '翻译', '计算', '算一下',
  ];

  if (pureGeneralKeywords.some(kw => lowerText.includes(kw))) return true;
  if (questionPatterns.some(p => p.test(message))) return true;

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
  const startTime = Date.now();
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
      logUserAction({
        operation: '意图识别',
        detail: `通用问答: ${message?.substring(0, 100)}`,
        result: 'success',
        duration: Date.now() - startTime,
        metadata: { action: 'general' },
      });
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

    const llmResult = await callLLM(message, history || []);
    if (llmResult) {
      if (ragResult.template) { llmResult.params.prompt = (llmResult.params.prompt || message) + ' | ' + ragResult.template.prompt.substring(0, 150); }
      if (ragResult.style) { llmResult.params.style = ragResult.style.keywords[0] === '动漫' ? 'anime' : llmResult.params.style; }
      if (ragContext) { llmResult.params.ragContext = ragContext; }
      logUserAction({
        operation: '意图识别',
        detail: `LLM识别: action=${llmResult.action}, ${message?.substring(0, 80)}`,
        result: 'success',
        duration: Date.now() - startTime,
        metadata: { action: llmResult.action, provider: 'LLM' },
      });
      res.json({ success: true, response: llmResult.response, action: llmResult.action, params: llmResult.params, contextAnalysis: (llmResult as any).contextAnalysis || '' });
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
            response: '我理解你的需求了，正在帮你处理...',
            action: fallbackResult.action,
            params: fallbackResult.params,
          });
        }
      } catch (err) {
        console.error('Hermes execution error:', (err as Error).message?.substring(0, 100));
        const fallbackResult = fallbackAnalyze(message);
        res.json({
          success: true,
          response: '我理解你的需求了，正在帮你处理...',
          action: fallbackResult.action,
          params: fallbackResult.params,
        });
      }
    } else {
      const fallbackResult = fallbackAnalyze(message);
      res.json({
        success: true,
        response: '我理解你的需求了，正在帮你处理...',
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
      response: '我理解你的需求了，正在帮你处理...',
      action: fallbackResult.action,
      params: fallbackResult.params,
    });
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

    res.json({
      success: true,
      response: `${multiDesc}\n\n根据你的指令和图片，我准备帮你创作。`,
      action: visionResult.action || fallbackAnalyze(message).action,
      params: visionResult.params || fallbackAnalyze(message).params,
    });
  } catch (error) {
    console.error('[Hermes+Vision] Error:', error);
    const fallback = fallbackAnalyze(req.body.message || '');
    res.json({
      success: true,
      response: '我理解你的需求了，正在帮你处理...',
      action: fallback.action,
      params: fallback.params,
    });
  }
});

// 审核接口：检查 Agent 理解是否与用户意图一致
router.post('/review', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
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
      logAgentOperation({
        agentName: '审核Agent',
        agentRole: 'reviewer',
        operation: '审核检查',
        detail: `记忆匹配: ${userMessage?.substring(0, 80)} -> ${agentAction}`,
        result: 'success',
        duration: Date.now() - startTime,
        input: userMessage?.substring(0, 200),
      });
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

    logAgentOperation({
      agentName: '审核Agent',
      agentRole: 'reviewer',
      operation: '审核检查',
      detail: `审核结果: ${reviewResult.passed ? '通过' : '未通过'} - ${reviewResult.explanation}`,
      result: reviewResult.passed ? 'success' : 'failure',
      duration: Date.now() - startTime,
      input: userMessage?.substring(0, 200),
      output: JSON.stringify(reviewResult)?.substring(0, 300),
    });

    res.json({ success: true, result: reviewResult });
  } catch (error) {
    logAgentOperation({
      agentName: '审核Agent',
      agentRole: 'reviewer',
      operation: '审核异常',
      detail: `异常: ${(error as Error).message}`,
      result: 'failure',
      duration: Date.now() - startTime,
      error: (error as Error).message,
    });
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
  const startTime = Date.now();
  try {
    const { errorMsg, userPrompt, style, duration, engine } = req.body;
    const result = await analyzeFailure(errorMsg || '', userPrompt || '', style || '', duration || '10', engine || '未知');
    logAgentOperation({
      agentName: '审核Agent',
      agentRole: 'reviewer',
      operation: '失败分析',
      detail: `错误: ${errorMsg?.substring(0, 100)} | 引擎: ${engine}`,
      result: 'success',
      duration: Date.now() - startTime,
      error: errorMsg?.substring(0, 300),
      output: result?.reason?.substring(0, 200),
    });
    res.json({ success: true, result });
  } catch (error) {
    logAgentOperation({
      agentName: '审核Agent',
      agentRole: 'reviewer',
      operation: '失败分析异常',
      detail: `异常: ${(error as Error).message}`,
      result: 'failure',
      duration: Date.now() - startTime,
      error: (error as Error).message,
    });
    res.json({ success: false, error: (error as Error).message });
  }
});

export default router;