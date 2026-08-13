import { Router, type Request, type Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { REASONING_MODEL, REASONING_API, getReasoningApiKey, REASONING_FALLBACK_MODEL, REASONING_FALLBACK_API, getReasoningFallbackApiKey } from '../services/llmConfig.js';
import { recordAgentTurn, checkAndCompress, getAgentContext, remember, recall } from '../services/agentMemory.js';
import { toolRegistry } from '../services/toolRegistry.js';
import { analyzeParallelism, executePlan, type OrchestrationContext } from '../services/orchestrator.js';
import { analyzeImageWithText } from '../services/imageService.js';
import { supervisorRoute } from '../services/modelRouter.js';
import { videoEditService, type EditOperation, type EditParams } from '../services/videoEditService.js';
import { createTrace, finishTrace } from '../services/tracing.js';

const execAsync = promisify(exec);
const router = Router();

const HERMES_PYTHON_PATH = process.platform === 'win32' ? 'python' : 'python3';
const HERMES_MODULE = 'hermes_cli.main';
const HERMES_TIMEOUT = 30_000; // 30秒超时（异步不阻塞事件循环）

/**
 * 多模态预处理：如果用户提供了图片，先用视觉模型分析图片内容，
 * 将图片描述融入用户消息中，让 Agent 能"看到"图片内容进行创作
 * @returns 增强后的 message 字符串（包含图片描述）
 */
async function enrichMessageWithVision(
  message: string,
  imageUrls?: string[],
): Promise<{ message: string; imageDescription?: string }> {
  if (!imageUrls || imageUrls.length === 0) {
    return { message };
  }

  try {
    const primaryImage = imageUrls[0];
    console.log(`[Agent Vision] Analyzing image for agent: ${primaryImage.substring(0, 80)}...`);

    const visionResult = await analyzeImageWithText({
      imageUrl: primaryImage,
      message: message,
    });

    if (visionResult?.description) {
      const extraImagesNote = imageUrls.length > 1
        ? `（用户还提供了 ${imageUrls.length - 1} 张参考图片）`
        : '';

      const enrichedMessage = `【参考图片视觉描述】${visionResult.description}${extraImagesNote}\n\n【用户指令】${message}\n\n请基于以上图片内容和用户指令进行创作。你的创作应该以图片中的主体、场景、风格为参考基础。`;

      console.log(`[Agent Vision] Image analyzed: ${visionResult.description.substring(0, 60)}...`);
      return { message: enrichedMessage, imageDescription: visionResult.description };
    }
  } catch (err) {
    console.warn('[Agent Vision] Analysis failed, falling back to text-only:', (err as Error).message);
  }

  return { message };
}

interface AgentThought {
  agentName: string;
  role: string;
  step: number;
  thought: string;
  action?: string;
  output?: string;
  timestamp: number;
}

interface AgentContext {
  sessionId: string;
  userInput: string;
  thoughts: AgentThought[];
  finalResult?: Record<string, any>;
  /** 历史任务记录（保留所有任务，不会被覆盖） */
  taskHistory: TaskRecord[];
  createdAt: number;
  updatedAt: number;
}

interface TaskRecord {
  /** 任务类型：storyWriter | videoAnalyzer | imageCreator */
  agentRole: string;
  /** 任务描述摘要 */
  summary: string;
  /** 任务结果的关键信息 */
  keyInfo: Record<string, any>;
  /** 时间戳 */
  timestamp: number;
}

const agentContexts: Map<string, AgentContext> = new Map();

let hermesReady: boolean | null = null;

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 构建历史任务摘要，供 Agent 进行上下文关联分析
 */
function buildTaskHistorySummary(context: AgentContext | undefined): string {
  if (!context || context.taskHistory.length === 0) return '';

  const recentTasks = context.taskHistory.slice(-5); // 最近 5 个任务
  const summaries = recentTasks.map((task, i) => {
    const idx = context.taskHistory.length - recentTasks.length + i + 1;
    return `[任务${idx}] ${task.agentRole}: ${task.summary}`;
  });

  return `📋 **历史任务记录（共 ${context.taskHistory.length} 个任务）：**\n${summaries.join('\n')}\n\n请检查当前请求是否与上述历史任务有关联。`;
}

/**
 * 记录任务到 agentContexts 的历史中
 */
function recordTask(sessionId: string, agentRole: string, summary: string, keyInfo: Record<string, any>) {
  const context = agentContexts.get(sessionId);
  if (!context) return;

  context.taskHistory.push({
    agentRole,
    summary,
    keyInfo,
    timestamp: Date.now(),
  });

  // 限制最多保留 20 条
  if (context.taskHistory.length > 20) {
    context.taskHistory = context.taskHistory.slice(-20);
  }
  context.updatedAt = Date.now();
}

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

/** 使用推理模型进行专家级深度分析（DeepSeek-R1 / GLM-Z1）
 *  调度 Agent 决策：如果场景不需要深度推理，直接返回 null 触发降级到小模型 */
async function callReasoningAgent(
  message: string,
  systemPrompt: string,
  sessionId: string,
  history?: any[],
  agentName?: string,
  intent?: string,
): Promise<{ content: string; reasoning: string } | null> {
  // ===== 调度 Agent 决策 =====
  const supervisor = supervisorRoute({
    agentName,
    intent,
    messageLength: message.length,
    historyLength: (history || []).length,
  });

  if (!supervisor.useReasoning) {
    console.log(`[Supervisor] 跳过推理模型: ${supervisor.scenario} → ${supervisor.model} | ${supervisor.reason}`);
    return null; // 触发调用方降级到小模型
  }

  console.log(`[Supervisor] 使用推理模型: ${supervisor.scenario} → ${supervisor.model} | ${supervisor.reason}`);

  // 获取 Agent 上下文（含历史任务记录）
  const context = agentContexts.get(sessionId);
  const prevResult = context?.finalResult ? JSON.stringify(context.finalResult).substring(0, 800) : '';

  // 构建历史任务摘要
  const taskHistorySummary = buildTaskHistorySummary(context);

  const contextMessages: any[] = [{ role: 'system', content: systemPrompt }];

  // 上下文融合规则：如果用户之前有多个相关任务，需要智能合并
  contextMessages.push({
    role: 'system',
    content: `【上下文融合规则】如果对话历史中用户连续提出了多个相关的创作请求（如"晴天视频"+"小女孩跳舞"），你需要将它们的核心元素融合成一个统一的输出，而不是只处理最后一个请求。例如：历史中有"晴天场景"和"小女孩跳舞"，当前用户可能希望得到"小女孩在晴天跳舞"的融合结果。`
  });

  if (history && history.length > 0) {
    const recent = history.slice(-15).map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'assistant' as const,
      content: m.role === 'assistant' && m.actionType
        ? `${typeof m.content === 'string' ? m.content.substring(0, 300) : ''} [已执行: ${m.actionType}]`
        : typeof m.content === 'string' ? m.content.substring(0, 500) : '',
    }));
    contextMessages.push(...recent);
  }
  if (taskHistorySummary) {
    contextMessages.push({ role: 'assistant', content: taskHistorySummary });
  }
  if (prevResult) {
    contextMessages.push({ role: 'assistant', content: `上一轮处理结果：${prevResult}` });
  }
  contextMessages.push({ role: 'user', content: `用户需求：${message}\n\n请深度理解这个任务的真正意图，不要被表面文字限制。如果对话历史中有多个相关的创作请求，请智能融合它们的核心元素。结合上下文关联分析，自由拆解任务，给出你最专业的分析和输出。` });

  // 尝试 DeepSeek-R1
  const r1Key = getReasoningApiKey();
  if (r1Key) {
    try {
      const response = await fetch(REASONING_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${r1Key}` },
        body: JSON.stringify({ model: REASONING_MODEL, messages: contextMessages, temperature: 0.7, max_tokens: 4000 }),
        signal: AbortSignal.timeout(90000),
      });
      if (response.ok) {
        const data = await response.json() as any;
        const msg = data.choices?.[0]?.message;
        const reasoning = msg?.reasoning_content || '';
        const content = msg?.content?.trim();
        if (content) {
          console.log(`[ReasoningAgent] DeepSeek-R1 analysis: ${reasoning.substring(0, 150)}...`);
          return { content, reasoning };
        }
      }
    } catch (e) {
      console.warn('[ReasoningAgent] DeepSeek-R1 failed:', (e as Error).message);
    }
  }

  // 降级到 GLM-Z1
  const z1Key = getReasoningFallbackApiKey();
  if (z1Key) {
    try {
      const response = await fetch(REASONING_FALLBACK_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${z1Key}` },
        body: JSON.stringify({ model: REASONING_FALLBACK_MODEL, messages: contextMessages, temperature: 0.6, max_tokens: 3000 }),
        signal: AbortSignal.timeout(60000),
      });
      if (response.ok) {
        const data = await response.json() as any;
        const msg = data.choices?.[0]?.message;
        const reasoning = msg?.reasoning_content || '';
        const content = msg?.content?.trim();
        if (content) {
          console.log(`[ReasoningAgent] GLM-Z1 analysis: ${reasoning.substring(0, 150)}...`);
          return { content, reasoning };
        }
      }
    } catch (e) {
      console.warn('[ReasoningAgent] GLM-Z1 failed:', (e as Error).message);
    }
  }

  return null;
}

/** 异步调用 Hermes Python CLI */
async function callHermesWithContext(message: string, systemPrompt: string, sessionId: string, history?: any[], agentName?: string): Promise<string> {
  // 获取 Agent 上下文（含历史任务记录）
  const context = agentContexts.get(sessionId);
  const prevResult = context?.finalResult ? JSON.stringify(context.finalResult).substring(0, 500) : '';
  const taskHistorySummary = buildTaskHistorySummary(context);

  // 构建带上下文的 messages
  const enhancedSystemPrompt = systemPrompt + '\n\n## 可用工具\n' +
    toolRegistry.list().map(t => `- **${t.name}**: ${t.description}`).join('\n') +
    '\n\n你可以通过返回 JSON 中的 "action" 字段指定要调用的工具名。';
  const contextMessages: any[] = [{ role: 'system', content: enhancedSystemPrompt }];

  // 注入长期记忆（跨会话知识）
  if (agentName) {
    const relevantMemories = await recall({ agentName, query: message, limit: 3 });
    if (relevantMemories.length > 0) {
      const memoryContext = '【历史经验】\n' + relevantMemories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
      contextMessages.push({ role: 'system', content: memoryContext });
    }
  }

  // 添加短期记忆（会话内上下文）
  if (agentName) {
    const shortCtx = getAgentContext(sessionId, agentName);
    if (shortCtx.length > 0) {
      contextMessages.push(...shortCtx.slice(-10));
    }
  }

  // 添加历史对话
  if (history && history.length > 0) {
    const recent = history.slice(-15).map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'assistant' as const,
      content: typeof m.content === 'string' ? m.content.substring(0, 500) : '',
    }));
    contextMessages.push(...recent);
  }

  // 添加历史任务记录（共享上下文）
  if (taskHistorySummary) {
    contextMessages.push({ role: 'assistant', content: taskHistorySummary });
  }

  // 注入其他 Agent 的上下文快照（共享上下文 — 所有 Agent 都能看到彼此的结果）
  if (context && context.taskHistory && context.taskHistory.length > 0) {
    const otherAgents = context.taskHistory
      .filter(t => t.agentRole !== agentName) // 排除当前 agent 自己的历史
      .slice(-3)
      .map(t => `[${t.agentRole}]: ${t.summary}`).join('\n');
    if (otherAgents) {
      contextMessages.push({ role: 'system', content: `【其他Agent的上下文】\n${otherAgents}` });
    }
  }

  // 添加上一轮 Agent 结果
  if (prevResult) {
    contextMessages.push({ role: 'assistant', content: `上一轮处理结果：${prevResult}` });
  }

  contextMessages.push({ role: 'user', content: `用户需求：${message}\n\n请深度理解任务本质，自由拆解分析，输出你的专业方案。不要被预设格式限制，以最能表达你创意的方式输出。` });

  // 优先 LLM API
  const apiKey = process.env.ZHIPU_API_KEY;
  if (apiKey) {
    try {
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'glm-4-flash', messages: contextMessages, temperature: 0.8, max_tokens: 2000 }),
        signal: AbortSignal.timeout(35000),
      });
      if (response.ok) {
        const data = await response.json() as any;
        const content = data.choices?.[0]?.message?.content?.trim();
        if (content) return content;
      }
      console.warn(`[Agent] LLM API failed: ${response.status}`);
    } catch (e) {
      console.warn('[Agent] LLM API exception:', (e as Error).message);
    }
  }

  // 降级：本地 Hermes
  try {
    const installed = await checkHermesInstalled();
    if (installed) {
      const fullMessage = `${systemPrompt}\n\n${prevResult ? `上一步结果：${prevResult}\n` : ''}用户需求：${message}`;
      const escapedMessage = fullMessage.replace(/"/g, '\\"');
      const cmd = `"${HERMES_PYTHON_PATH}" -m ${HERMES_MODULE} chat -q "${escapedMessage}" -Q`;
      const { stdout } = await execAsync(cmd, {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', GLM_API_KEY: process.env.GLM_API_KEY || '' },
        timeout: HERMES_TIMEOUT, maxBuffer: 1024 * 1024, windowsHide: true,
      });
      const output = stdout?.trim() || '';
      const lines = output.split('\n').filter(l => !l.startsWith('session_id:'));
      const response = lines.join('\n').trim();
      if (response && !response.includes('系统指令') && !response.includes('请提供')) return response;
    }
  } catch { }

  // 最终降级：本地模板
  return generateMockScript(message);
}

const AGENT_CONFIGS = {
  storyWriter: {
    name: '故事创作专家',
    role: 'storyWriter',
    systemPrompt: `你是一位顶级的创意导演和故事创作大师。你的任务没有预设边界——根据用户的真实需求，自由发挥你的创造力。

## 工作方式
你不是一个填模板的机器。你需要像真正的创意人一样思考：

### 第一步：深度理解
- 用户到底想要什么？背后的情感是什么？
- 这个需求属于什么类型？（广告/宣传/艺术短片/Vlog/纪录片/动画/MV/教程/...）
- 目标受众是谁？平台是什么？（抖音/YouTube/TV/发布会/...）
- 如果有上下文关联，之前做了什么？如何延续或突破？

### 第二步：自主拆解
根据你对需求的理解，自主决定创作方案：
- 需要几个场景？每个场景多少秒？你来决定
- 需要什么样的叙事结构？（线性/倒叙/平行/环形/...）你来决定
- 用什么视觉语言？（写实/超现实/极简/复古/...）你来决定
- 节奏如何控制？（快剪/长镜头/慢动作/...）你来决定

### 第三步：自由输出
根据你的分析，输出最合适的脚本格式。不限制你输出什么结构——可以是：
- 传统分镜脚本
- 故事板描述
- 情绪板 + 关键帧描述
- 诗意化的叙事文本
- 任何你认为能最好表达创意的形式

**唯一要求**：每个场景/段落必须包含足够的视觉信息，让视频制作专家能够据此生成视频。

记住：你是一个有独立审美的创作者，不是模板填充器。`,
  },
  videoMaker: {
    name: '视频制作专家',
    role: 'videoMaker',
    systemPrompt: `你是顶级的视频制作人和技术导演。你的任务是理解故事创作专家的脚本，将其转化为可执行的视频生成方案。

## 工作方式
你不是参数提取器。你需要像一个真正的制作人一样分析：

### 第一步：深度解读脚本
- 脚本的核心视觉主题是什么？情感基调是什么？
- 每个场景最关键的视觉元素是什么？（主体、光线、运镜、色调、氛围）
- 脚本的节奏如何？哪里该快、哪里该慢？
- 如果有上下文关联，之前的视频参数是什么？需要保持一致还是突破？

### 第二步：自主拆解
根据脚本内容和你的理解，自主决定：
- 总共需要几个分镜？每个分镜多长时间？你来决定
- **重要：单段视频生成上限为 18 秒。如果总时长超过 18 秒，必须将脚本拆分为多个片段（每个片段 ≤ 18 秒），确保每个片段的 prompt 是独立且视觉连贯的**
- 每个分镜的英文 prompt 怎么写？你来创作（必须包含：主体+动作+场景+光线+运镜+画质关键词）
- 整体视觉风格是什么？你来判断（cinematic/anime/realistic/3d/illustration/...）
- 分镜之间如何过渡？（cut/fade/dissolve/wipe/...）你来设计
- 总时长？从脚本或用户需求中提取
- **长视频分镜规则：**
  - 每个片段的 prompt 必须包含与上一片段连续的主体、场景、色调信息
  - 片段之间需要视觉过渡提示（如"画面从上一个场景自然过渡..."）
  - 开场片段需要建立场景氛围，结尾片段需要收束情绪

### 第三步：结构化输出
输出 JSON 格式，但内容由你决定：
{
  "prompt": "主提示词（英文，80-200词）",
  "style": "你判断的风格",
  "duration": 总时长数字,
  "sceneBreakdown": [
    {
      "scene": 序号,
      "description": "这个镜头的中文描述",
      "prompt": "这个镜头的英文生成prompt",
      "duration": 时长数字,
      "camera": "运镜方式",
      "transition": "过渡方式"
    }
  ]
}

你是有独立判断力的视频制作专家，不是参数填充机器。`,
  },
  imageCreator: {
    name: '图像创作专家',
    role: 'imageCreator',
    systemPrompt: `你是一位世界级的视觉艺术家和图像创作大师。你的任务是根据用户需求，创作出令人惊叹的视觉作品。

## 工作方式
你是有独立审美和创作自由的艺术家：

### 第一步：深度理解
- 用户想要表达什么？情感核心是什么？
- 这是什么类型的图像？（摄影/插画/海报/壁纸/概念艺术/产品图/...）
- 目标用途是什么？（社交分享/商业海报/艺术创作/头像/...）
- 如果有上下文关联，之前创作了什么？如何延续或演化？

### 第二步：自由创作
根据你的艺术判断，自主决定：
- **构图**：三分法、居中、对角线、引导线、框架构图...你来选
- **光影**：黄金时刻、阴天柔和光、霓虹灯光、Rembrandt光...你来定
- **色调**：暖色调、冷色调、黑白、高饱和、莫兰迪色...你来配
- **风格**：写实摄影/二次元/赛博朋克/油画/水彩/极简/波普...你来创
- **尺寸**：根据用途判断（头像1:1/海报3:4/壁纸16:9/...）

### 第三步：创作 prompt
将你的艺术构想转化为高质量英文 prompt，格式自由：
- 可以是一段完整的英文描述
- 也可以是分段的专业摄影/绘画 prompt
- 包含：主体描述 + 场景 + 光线 + 色调 + 构图 + 风格 + 画质关键词

你是一个真正的创作者，不是 prompt 生成器。让你的艺术判断力主导创作。`,
  },
  videoEditor: {
    name: '视频剪辑专家',
    role: 'videoEditor',
    systemPrompt: `你是一位顶级的视频后期制作专家。你精通视频剪辑、字幕制作、配音合成和片段替换。

## 核心能力
1. **字幕添加**：根据用户需求，为视频添加精准的字幕（烧录到视频上）
2. **配音替换**：根据用户提供的文案，替换视频的音频轨道
3. **片段替换**：识别用户指定的不满意的片段，用新素材替换
4. **智能剪辑**：理解用户的剪辑意图，执行精准的裁剪和拼接

## 工作方式

### 第一步：理解意图
- 用户想要修改什么？（字幕/配音/裁剪/替换片段）
- 用户对当前视频哪个部分不满意？具体是什么问题？
- 用户期望的最终效果是什么？

### 第二步：精准分析
- 如果是字幕：源语言是什么？字幕风格要求？
- 如果是配音：配音文案是什么？需要什么音色和语速？
- 如果是片段替换：替换哪个时间段？原因是什么？
- 如果是裁剪：保留哪些部分？

### 第三步：输出执行方案
以 JSON 格式输出剪辑方案：
{
  "action": "subtitle" | "dubbing" | "trim" | "replace" | "smart-edit",
  "analysis": "你对用户需求的理解和分析",
  "params": {
    "trimStart": 数字（秒）,
    "trimEnd": 数字（秒）,
    "subtitleLang": "zh",
    "dubbingText": "配音文案",
    "dubbingVoice": "zh-CN-XiaoxiaoNeural",
    "dubbingSpeed": 1.0,
    "replaceStart": 数字（秒）,
    "replaceEnd": 数字（秒）,
    "smartEditPrompt": "智能剪辑提示"
  },
  "explanation": "向用户解释你会如何处理这个视频"
}

## 重要规则
- 你必须输出 JSON 格式，不要输出其他内容
- 只输出执行方案，不要输出实际剪辑结果
- 如果用户没有指定具体参数，你根据常识合理推断
- 对于配音，如果用户没有指定音色，默认使用温柔女声`,
  },
};

router.get('/health', async (req: Request, res: Response) => {
  const installed = await checkHermesInstalled();
  res.json({
    success: true,
    agents: Object.keys(AGENT_CONFIGS),
    hermesReady: installed,
  });
});

router.get('/context/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const context = agentContexts.get(sessionId);

  if (context) {
    res.json({
      success: true,
      context,
    });
  } else {
    res.json({
      success: false,
      error: 'Session not found',
    });
  }
});

router.get('/context/:sessionId/thoughts', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const context = agentContexts.get(sessionId);

  if (context) {
    res.json({
      success: true,
      thoughts: context.thoughts,
      sessionId: context.sessionId,
      userInput: context.userInput,
    });
  } else {
    res.json({
      success: false,
      error: 'Session not found',
    });
  }
});

router.post('/story/write', async (req: Request, res: Response) => {
  try {
    const { message, sessionId: existingSessionId, history, imageUrls } = req.body;

    // 多模态预处理：分析参考图片
    const visionResult = await enrichMessageWithVision(message, imageUrls);
    const enrichedMessage = visionResult.message;

    const sessionId = existingSessionId || generateSessionId();
    const config = AGENT_CONFIGS.storyWriter;

    const existingContext = agentContexts.get(sessionId);
    const context: AgentContext = existingContext || {
      sessionId,
      userInput: enrichedMessage,
      thoughts: [],
      taskHistory: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 1,
      thought: '🔗 第一步：检查上下文关联，分析是否与历史任务有关...',
      timestamp: Date.now(),
    });

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 2,
      thought: '🧠 推理模型正在深度分析需求，构建故事情节和场景...',
      timestamp: Date.now(),
    });

    // 优先使用推理模型进行深度分析（调度Agent决定是否使用推理模型）
    const reasoningResult = await callReasoningAgent(enrichedMessage, config.systemPrompt, sessionId, history, config.role, 'video');
    let hermesResponse = '';
    let reasoningTrace = '';

    if (reasoningResult) {
      hermesResponse = reasoningResult.content;
      reasoningTrace = reasoningResult.reasoning;
    } else {
      // 降级到指令模型
      hermesResponse = await callHermesWithContext(enrichedMessage, config.systemPrompt, sessionId, history, config.role);
    }

    let script = '';
    if (hermesResponse) {
      script = hermesResponse;
    } else {
      script = generateMockScript(message);
    }

    // 记录短期记忆
    recordAgentTurn({ sessionId, agentName: config.role, turnIndex: context.thoughts.length, role: 'user', content: message });
    recordAgentTurn({ sessionId, agentName: config.role, turnIndex: context.thoughts.length + 1, role: 'assistant', content: script.substring(0, 500), summary: script.substring(0, 100) });
    // 检查并压缩
    checkAndCompress(sessionId, config.role).catch(() => { });

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 3,
      thought: '脚本创作完成',
      action: 'script_generated',
      output: script.substring(0, 100) + (script.length > 100 ? '...' : ''),
      timestamp: Date.now(),
    });

    context.finalResult = { script };
    context.updatedAt = Date.now();
    // 记录到任务历史
    recordTask(sessionId, config.role, `视频脚本创作：${script.substring(0, 80)}...`, { script: script.substring(0, 200) });
    agentContexts.set(sessionId, context);

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      result: { script },
      thoughts: context.thoughts,
      reasoning: reasoningTrace?.substring(0, 500),
      modelUsed: reasoningResult ? 'reasoning' : 'instruction',
    });
  } catch (error) {
    console.error('Story writer error:', error);
    res.json({
      success: false,
      error: `故事创作失败: ${(error as Error).message}`,
    });
  }
});

router.post('/video/analyze', async (req: Request, res: Response) => {
  try {
    const { script, sessionId: existingSessionId, originalMessage, history, imageUrls } = req.body;

    // 多模态预处理：分析参考图片，将视觉信息融入脚本
    const visionResult = await enrichMessageWithVision(script, imageUrls);
    const enrichedScript = visionResult.message;

    const sessionId = existingSessionId || generateSessionId();
    const config = AGENT_CONFIGS.videoMaker;

    const existingContext = agentContexts.get(sessionId);
    const context: AgentContext = existingContext || {
      sessionId,
      userInput: originalMessage || script,
      thoughts: [],
      taskHistory: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 1,
      thought: '🔗 第一步：检查上下文关联，分析是否与历史任务有关...',
      timestamp: Date.now(),
    });

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 2,
      thought: '🧠 推理模型正在深度分析视频参数：主题、风格、时长、分镜...',
      timestamp: Date.now(),
    });

    // 优先使用推理模型（调度Agent决定）
    const reasoningResult = await callReasoningAgent(enrichedScript, config.systemPrompt, sessionId, history, config.role, 'video');
    let hermesResponse = '';
    let reasoningTrace = '';

    if (reasoningResult) {
      hermesResponse = reasoningResult.content;
      reasoningTrace = reasoningResult.reasoning;
    } else {
      hermesResponse = await callHermesWithContext(enrichedScript, config.systemPrompt, sessionId, history, config.role);
    }

    // 短期记忆
    recordAgentTurn({ sessionId, agentName: config.role, turnIndex: 0, role: 'user', content: enrichedScript?.substring(0, 300) });
    checkAndCompress(sessionId, config.role).catch(() => { });

    let analysis = {};
    if (hermesResponse) {
      try {
        const jsonMatch = hermesResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          analysis = parseAnalysisFromText(hermesResponse, enrichedScript);
        }
      } catch {
        analysis = parseAnalysisFromText(hermesResponse, script);
      }
    } else {
      analysis = generateMockVideoAnalysis(enrichedScript);
    }

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 3,
      thought: '参数分析完成，准备生成视频',
      action: 'parameters_extracted',
      output: JSON.stringify(analysis),
      timestamp: Date.now(),
    });

    context.finalResult = analysis;
    context.updatedAt = Date.now();
    recordTask(sessionId, config.role, `${config.name}完成分析`, { action: 'analyzed' });
    agentContexts.set(sessionId, context);

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      result: analysis,
      thoughts: context.thoughts,
      reasoning: reasoningTrace?.substring(0, 500),
      modelUsed: reasoningResult ? 'reasoning' : 'instruction',
    });
  } catch (error) {
    console.error('Video analyzer error:', error);
    res.json({
      success: false,
      error: `视频参数分析失败: ${(error as Error).message}`,
    });
  }
});

router.post('/image/analyze', async (req: Request, res: Response) => {
  try {
    const { message, sessionId: existingSessionId, history, imageUrls } = req.body;

    // 多模态预处理：分析参考图片
    const visionResult = await enrichMessageWithVision(message, imageUrls);
    const enrichedMessage = visionResult.message;

    const sessionId = existingSessionId || generateSessionId();
    const config = AGENT_CONFIGS.imageCreator;

    const existingContext = agentContexts.get(sessionId);
    const context: AgentContext = existingContext || {
      sessionId,
      userInput: message,
      thoughts: [],
      taskHistory: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 1,
      thought: '🔗 第一步：检查上下文关联，分析是否与历史任务有关...',
      timestamp: Date.now(),
    });

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 2,
      thought: '🧠 推理模型正在深度分析图像创作需求：构图、光影、色彩...',
      timestamp: Date.now(),
    });

    // 优先使用推理模型（调度Agent决定）
    const reasoningResult = await callReasoningAgent(enrichedMessage, config.systemPrompt, sessionId, history, config.role, 'image');
    let hermesResponse = '';
    let reasoningTrace = '';

    if (reasoningResult) {
      hermesResponse = reasoningResult.content;
      reasoningTrace = reasoningResult.reasoning;
    } else {
      hermesResponse = await callHermesWithContext(enrichedMessage, config.systemPrompt, sessionId, history);
    }

    // 短期记忆
    recordAgentTurn({ sessionId, agentName: config.role, turnIndex: 0, role: 'user', content: message?.substring(0, 300) });
    checkAndCompress(sessionId, config.role).catch(() => { });

    let analysis = {};
    if (hermesResponse) {
      try {
        const jsonMatch = hermesResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          analysis = parseImageAnalysisFromText(hermesResponse, message);
        }
      } catch {
        analysis = parseImageAnalysisFromText(hermesResponse, message);
      }
    } else {
      analysis = generateMockImageAnalysis(message);
    }

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 3,
      thought: '图像参数分析完成，准备生成图像',
      action: 'parameters_extracted',
      output: JSON.stringify(analysis),
      timestamp: Date.now(),
    });

    context.finalResult = analysis;
    context.updatedAt = Date.now();
    recordTask(sessionId, config.role, `${config.name}完成分析`, { action: 'analyzed' });
    agentContexts.set(sessionId, context);

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      result: analysis,
      thoughts: context.thoughts,
      reasoning: reasoningTrace?.substring(0, 500),
      modelUsed: reasoningResult ? 'reasoning' : 'instruction',
    });
  } catch (error) {
    console.error('Image analyzer error:', error);
    res.json({
      success: false,
      error: `图像参数分析失败: ${(error as Error).message}`,
    });
  }
});

router.post('/video/generate', async (req: Request, res: Response) => {
  try {
    const { sessionId, script, originalMessage, history, imageUrls } = req.body;

    // 多模态预处理
    const visionResult = await enrichMessageWithVision(script, imageUrls);
    const enrichedScript = visionResult.message;

    const config = AGENT_CONFIGS.videoMaker;
    const existingContext = agentContexts.get(sessionId || '');
    const context: AgentContext = existingContext || {
      sessionId: sessionId || generateSessionId(),
      userInput: originalMessage || script,
      thoughts: [],
      taskHistory: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 1,
      thought: '🔗 第一步：检查上下文关联，分析是否与历史任务有关...',
      timestamp: Date.now(),
    });

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 2,
      thought: '🧠 推理模型正在深度分析视频参数：主题、风格、时长、分镜...',
      timestamp: Date.now(),
    });

    // 优先使用推理模型（调度Agent决定）
    const reasoningResult = await callReasoningAgent(enrichedScript, config.systemPrompt, sessionId, history, config.role, 'video');
    let hermesResponse = '';
    let reasoningTrace = '';

    if (reasoningResult) {
      hermesResponse = reasoningResult.content;
      reasoningTrace = reasoningResult.reasoning;
    } else {
      hermesResponse = await callHermesWithContext(enrichedScript, config.systemPrompt, sessionId, history, config.role);
    }

    // 短期记忆
    recordAgentTurn({ sessionId, agentName: config.role, turnIndex: 0, role: 'user', content: enrichedScript?.substring(0, 300) });
    checkAndCompress(sessionId, config.role).catch(() => { });

    let analysis = {};
    if (hermesResponse) {
      try {
        const jsonMatch = hermesResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          analysis = parseAnalysisFromText(hermesResponse, enrichedScript);
        }
      } catch {
        analysis = parseAnalysisFromText(hermesResponse, script);
      }
    } else {
      analysis = generateMockVideoAnalysis(enrichedScript);
    }

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 3,
      thought: '参数分析完成，准备生成视频',
      action: 'parameters_extracted',
      output: JSON.stringify(analysis),
      timestamp: Date.now(),
    });

    context.finalResult = analysis;
    context.updatedAt = Date.now();
    recordTask(sessionId, config.role, `${config.name}完成分析`, { action: 'analyzed' });
    agentContexts.set(sessionId, context);

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      result: analysis,
      thoughts: context.thoughts,
      reasoning: reasoningTrace?.substring(0, 500),
      modelUsed: reasoningResult ? 'reasoning' : 'instruction',
    });
  } catch (error) {
    console.error('Video generation error:', error);
    res.json({
      success: false,
      error: `视频生成失败: ${(error as Error).message}`,
    });
  }
});

function generateMockScript(message: string): string {
  console.log(`[Mock Script] 降级使用本地模板，用户需求: "${message.substring(0, 80)}"`);

  // 降级模板仅作为最后兜底，不再预设具体内容
  // 让 Agent 在前面的 LLM 调用中自由发挥
  return `【故事创作专家 - 离线降级模式】

由于所有 AI 模型当前不可用，无法进行深度创作分析。以下是基于用户需求的简要脚本框架：

用户需求：${message}

建议场景结构：
- 开场：建立氛围和核心视觉元素
- 发展：展开叙事，展示关键动作
- 高潮：情感或视觉的最高点
- 收尾：回归主题，留下余韵

请稍后重试，或确保已配置 API Key 后刷新页面。`;
}

function parseAnalysisFromText(text: string, script: string): Record<string, any> {
  // 极简降级：从文本中提取基本信息，不再硬编码规则
  // Agent 已在 LLM 层充分分析，这里只是格式化的兜底
  const durationMatch = (script + ' ' + text).match(/(\d+)\s*秒/);
  const duration = durationMatch ? durationMatch[1] : '10';

  return {
    prompt: script.substring(0, 100),
    style: 'auto',
    duration,
    sceneBreakdown: [],
    analysis: text.substring(0, 100),
  };
}

function generateMockVideoAnalysis(script: string): Record<string, any> {
  const durationMatch = script.match(/(\d+)\s*秒/);
  const duration = durationMatch ? durationMatch[1] : '10';

  return {
    prompt: script.substring(0, 100),
    style: 'auto',
    duration,
    sceneBreakdown: [],
    analysis: 'AI模型不可用，请稍后重试',
  };
}

function parseImageAnalysisFromText(text: string, message: string): Record<string, any> {
  return {
    prompt: message,
    style: 'auto',
    composition: 'auto',
    analysis: text.substring(0, 100),
  };
}

function generateMockImageAnalysis(message: string): Record<string, any> {
  return {
    prompt: message,
    style: 'auto',
    composition: 'auto',
    analysis: 'AI模型不可用，请稍后重试',
  };
}

setInterval(() => {
  const now = Date.now();
  agentContexts.forEach((context, sessionId) => {
    if (now - context.updatedAt > 3600000) {
      agentContexts.delete(sessionId);
    }
  });
}, 60000);

// ===== 调度编排端点 =====

/** POST /api/agents/video/edit — 视频编辑 Agent（AI 助手二次修改） */
router.post('/video/edit', async (req: Request, res: Response) => {
  try {
    const { message, sessionId: existingSessionId, history, videoPath, videoUrl } = req.body;

    if (!message) {
      res.status(400).json({ success: false, error: 'message required' });
      return;
    }

    const sessionId = existingSessionId || generateSessionId();
    const config = AGENT_CONFIGS.videoEditor;

    const existingContext = agentContexts.get(sessionId);
    const context: AgentContext = existingContext || {
      sessionId,
      userInput: message,
      thoughts: [],
      taskHistory: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 在 system prompt 中添加视频信息
    const enhancedPrompt = config.systemPrompt +
      (videoPath ? `\n\n当前视频路径: ${videoPath}` : '') +
      (videoUrl ? `\n当前视频URL: ${videoUrl}` : '') +
      '\n\n用户正在对已生成的视频提出修改需求，请仔细分析并给出精准的剪辑方案。';

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 1,
      thought: '🔗 分析用户对视频的修改需求：字幕/配音/剪辑/替换...',
      timestamp: Date.now(),
    });

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 2,
      thought: '🧠 推理模型正在深度分析剪辑方案...',
      timestamp: Date.now(),
    });

    // 优先使用推理模型
    const reasoningResult = await callReasoningAgent(message, enhancedPrompt, sessionId, history, config.role, 'video');
    let hermesResponse = '';
    let reasoningTrace = '';

    if (reasoningResult) {
      hermesResponse = reasoningResult.content;
      reasoningTrace = reasoningResult.reasoning;
    } else {
      hermesResponse = await callHermesWithContext(message, enhancedPrompt, sessionId, history, config.role);
    }

    // 解析剪辑方案 JSON
    let editPlan: any = null;
    if (hermesResponse) {
      try {
        const jsonMatch = hermesResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          editPlan = JSON.parse(jsonMatch[0]);
        }
      } catch {
        // 非 JSON 格式，尝试文本解析
        editPlan = {
          action: 'smart-edit',
          analysis: hermesResponse.substring(0, 200),
          params: { smartEditPrompt: message },
          explanation: hermesResponse.substring(0, 300),
        };
      }
    }

    // 如果提供了视频路径，直接执行剪辑
    let editResult = null;
    if (videoPath && editPlan && editPlan.action) {
      try {
        const operations: EditOperation[] = [editPlan.action];
        const params: EditParams = editPlan.params || {};
        const task = videoEditService.createTask(videoPath, operations, params);
        editResult = await videoEditService.executeTask(task.id);
      } catch (err: any) {
        console.error('[VideoEdit Agent] Execution failed:', err.message);
      }
    }

    // 记录记忆
    recordAgentTurn({ sessionId, agentName: config.role, turnIndex: context.thoughts.length, role: 'user', content: message });
    recordAgentTurn({ sessionId, agentName: config.role, turnIndex: context.thoughts.length + 1, role: 'assistant', content: JSON.stringify(editPlan).substring(0, 500) });
    checkAndCompress(sessionId, config.role).catch(() => { });

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 3,
      thought: editResult ? '视频剪辑完成' : '剪辑方案已生成',
      action: editPlan?.action || 'analyzed',
      output: editResult ? `输出: ${editResult.outputUrl}` : JSON.stringify(editPlan).substring(0, 100),
      timestamp: Date.now(),
    });

    context.finalResult = { editPlan, editResult };
    context.updatedAt = Date.now();
    recordTask(sessionId, config.role, `视频剪辑: ${editPlan?.action || '分析'}`, { action: editPlan?.action });
    agentContexts.set(sessionId, context);

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      editPlan,
      editResult: editResult ? {
        outputUrl: editResult.outputUrl,
        duration: editResult.duration,
        fileSize: editResult.fileSize,
      } : null,
      thoughts: context.thoughts,
      reasoning: reasoningTrace?.substring(0, 500),
      modelUsed: reasoningResult ? 'reasoning' : 'instruction',
    });
  } catch (error) {
    console.error('Video editor agent error:', error);
    res.json({
      success: false,
      error: `视频剪辑分析失败: ${(error as Error).message}`,
    });
  }
});

/** POST /api/agents/orchestrate
 * 分析用户任务，生成执行计划（含并行判断 + 调度决策） */
router.post('/orchestrate', async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const startTs = Date.now();
  const sessionId = req.body?.sessionId || `session_${Date.now()}`;
  if (traceId) createTrace(traceId, sessionId, req.body?.message || '');

  try {
    const { message, history } = req.body;
    if (!message) { res.status(400).json({ success: false, error: 'message required' }); return; }

    const context: OrchestrationContext = {
      sessionId,
      userMessage: message,
      history: history || [],
      traceId,
      sharedContext: {
        lastAction: history?.slice(-1)?.[0]?.actionType || '',
        existingImage: history?.slice(-5).find((m: any) => m.generatedImage)?.generatedImage || '',
        existingVideo: history?.slice(-5).find((m: any) => m.generatedVideo)?.generatedVideo || '',
      },
    };

    // 注入长期记忆到共享上下文
    try {
      const memories = await recall({ query: message, limit: 3 });
      if (memories.length > 0) {
        context.sharedContext.longMemories = memories.map(m => m.content);
      }
    } catch { /* ok */ }

    const plan = await analyzeParallelism(message, context);
    if (traceId) finishTrace(traceId, 'success', Date.now() - startTs, 1);
    res.json({ success: true, plan, traceId });

  } catch (err) {
    if (traceId) finishTrace(traceId, 'failed', Date.now() - startTs, 0);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/** POST /api/agents/execute-plan
 * 执行调度计划（含重试+回退机制） */
router.post('/execute-plan', async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const startTs = Date.now();
  const sessionId = req.body?.sessionId || `session_${Date.now()}`;
  if (traceId) createTrace(traceId, sessionId, req.body?.message || '');

  try {
    const { plan, message, history } = req.body;
    if (!plan) { res.status(400).json({ success: false, error: 'plan required' }); return; }

    const context: OrchestrationContext = {
      sessionId,
      userMessage: message || '',
      history: history || [],
      traceId,
      sharedContext: {},
    };

    const results = await executePlan(plan, context, async (task, ctx) => {
      // 根据 agentName 路由到对应的处理函数
      // 这里简化处理，实际会调用对应的 agent 端点
      return { agentName: task.agentName, action: task.action, status: 'executed' };
    });

    const successCount = results.filter(r => r.status === 'success').length;
    const failCount = results.filter(r => r.status === 'failed').length;

    if (traceId) {
      // span 数 = 1(plan root) + 任务数（每个任务至少 1 个 span，含重试则更多）
      finishTrace(traceId, failCount === 0 ? 'success' : 'failed', Date.now() - startTs, results.length + 1);
    }

    res.json({
      success: failCount === 0,
      results,
      traceId,
      summary: `${results.length}个任务: ${successCount}成功, ${failCount}失败`,
    });

  } catch (err) {
    if (traceId) finishTrace(traceId, 'failed', Date.now() - startTs, 0);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;