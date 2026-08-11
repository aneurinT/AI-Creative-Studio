/**
 * 审核 Agent + 自学习记忆系统
 *
 * 审核 Agent：对比用户原始意图与 Hermes Agent 的理解，
 * 检测偏差并自动校对调整。
 *
 * 自学习记忆：记录用户修正，下次相似请求时优先使用学习到的结果。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { REASONING_MODEL, REASONING_API, getReasoningApiKey, REASONING_FALLBACK_MODEL, REASONING_FALLBACK_API, getReasoningFallbackApiKey } from './llmConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- 审核 Agent 配置 -----

const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const REVIEW_MODEL = 'glm-4-flash'; // 轻量指令模型，审核回退时使用

export interface ReviewResult {
  /** 是否通过审核（用户意图与 Agent 理解一致） */
  passed: boolean;
  /** 信任度 0-1 */
  confidence: number;
  /** 审核 Agent 的解释说明 */
  explanation: string;
  /** 校对后的 action（仅 failed/passedWithCorrection 时有值） */
  correctedAction?: string;
  /** 校对后的 params */
  correctedParams?: Record<string, any>;
  /** 审核状态：passed | failed | corrected */
  status: 'passed' | 'failed' | 'corrected';
}

interface MemoryEntry {
  /** 用户原始消息的模式（简化后的关键词） */
  pattern: string;
  /** 记录时间 */
  timestamp: number;
  /** 审核纠正后的正确 action */
  correctedAction: string;
  /** 审核纠正后的正确 params */
  correctedParams: Record<string, any>;
  /** 使用次数 */
  hitCount: number;
}

// ----- 自学习记忆 -----

const memoryFilePath = path.join(__dirname, '../data/agent_memory.json');
let memoryCache: MemoryEntry[] = [];
let memoryLoaded = false;

function loadMemory(): MemoryEntry[] {
  if (memoryLoaded) return memoryCache;
  try {
    if (fs.existsSync(memoryFilePath)) {
      const raw = fs.readFileSync(memoryFilePath, 'utf-8');
      memoryCache = JSON.parse(raw);
      // 清理 7 天前的旧记录
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      memoryCache = memoryCache.filter(e => e.timestamp > weekAgo);
    }
    memoryLoaded = true;
  } catch {
    memoryCache = [];
  }
  return memoryCache;
}

async function saveMemory(): Promise<void> {
  try {
    const dir = path.dirname(memoryFilePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(memoryFilePath, JSON.stringify(memoryCache, null, 2));
  } catch (e) {
    console.error('[MemoryStore] Save failed:', e);
  }
}

/** 从用户消息中提取关键模式 */
function extractPattern(message: string): string {
  // 提取关键意图词汇
  const keywords = ['生成', '制作', '创建', '画', '视频', '图片', '图像', '修改', '抠图', '去背景', '合成', '风格', '动漫', '写实', '3D', '插画'];
  const lower = message.toLowerCase();
  const found = keywords.filter(k => lower.includes(k));
  // 去重排序作为模式
  return found.sort().join('|').substring(0, 100) || lower.substring(0, 50);
}

/** 查找相似的历史记忆 */
export function findMemoryMatch(message: string): MemoryEntry | null {
  const mem = loadMemory();
  const pattern = extractPattern(message);
  if (!pattern) return null;

  // 精确匹配
  const exact = mem.find(e => e.pattern === pattern);
  if (exact) return exact;

  // 模糊匹配：关键词重叠度 >= 50%
  const patternTokens = new Set(pattern.split('|'));
  for (const entry of mem) {
    const entryTokens = new Set(entry.pattern.split('|'));
    const intersection = [...patternTokens].filter(t => entryTokens.has(t)).length;
    const overlap = intersection / Math.max(patternTokens.size, entryTokens.size);
    if (overlap >= 0.5 && entry.hitCount >= 2) {
      return entry;
    }
  }
  return null;
}

/** 记录用户修正到记忆 */
export async function recordMemory(message: string, correctAction: string, correctParams: Record<string, any>): Promise<void> {
  const mem = loadMemory();
  const pattern = extractPattern(message);
  if (!pattern) return;

  const existing = mem.find(e => e.pattern === pattern);
  if (existing) {
    existing.correctedAction = correctAction;
    existing.correctedParams = correctParams;
    existing.timestamp = Date.now();
    existing.hitCount++;
  } else {
    mem.push({
      pattern,
      timestamp: Date.now(),
      correctedAction: correctAction,
      correctedParams: correctParams,
      hitCount: 1,
    });
  }

  // 限制最多 200 条
  if (mem.length > 200) {
    mem.sort((a, b) => b.timestamp - a.timestamp);
    mem.splice(200);
  }
  memoryCache = mem;
  await saveMemory();
}

// ----- 审核 Agent -----

/**
 * 使用推理模型审核（DeepSeek-R1 / GLM-Z1）
 * 推理模型会进行 chain-of-thought 分析，更准确判断意图偏差
 */
async function reviewWithReasoning(
  userMessage: string,
  agentAction: string,
  agentParams: Record<string, any>,
  agentDescription: string,
): Promise<ReviewResult | null> {
  const systemPrompt = `你是审核 Agent（Review Agent）推理核心，负责验证 AI 助手对用户需求的判断是否准确。

## 审核流程（Chain-of-Thought）

### 步骤 1：提取用户真实意图
从用户消息中提取：
- **核心目标**：用户想做什么？（画图/做视频/修改/抠图/合成/闲聊）
- **风格约束**：有没有明确的风格？（动漫/写实/电影/3D/插画）
- **量化要求**：有没有明确的时长/尺寸/数量？
- **隐含需求**：有没有没说但可以推断的？

### 步骤 2：对比 AI 理解
| 检查项 | 判定标准 |
|--------|---------|
| Action 匹配 | 用户说"画"→ action 应为 image；用户说"视频"→ action 应为 video；用户说"改"→ action 应为 modify |
| Style 匹配 | 用户说"动漫"→ style 应为 anime；用户说"电影感"→ style 应为 cinematic |
| 时长匹配 | 用户说"30秒"→ duration 应为 30；用户没说→ 默认值合理即可 |
| 参数完整 | prompt 是否包含场景+主体+光线+色调？是否英文？ |

### 步骤 3：判定偏差等级
| 等级 | 条件 | 操作 |
|------|------|------|
| ✅ 无偏差 | action 和关键参数都匹配 | passed=true, confidence≥0.9 |
| ⚠️ 轻微偏差 | action 正确但部分参数不匹配 | passed=false, status="corrected", 给出修正 |
| ❌ 严重偏差 | action 类型都错了 | passed=false, status="failed", confidence<0.4 |

### 步骤 4：输出修正
如果存在偏差，给出 correctedAction 和 correctedParams。

## 输出格式（严格 JSON）
{"passed":true,"confidence":0.95,"explanation":"用户意图与理解一致，action=image,style=anime 均匹配"}
{"passed":false,"confidence":0.3,"explanation":"用户要生成视频但 AI 理解为图片","correctedAction":"video","correctedParams":{"prompt":"...","style":"cinematic","duration":18}}`;

  const userPrompt = `【用户原始需求】"${userMessage}"
【AI 助手理解】action: "${agentAction}", params: ${JSON.stringify(agentParams)}, 描述: "${agentDescription}"

请按推理步骤逐步分析，然后输出审核结果 JSON。`;

  // 尝试 DeepSeek-R1
  const r1Key = getReasoningApiKey();
  if (r1Key) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(REASONING_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${r1Key}` },
        body: JSON.stringify({
          model: REASONING_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json() as any;
        const msg = data.choices?.[0]?.message;
        const reasoning = msg?.reasoning_content || '';
        const content = msg?.content?.trim();

        if (content) {
          const result = parseReviewJSON(content, agentAction, agentParams);
          if (reasoning) {
            console.log(`[ReviewAgent] Reasoning: ${reasoning.substring(0, 200)}...`);
          }
          return result;
        }
      }
    } catch (e) {
      console.warn('[ReviewAgent] DeepSeek-R1 failed:', (e as Error).message);
    }
  }

  // 降级到 GLM-Z1
  const z1Key = getReasoningFallbackApiKey();
  if (z1Key) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(REASONING_FALLBACK_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${z1Key}` },
        body: JSON.stringify({
          model: REASONING_FALLBACK_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json() as any;
        const msg = data.choices?.[0]?.message;
        const content = msg?.content?.trim();

        if (content) {
          return parseReviewJSON(content, agentAction, agentParams);
        }
      }
    } catch (e) {
      console.warn('[ReviewAgent] GLM-Z1 failed:', (e as Error).message);
    }
  }

  return null;
}

/** 解析审核 JSON 结果 */
function parseReviewJSON(content: string, fallbackAction: string, fallbackParams: Record<string, any>): ReviewResult {
  try {
    const jsonStr = content.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    const passed = parsed.passed === true;
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
    const explanation = parsed.explanation || '';

    if (passed) {
      return { passed: true, confidence, explanation, status: 'passed' };
    }

    const correctedAction = parsed.correctedAction || fallbackAction;
    const correctedParams = parsed.correctedParams || fallbackParams;

    console.log(`[ReviewAgent] ⚠️ Deviation detected by reasoning model!`);
    console.log(`   Original: ${fallbackAction}`);
    console.log(`   Corrected: ${correctedAction}`);
    console.log(`   Reason: ${explanation}`);

    return {
      passed: false,
      confidence,
      explanation,
      correctedAction,
      correctedParams,
      status: correctedAction !== fallbackAction ? 'corrected' : 'failed',
    };
  } catch {
    return { passed: true, confidence: 0.5, explanation: '审核结果解析失败', status: 'passed' };
  }
}

/**
 * 审核 Agent：检查 Agent 的理解是否与用户原意一致
 * 如果不一致，自动校对并返回修正后的结果
 */
export async function reviewUserIntent(
  userMessage: string,
  agentAction: string,
  agentParams: Record<string, any>,
  agentDescription: string,
): Promise<ReviewResult> {
  // 优先使用推理模型审核（DeepSeek-R1 / GLM-Z1）
  const reasoningResult = await reviewWithReasoning(userMessage, agentAction, agentParams, agentDescription);
  if (reasoningResult) return reasoningResult;

  // 推理模型不可用，降级到指令模型审核
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return {
      passed: true,
      confidence: 0.5,
      explanation: '未配置审核 API，跳过审核',
      status: 'passed',
    };
  }

  try {
    const systemPrompt = `你是审核 Agent（Review Agent）降级模式，负责检查 AI 助手对用户需求的理解是否准确。

## 审核标准

### 1. Action 类型匹配（权重最高）
| 用户表述 | 正确 action | 常见误判 |
|----------|-------------|----------|
| "画"/"图片"/"插画"/"海报"/"原画"/"头像" | image | 不要误判为 video |
| "视频"/"片子"/"短片"/"广告片"/"宣传片"/"动画" | video | 不要误判为 image |
| "改"/"修"/"换"/"调整" + 已存在的作品 | modify-image/modify-video | 不要误判为新生成 |
| "抠图"/"去背景"/"透明"/"去除背景" | remove-bg | 不要误判为 image |
| "拼一起"/"合成"/"融合"/"拼接" | compose-image | 不要误判为 image |
| "都要"/"图片和视频"/"海报和宣传片" | compose | 不要误判为单一类型 |
| "你好"/"帮我看看"/"怎么用"/"能做什么" | general | 不要强行判为创作 |

### 2. 风格匹配
- 明确说"动漫/二次元/卡通"但 style 不是 anime → 偏差
- 明确说"写实/真实/照片感"但 style 不是 realistic → 偏差
- 明确说"电影/电影感/大片"但 style 不是 cinematic → 偏差
- 说"3D/三维"但 style 不是 3d → 偏差
- 说"插画/手绘"但 style 不是 illustration → 偏差

### 3. 视频时长检查
- 用户明确说"30秒"但 duration 变成 18 → 偏差
- 用户说"5分钟"但 duration 变成 60秒 → 严重偏差
- 用户没说时长，默认值合理 → 无偏差

### 4. 信任度评分
| 分数 | 含义 |
|------|------|
| 0.9-1.0 | 完全匹配，action 和参数都正确 |
| 0.7-0.8 | 细微差异，不影响最终结果 |
| 0.4-0.6 | 部分偏差，需要修正参数 |
| 0-0.3 | 严重偏差，action 类型错误 |

## 输出格式（严格 JSON）
{"passed":true,"confidence":0.95,"explanation":"用户意图与理解一致"}
{"passed":false,"confidence":0.3,"explanation":"用户要视频但理解为图片","correctedAction":"video","correctedParams":{"prompt":"...","style":"cinematic","duration":18}}`;

    const userPrompt = `【用户原始需求】"${userMessage}"
【AI 助手理解】action: "${agentAction}", params: ${JSON.stringify(agentParams)}, 描述: "${agentDescription}"

请审核并返回 JSON。`;

    // 添加超时控制（15秒），避免审核卡住整个流程
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(ZHIPU_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: REVIEW_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 500,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('[ReviewAgent] API failed, skip review');
        return { passed: true, confidence: 0.3, explanation: '审核 API 调用失败', status: 'passed' };
      }

      const data = await response.json() as Record<string, any>;
      const content = data.choices?.[0]?.message?.content?.trim();

      if (!content) {
        return { passed: true, confidence: 0.3, explanation: '审核返回空内容', status: 'passed' };
      }

      // 解析 JSON
      let parsed: Record<string, any>;
      try {
        const jsonStr = content.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
        parsed = JSON.parse(jsonStr);
      } catch {
        console.warn('[ReviewAgent] Cannot parse review result, raw:', content.substring(0, 100));
        return { passed: true, confidence: 0.5, explanation: '审核结果解析失败', status: 'passed' };
      }

      const passed = parsed.passed === true;
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
      const explanation = parsed.explanation || '';

      if (passed) {
        return { passed: true, confidence, explanation, status: 'passed' };
      }

      // 有偏差，需要修正
      const correctedAction = parsed.correctedAction || agentAction;
      const correctedParams = parsed.correctedParams || agentParams;

      console.log(`[ReviewAgent] ⚠️ Deviation detected!`);
      console.log(`   Original: ${agentAction} | ${JSON.stringify(agentParams)}`);
      console.log(`   Corrected: ${correctedAction} | ${JSON.stringify(correctedParams)}`);
      console.log(`   Reason: ${explanation}`);

      return {
        passed: false,
        confidence,
        explanation,
        correctedAction,
        correctedParams,
        status: correctedAction !== agentAction ? 'corrected' : 'failed',
      };
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('[ReviewAgent] Exception:', error);
      return { passed: true, confidence: 0.3, explanation: '审核异常', status: 'passed' };
    }
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('[ReviewAgent] Exception:', error);
    return { passed: true, confidence: 0.3, explanation: '审核异常', status: 'passed' };
  }
}
