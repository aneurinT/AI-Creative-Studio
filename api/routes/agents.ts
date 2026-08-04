import { Router, type Request, type Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logAgentOperation } from '../services/loggerService.js';

const execAsync = promisify(exec);
const router = Router();

const HERMES_PYTHON_PATH = process.platform === 'win32' ? 'python' : 'python3';
const HERMES_MODULE = 'hermes_cli.main';
const HERMES_TIMEOUT = 30_000; // 30秒超时（异步不阻塞事件循环）

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
  createdAt: number;
  updatedAt: number;
}

const agentContexts: Map<string, AgentContext> = new Map();

let hermesReady: boolean | null = null;

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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

/** 异步调用 Hermes Python CLI */
async function callHermesWithContext(message: string, systemPrompt: string, sessionId: string, history?: any[]): Promise<string> {
  // 获取上一轮 Agent 结果作为上下文
  const context = agentContexts.get(sessionId);
  const prevResult = context?.finalResult ? JSON.stringify(context.finalResult).substring(0, 500) : '';

  // 构建带上下文的 messages
  const contextMessages: any[] = [{ role: 'system', content: systemPrompt }];

  // 添加历史对话（保留更多上下文）
  if (history && history.length > 0) {
    const recent = history.slice(-15).map((m: any) => ({
      role: m.role === 'user' ? 'user' : 'assistant' as const,
      content: typeof m.content === 'string' ? m.content.substring(0, 500) : '',
    }));
    contextMessages.push(...recent);
  }

  // 添加上一轮 Agent 结果
  if (prevResult) {
    contextMessages.push({ role: 'assistant', content: `上一轮处理结果：${prevResult}` });
  }

  contextMessages.push({ role: 'user', content: `用户需求：${message}\n\n请根据你的理解完成这个任务。如果信息不充分，你可以根据上下文合理推断并给出最佳方案。` });

  // 优先 LLM API
  const apiKey = process.env.ZHIPU_API_KEY;
  if (apiKey) {
    try {
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'glm-4-flash', messages: contextMessages, temperature: 0.7, max_tokens: 800 }),
        signal: AbortSignal.timeout(25000),
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
  } catch {}

  // 最终降级：本地模板
  return generateMockScript(message);
}

const AGENT_CONFIGS = {
  storyWriter: {
    name: '故事创作专家',
    role: 'storyWriter',
    systemPrompt: `你是一个智能创作助手。你的任务是理解用户的任何需求，无论是视频脚本、图片描述、文案策划还是其他创作需求。

## 核心原则
- 不要把自己局限在"视频脚本"这个角色。如果用户需要图片描述、广告文案、策划方案等，你同样要出色完成
- 充分理解用户需求的上下文，包括隐含的目标、受众、场景
- 给出完整、有深度、可直接使用的产出

## 创作能力
1. **视频脚本**：故事梗概、场景分镜（画面+运镜+光线+色调+时长）、视觉风格建议
2. **图片描述**：主体+构图+光线+色调+风格+画质，生成高质量 prompt
3. **文案策划**：品牌文案、广告语、社交媒体内容
4. **综合方案**：结合多种媒介的完整创意方案

## 输出原则
- 先展示你对需求的理解
- 再给出具体创作内容
- 最后给出优化建议`,
  },
  videoMaker: {
    name: '视频制作专家',
    role: 'videoMaker',
    systemPrompt: `你是一个多媒体制作专家。你的任务是从用户的任何描述中提取生成参数。

## 核心原则
- 不受限于"视频"——如果用户需要图片、音频等参数，同样分析
- 根据用户需求的复杂程度决定参数结构
- 提取关键信息：主体、风格、时长、场景、氛围等

## 参数提取
- **prompt**：核心提示词（英文优先），包含主体+动作+场景+光线+色调+运镜
- **style**：视觉风格（realistic/anime/cinematic/3d/illustration 等）
- **duration**：时长（秒），从用户描述提取
- **sceneBreakdown**：如有需要，自动生成分镜（每段5-6秒）

## 输出 JSON
{"prompt":"...","style":"...","duration":10,"sceneBreakdown":[{"scene":1,"description":"...","prompt":"...","duration":5}]}`,
  },
  imageCreator: {
    name: '图像创作专家',
    role: 'imageCreator',
    systemPrompt: `你是一个视觉创作专家。你的任务是理解用户需求，生成高质量的视觉创作方案。

## 核心原则
- 不要把自己局限在"图片"——用户可能需要多种视觉产出
- 深入理解用户需求，包括：构图、光影、色彩、风格、情感表达

## 知识库参考
构图：三分法、居中对称、对角线、框架、俯瞰、仰视
光影：黄金时刻、蓝调时刻、柔光、霓虹、逆光、影棚、Rembrandt
色彩：莫兰迪、马卡龙、冷暖对比、黑白、高饱和

## 输出格式（JSON）
{
  "prompt": "英文提示词(80-200词)，包含：主体+构图+光线+色调+风格+画质",
  "style": "cinematic/anime/realistic/3d/illustration",
  "composition": "构图建议",
  "analysis": "创作思路解释"
}`,
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
  const startTime = Date.now();
  const sessionId = req.body.sessionId || generateSessionId();
  try {
    const { message, history } = req.body;
    const config = AGENT_CONFIGS.storyWriter;

    logAgentOperation({
      agentName: config.name,
      agentRole: config.role,
      sessionId,
      operation: '开始脚本创作',
      detail: `用户输入: ${message?.substring(0, 100)}`,
      result: 'pending',
      input: message,
    });
    
    const existingContext = agentContexts.get(sessionId);
    const context: AgentContext = existingContext || {
      sessionId,
      userInput: message,
      thoughts: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 1,
      thought: '开始分析用户需求，理解核心诉求和情感表达',
      timestamp: Date.now(),
    });

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 2,
      thought: '正在创作视频脚本，构建故事情节和场景',
      timestamp: Date.now(),
    });

    const hermesResponse = await callHermesWithContext(message, config.systemPrompt, sessionId, history);
    
    let script = '';
    let usedFallback = false;
    if (hermesResponse) {
      script = hermesResponse;
    } else {
      script = generateMockScript(message);
      usedFallback = true;
    }

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
    agentContexts.set(sessionId, context);

    const duration = Date.now() - startTime;
    logAgentOperation({
      agentName: config.name,
      agentRole: config.role,
      sessionId,
      operation: '脚本创作完成',
      detail: `脚本长度: ${script.length}字符${usedFallback ? '(使用本地模板)' : '(LLM生成)'}`,
      result: 'success',
      duration,
      input: message?.substring(0, 300),
      output: script?.substring(0, 300),
    });

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      result: { script },
      thoughts: context.thoughts,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logAgentOperation({
      agentName: '故事创作专家',
      agentRole: 'storyWriter',
      sessionId,
      operation: '脚本创作失败',
      detail: `异常: ${(error as Error).message}`,
      result: 'failure',
      duration,
      error: (error as Error).message,
    });
    console.error('Story writer error:', error);
    res.json({
      success: false,
      error: `故事创作失败: ${(error as Error).message}`,
    });
  }
});

router.post('/video/analyze', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const sessionId = req.body.sessionId || generateSessionId();
  try {
    const { script, originalMessage, history } = req.body;
    const config = AGENT_CONFIGS.videoMaker;

    logAgentOperation({
      agentName: config.name,
      agentRole: config.role,
      sessionId,
      operation: '开始视频参数分析',
      detail: `脚本预览: ${script?.substring(0, 100)}`,
      result: 'pending',
      input: script?.substring(0, 300),
    });
    
    const existingContext = agentContexts.get(sessionId);
    const context: AgentContext = existingContext || {
      sessionId,
      userInput: originalMessage || script,
      thoughts: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 1,
      thought: '开始分析脚本内容，提取关键元素',
      timestamp: Date.now(),
    });

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 2,
      thought: '正在提取视频生成参数：主题、风格、时长',
      timestamp: Date.now(),
    });

    const hermesResponse = await callHermesWithContext(script, config.systemPrompt, sessionId, history);
    
    let analysis = {};
    let usedFallback = false;
    if (hermesResponse) {
      try {
        const jsonMatch = hermesResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          analysis = parseAnalysisFromText(hermesResponse, script);
          usedFallback = true;
        }
      } catch {
        analysis = parseAnalysisFromText(hermesResponse, script);
        usedFallback = true;
      }
    } else {
      analysis = generateMockVideoAnalysis(script);
      usedFallback = true;
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
    agentContexts.set(sessionId, context);

    const duration = Date.now() - startTime;
    logAgentOperation({
      agentName: config.name,
      agentRole: config.role,
      sessionId,
      operation: '视频参数分析完成',
      detail: `style=${(analysis as any).style}, duration=${(analysis as any).duration}${usedFallback ? '(使用本地解析)' : '(LLM解析)'}`,
      result: 'success',
      duration,
      output: JSON.stringify(analysis)?.substring(0, 300),
    });

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      result: analysis,
      thoughts: context.thoughts,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logAgentOperation({
      agentName: '视频制作专家',
      agentRole: 'videoMaker',
      sessionId,
      operation: '视频参数分析失败',
      detail: `异常: ${(error as Error).message}`,
      result: 'failure',
      duration,
      error: (error as Error).message,
    });
    console.error('Video analyzer error:', error);
    res.json({
      success: false,
      error: `视频参数分析失败: ${(error as Error).message}`,
    });
  }
});

router.post('/image/analyze', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const sessionId = req.body.sessionId || generateSessionId();
  try {
    const { message, history } = req.body;
    const config = AGENT_CONFIGS.imageCreator;

    logAgentOperation({
      agentName: config.name,
      agentRole: config.role,
      sessionId,
      operation: '开始图像参数分析',
      detail: `用户输入: ${message?.substring(0, 100)}`,
      result: 'pending',
      input: message?.substring(0, 300),
    });
    
    const existingContext = agentContexts.get(sessionId);
    const context: AgentContext = existingContext || {
      sessionId,
      userInput: message,
      thoughts: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 1,
      thought: '开始分析用户需求，理解图像创作要求',
      timestamp: Date.now(),
    });

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 2,
      thought: '正在生成图像描述和风格建议',
      timestamp: Date.now(),
    });

    const hermesResponse = await callHermesWithContext(message, config.systemPrompt, sessionId, history);
    
    let analysis = {};
    let usedFallback = false;
    if (hermesResponse) {
      try {
        const jsonMatch = hermesResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          analysis = parseImageAnalysisFromText(hermesResponse, message);
          usedFallback = true;
        }
      } catch {
        analysis = parseImageAnalysisFromText(hermesResponse, message);
        usedFallback = true;
      }
    } else {
      analysis = generateMockImageAnalysis(message);
      usedFallback = true;
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
    agentContexts.set(sessionId, context);

    const duration = Date.now() - startTime;
    logAgentOperation({
      agentName: config.name,
      agentRole: config.role,
      sessionId,
      operation: '图像参数分析完成',
      detail: `style=${(analysis as any).style}${usedFallback ? '(使用本地解析)' : '(LLM解析)'}`,
      result: 'success',
      duration,
      output: JSON.stringify(analysis)?.substring(0, 300),
    });

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      result: analysis,
      thoughts: context.thoughts,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logAgentOperation({
      agentName: '图像创作专家',
      agentRole: 'imageCreator',
      sessionId,
      operation: '图像参数分析失败',
      detail: `异常: ${(error as Error).message}`,
      result: 'failure',
      duration,
      error: (error as Error).message,
    });
    console.error('Image analyzer error:', error);
    res.json({
      success: false,
      error: `图像参数分析失败: ${(error as Error).message}`,
    });
  }
});

router.post('/video/generate', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const sessionId = req.body.sessionId || generateSessionId();
  try {
    const { script, originalMessage, history } = req.body;
    const config = AGENT_CONFIGS.videoMaker;

    logAgentOperation({
      agentName: config.name,
      agentRole: config.role,
      sessionId,
      operation: '开始视频生成参数提取',
      detail: `输入: ${(originalMessage || script)?.substring(0, 100)}`,
      result: 'pending',
      input: (originalMessage || script)?.substring(0, 300),
    });

    const existingContext = agentContexts.get(sessionId);
    const context: AgentContext = existingContext || {
      sessionId,
      userInput: originalMessage || script,
      thoughts: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 1,
      thought: '开始分析脚本内容，提取关键元素',
      timestamp: Date.now(),
    });

    context.thoughts.push({
      agentName: config.name,
      role: config.role,
      step: 2,
      thought: '正在提取视频生成参数：主题、风格、时长',
      timestamp: Date.now(),
    });

    const hermesResponse = await callHermesWithContext(script, config.systemPrompt, sessionId, history);
    
    let analysis = {};
    if (hermesResponse) {
      try {
        const jsonMatch = hermesResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          analysis = parseAnalysisFromText(hermesResponse, script);
        }
      } catch {
        analysis = parseAnalysisFromText(hermesResponse, script);
      }
    } else {
      analysis = generateMockVideoAnalysis(script);
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
    agentContexts.set(sessionId, context);

    const duration = Date.now() - startTime;
    logAgentOperation({
      agentName: config.name,
      agentRole: config.role,
      sessionId,
      operation: '视频生成参数提取完成',
      detail: `style=${(analysis as any).style}, duration=${(analysis as any).duration}`,
      result: 'success',
      duration,
      output: JSON.stringify(analysis)?.substring(0, 300),
    });

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      result: analysis,
      thoughts: context.thoughts,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logAgentOperation({
      agentName: '视频制作专家',
      agentRole: 'videoMaker',
      sessionId,
      operation: '视频生成参数提取失败',
      detail: `异常: ${(error as Error).message}`,
      result: 'failure',
      duration,
      error: (error as Error).message,
    });
    console.error('Video generation error:', error);
    res.json({
      success: false,
      error: `视频生成失败: ${(error as Error).message}`,
    });
  }
});

function generateMockScript(message: string): string {
  console.log(`[Mock Script] Message: "${message}"`);
  console.log(`[Mock Script] Has dinosaur: ${message.includes('恐龙')}`);
  console.log(`[Mock Script] Has cat: ${message.includes('猫')}`);
  console.log(`[Mock Script] Has forest: ${message.includes('森林')}`);
  
  const hasDinosaur = message.includes('恐龙');
  const hasCat = message.includes('猫') || message.includes('cat');
  const hasForest = message.includes('森林') || message.includes('forest');
  
  if (hasDinosaur) {
    return `故事梗概：一只可爱的小恐龙在神秘的森林中迷路了，它踏上了寻找妈妈的冒险之旅。

场景描述：
1. 阳光透过树叶洒在翠绿的草地上，一只毛茸茸的小恐龙从蛋中孵化出来，好奇地打量着周围的世界。
2. 小恐龙在森林中漫步，遇到了友善的小兔子和小鸟，它们帮助小恐龙寻找回家的路。
3. 夜幕降临，小恐龙在月光下感到孤独，但它鼓起勇气继续前行。
4. 终于，小恐龙听到了妈妈的呼唤，它朝着声音的方向跑去，与妈妈重逢。

角色设定：
- 小恐龙：可爱、勇敢、充满好奇心
- 兔妈妈：温柔、善良、乐于助人
- 恐龙妈妈：慈祥、充满母爱

风格建议：可爱卡通风格，色彩明亮温馨，适合儿童观看`;
  } else if (hasCat) {
    return `故事梗概：一只调皮的小猫在城市中探险，发现了一个神秘的花园。

场景描述：
1. 清晨的阳光照进窗户，一只橘色小猫伸了个懒腰，决定今天要去探索新的地方。
2. 小猫穿过热闹的街道，跳过篱笆，来到了一个充满鲜花的秘密花园。
3. 花园里有蝴蝶飞舞，蜜蜂采蜜，小猫追逐着一只漂亮的蝴蝶。
4. 夕阳西下，小猫带着满满的回忆回家，在窗台上甜甜地睡着了。

角色设定：
- 橘猫：活泼、好奇、爱冒险
- 蝴蝶：优雅、美丽、神秘

风格建议：温馨治愈风格，柔和的色彩，细腻的细节`;
  } else if (hasForest) {
    return `故事梗概：在一片古老的森林中，隐藏着一个神奇的精灵世界。

场景描述：
1. 晨雾笼罩着古老的森林，阳光穿透树叶形成美丽的光斑。
2. 小精灵们在花丛中忙碌，收集露珠和花瓣。
3. 一只小鹿在林间漫步，与精灵们成为了好朋友。
4. 夜晚，萤火虫点亮了森林，精灵们围坐在一起讲述古老的故事。

角色设定：
- 小精灵：可爱、神秘、拥有魔法
- 小鹿：温顺、善良、勇敢

风格建议：奇幻唯美风格，梦幻的色彩，精致的细节`;
  } else {
    return `故事梗概：一个温馨的家庭故事，展现亲情的美好。

场景描述：
1. 温馨的客厅里，一家人围坐在一起准备晚餐。
2. 孩子们在院子里玩耍，笑声回荡。
3. 夕阳下，全家人一起享受美味的晚餐。
4. 夜晚，孩子们在父母的陪伴下进入梦乡。

角色设定：
- 父母：慈祥、关爱家人
- 孩子：活泼、可爱

风格建议：写实温馨风格，温暖的色调，生活化的场景`;
  }
}

function parseAnalysisFromText(text: string, script: string): Record<string, any> {
  const hasDinosaur = script.includes('恐龙') || text.includes('恐龙');
  const hasAnime = script.includes('动漫') || text.includes('动漫') || script.includes('卡通');
  const hasRealistic = script.includes('写实') || text.includes('写实');
  
  // 从脚本和文本中提取时长，支持所有选项 5/10/15/18/30/36/45/60/75/90
  let duration = '10';
  const durationPatterns: RegExp[] = [
    /(\d+)\s*秒/, /(\d+)\s*秒钟/, /(\d+)\s*分钟/, /(\d+)\s*minute/, /(\d+)\s*min/,
  ];
  const allText = script + ' ' + text;
  for (const pattern of durationPatterns) {
    const match = allText.match(pattern);
    if (match) {
      let seconds = parseInt(match[1]);
      if (pattern.source.includes('分钟') || pattern.source.includes('minute') || pattern.source.includes('min')) {
        seconds = seconds * 60;
      }
      if (seconds <= 5) duration = '5';
      else if (seconds <= 10) duration = '10';
      else if (seconds <= 15) duration = '15';
      else if (seconds <= 18) duration = '18';
      else if (seconds <= 30) duration = '30';
      else if (seconds <= 36) duration = '36';
      else if (seconds <= 45) duration = '45';
      else if (seconds <= 60) duration = '60';
      else if (seconds <= 75) duration = '75';
      else duration = '90';
      break;
    }
  }

  let style = 'realistic';
  if (hasAnime) style = 'anime';
  if (script.includes('奇幻') || text.includes('奇幻')) style = 'fantasy';
  if (script.includes('电影') || text.includes('电影')) style = 'cinematic';

  const firstPeriod = script.indexOf('。');
  const prompt = firstPeriod > 0 ? script.substring(0, firstPeriod + 1) : script.substring(0, 50);

  return {
    prompt: prompt + '，高质量视频',
    style,
    duration,
    sceneBreakdown: ['场景1', '场景2', '场景3'],
    analysis: text.substring(0, 100),
  };
}

function generateMockVideoAnalysis(script: string): Record<string, any> {
  const hasDinosaur = script.includes('恐龙');
  const hasAnime = script.includes('动漫') || script.includes('卡通');
  const hasFantasy = script.includes('奇幻');
  
  // 从脚本中提取时长，支持所有选项 5/10/15/18/30/36/45/60/75/90
  let duration = '10';
  const durationPatterns: RegExp[] = [
    /(\d+)\s*秒/, /(\d+)\s*秒钟/, /(\d+)\s*分钟/, /(\d+)\s*minute/, /(\d+)\s*min/,
  ];
  for (const pattern of durationPatterns) {
    const match = script.match(pattern);
    if (match) {
      let seconds = parseInt(match[1]);
      if (pattern.source.includes('分钟') || pattern.source.includes('minute') || pattern.source.includes('min')) {
        seconds = seconds * 60;
      }
      if (seconds <= 5) duration = '5';
      else if (seconds <= 10) duration = '10';
      else if (seconds <= 15) duration = '15';
      else if (seconds <= 18) duration = '18';
      else if (seconds <= 30) duration = '30';
      else if (seconds <= 36) duration = '36';
      else if (seconds <= 45) duration = '45';
      else if (seconds <= 60) duration = '60';
      else if (seconds <= 75) duration = '75';
      else duration = '90';
      break;
    }
  }

  let style = 'realistic';
  if (hasAnime) style = 'anime';
  if (hasFantasy) style = 'fantasy';

  const firstPeriod = script.indexOf('。');
  const prompt = firstPeriod > 0 ? script.substring(0, firstPeriod + 1) : script.substring(0, 50);

  return {
    prompt: prompt + '，高质量视频',
    style,
    duration,
    sceneBreakdown: ['场景1', '场景2', '场景3'],
    analysis: '基于脚本分析，提取了核心主题和视觉风格',
  };
}

function parseImageAnalysisFromText(text: string, message: string): Record<string, any> {
  const hasAnime = message.includes('动漫') || text.includes('动漫');
  const hasRealistic = message.includes('写实') || text.includes('写实');
  
  let style = 'realistic';
  if (hasAnime) style = 'anime';
  if (message.includes('奇幻') || text.includes('奇幻')) style = 'fantasy';
  if (message.includes('油画') || text.includes('油画')) style = 'oil-painting';

  return {
    prompt: message + '，高质量图像',
    style,
    composition: '居中构图',
    analysis: text.substring(0, 100),
  };
}

function generateMockImageAnalysis(message: string): Record<string, any> {
  const hasAnime = message.includes('动漫');
  const hasFantasy = message.includes('奇幻');
  
  let style = 'realistic';
  if (hasAnime) style = 'anime';
  if (hasFantasy) style = 'fantasy';

  return {
    prompt: message + '，高质量图像',
    style,
    composition: '居中构图',
    analysis: '基于用户需求分析，提取了核心元素和风格',
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

export default router;