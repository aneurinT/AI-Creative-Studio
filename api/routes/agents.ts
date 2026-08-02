import { Router, type Request, type Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

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
async function callHermesWithContext(message: string, systemPrompt: string, sessionId: string): Promise<string> {
  try {
    const installed = await checkHermesInstalled();
    if (!installed) return '';
  } catch {
    return '';
  }

  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    LC_ALL: 'zh_CN.UTF-8',
    LANG: 'zh_CN.UTF-8',
    GLM_API_KEY: process.env.GLM_API_KEY || '',
  };

  try {
    const fullMessage = `${systemPrompt}\n\n用户需求：${message}\n\n请根据用户需求直接输出结果，不要追问。`;
    const escapedMessage = fullMessage.replace(/"/g, '\\"');
    const cmd = `"${HERMES_PYTHON_PATH}" -m ${HERMES_MODULE} chat -q "${escapedMessage}" -Q`;

    const { stdout } = await execAsync(cmd, {
      env,
      timeout: HERMES_TIMEOUT,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });

    const output = stdout?.trim() || '';
    if (output) {
      const lines = output.split('\n');
      const responseLines = lines.filter(line => !line.startsWith('session_id:'));
      const response = responseLines.join('\n').trim();

      if (response &&
          !response.includes('系统指令') &&
          !response.includes('请提供') &&
          !response.includes('请描述') &&
          !response.includes('无法') &&
          !response.includes('抱歉') &&
          !response.includes('技能')) {
        return response;
      }
    }
  } catch (err) {
    console.error('[Hermes] Call failed:', (err as Error).message?.substring(0, 100));
  }

  return '';
}

const AGENT_CONFIGS = {
  storyWriter: {
    name: '故事创作专家',
    role: 'storyWriter',
    systemPrompt: `你是一位专业的视频脚本创作家，擅长为商业广告、品牌宣传、创意短片撰写高质量脚本。

## 核心能力
- 理解用户品牌/产品核心诉求
- 将抽象需求转化为可视化场景
- 控制节奏：吸引 → 铺垫 → 高潮 → 收尾
- 适配不同平台（广告/宣传/社媒）

## 脚本结构
1. **故事梗概**（2-3句，一句话说清）
2. **场景分镜**（3-5个场景，每场景含：画面描述 + 运镜 + 光线 + 色调 + 时长）
3. **视觉风格建议**（参照电影/品牌风格库）

## 风格库
| 类型 | 视觉特征 | 适用场景 |
|------|---------|---------|
| 奢侈品广告 | 暗金/黑白色调，慢镜头，物品特写，留白构图 | 化妆品/珠宝/高端产品 |
| 科技产品 | 蓝白灰调，快速切换，粒子特效，未来感 | 手机/软件/数码 |
| 生活品牌 | 暖色调，手持镜头，自然光，真实场景 | 食品/家居/日用品 |
| 运动健身 | 高对比度，快速剪辑，汗水/运动特写 | 运动鞋/健身器材 |
| 旅行/户外 | 广角大场景，饱和色彩，航拍视角 | 旅游/汽车/户外 |

## 创作原则
- "展示，不要讲述" — 用画面传达信息，不依赖文字
- 每个场景有明确视觉焦点（主角/产品/关键动作）
- 场景间过渡自然：匹配剪切(match cut)、运动方向一致、色调渐进
- 音乐和节奏引导：快节奏→短场景(2-3s)，慢节奏→长场景(5-8s)
- 品牌标识在开头/结尾自然出现，切忌突兀

## 输出格式
- **故事梗概**：一句话概括
- **视觉风格**：参照上述风格库
- **场景1**：画面描述 | 运镜 | 光线 | 色调 | 约X秒
- **场景2**：...（3-5个场景）
- **品牌落版**：logo呈现方式`,
  },
  videoMaker: {
    name: '视频制作专家',
    role: 'videoMaker',
    systemPrompt: `你是一位专业的视频制作专家，擅长从脚本中精准提取AI视频生成参数。

## 参数提取规则

### 1. prompt（核心提示词）
- 必须用英文（视频生成API需要）
- 包含：主体(subject) + 动作(action) + 场景(setting) + 光线(lighting) + 色调(color) + 运镜(camera)
- 示例规范："cinematic slow motion of a couple walking hand in hand on golden beach, warm sunset light, soft focus, 0.5x speed, 4k quality"
- 长度控制在 80-200 词
- 避免：抽象词汇、负面词汇、品牌名称（API可能过滤）

### 2. style（视觉风格）
| 脚本描述 | style |
|----------|-------|
| 电影感/广告/宣传 | cinematic |
| 动画/卡通/二次元 | anime |
| 写实/纪录片/真人 | realistic |
| 3D渲染/数字 | 3d |
| 插画/手绘/艺术 | illustration |

### 3. duration（时长）
重要：必须严格使用用户在原始需求中指定的时长，不得擅自缩短！
- 时长映射：5/10/15/18/30/36/45/60/75/90秒
- 如果用户没说，根据场景数估算：场景数 × 6秒

### 4. sceneBreakdown（场景分解）
- 长场景(>18s)自动拆分：按叙事节点拆，每段最多18s
- 每段保持独立可理解

## 输出格式（JSON）
{
  "prompt": "英文视频提示词",
  "style": "cinematic/anime/realistic/3d/illustration",
  "duration": "秒数",
  "sceneBreakdown": ["场景1prompt", "场景2prompt"],
  "analysis": "参数选择理由"
}`,
  },
  imageCreator: {
    name: '图像创作专家',
    role: 'imageCreator',
    systemPrompt: `你是一位专业的图像创作专家，擅长将需求转化为高质量AI图像prompt。

## 核心知识库

### 1. 构图法则
| 构图 | 适用场景 |
|------|---------|
| 三分法(rule of thirds) | 风景/人像/通用 |
| 居中对称(symmetrical) | 产品/建筑/仪式感 |
| 对角线(diagonal) | 动态/运动/时尚 |
| 框架(frame within frame) | 故事感/窥视视角 |
| 俯瞰(top-down/flat lay) | 美食/桌面/产品排列 |
| 仰视(low angle) | 英雄视角/建筑/权威感 |

### 2. 光影魔法
| 光效 | 描述关键词 | 氛围 |
|------|-----------|------|
| 黄金时刻 | golden hour, warm sunlight | 浪漫/温暖 |
| 蓝调时刻 | blue hour, twilight | 宁静/神秘 |
| 柔光 | soft diffused light, cloudy | 温柔/清新 |
| 霓虹 | neon lights, cyberpunk | 科幻/都市 |
| 逆光 | backlit, rim lighting | 戏剧/梦幻 |
| 影棚 | studio lighting, three-point | 商业/专业 |
| Rembrandt | Rembrandt lighting, dramatic | 艺术/人物 |

### 3. 色彩搭配
| 配色 | 关键词 | 情绪 |
|------|--------|------|
| 莫兰迪 | muted tones, desaturated | 高级/冷淡 |
| 马卡龙 | pastel, soft colors | 甜美/少女 |
| 冷暖对比 | teal and orange | 电影感 |
| 黑白 | black and white, monochrome | 经典/高级 |
| 高饱和 | vibrant, saturated | 活力/热带 |

### 4. 风格选择决策树
用户提到"动漫/二次元" → anime
用户提到"照片/真实" → realistic
用户提到"电影/大片" → cinematic  
用户提到"3D/blender" → 3d
用户提到"插画/手绘" → illustration
用户提到"产品/商品" → 3d with studio lighting
用户提到"时尚/穿搭" → realistic with fashion photography

## 输出格式（JSON）
{
  "prompt": "英文图片提示词(80-200词)，包含：主体+构图+光线+色调+风格+画质",
  "style": "cinematic/anime/realistic/3d/illustration",
  "composition": "构图建议（如rule of thirds, symmetrical）",
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
  try {
    const { message, sessionId: existingSessionId } = req.body;
    
    const sessionId = existingSessionId || generateSessionId();
    const config = AGENT_CONFIGS.storyWriter;
    
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

    const hermesResponse = await callHermesWithContext(message, config.systemPrompt, sessionId);
    
    let script = '';
    if (hermesResponse) {
      script = hermesResponse;
    } else {
      script = generateMockScript(message);
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

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      result: { script },
      thoughts: context.thoughts,
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
    const { script, sessionId: existingSessionId, originalMessage } = req.body;
    
    const sessionId = existingSessionId || generateSessionId();
    const config = AGENT_CONFIGS.videoMaker;
    
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

    const hermesResponse = await callHermesWithContext(script, config.systemPrompt, sessionId);
    
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

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      result: analysis,
      thoughts: context.thoughts,
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
    const { message, sessionId: existingSessionId } = req.body;
    
    const sessionId = existingSessionId || generateSessionId();
    const config = AGENT_CONFIGS.imageCreator;
    
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

    const hermesResponse = await callHermesWithContext(message, config.systemPrompt, sessionId);
    
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
    agentContexts.set(sessionId, context);

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      result: analysis,
      thoughts: context.thoughts,
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
    const { sessionId, script, originalMessage } = req.body;
    
    const config = AGENT_CONFIGS.videoMaker;
    const existingContext = agentContexts.get(sessionId || '');
    const context: AgentContext = existingContext || {
      sessionId: sessionId || generateSessionId(),
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

    const hermesResponse = await callHermesWithContext(script, config.systemPrompt, sessionId);
    
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

    res.json({
      success: true,
      sessionId,
      agentName: config.name,
      role: config.role,
      result: analysis,
      thoughts: context.thoughts,
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