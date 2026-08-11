/**
 * Agent 记忆服务 — 短期记忆 + 长期记忆 + 向量检索
 *
 * 短期记忆（会话级）：
 * - 每个 agent 在会话内的对话轮次
 * - 自动压缩：超过 15 轮用 LLM 生成摘要
 * - 会话结束自动清理
 *
 * 长期记忆（跨会话）：
 * - 用户偏好、创作历史、风格偏好
 * - 向量嵌入 + 相似度检索
 * - 重要性评分 + 访问频率加权
 */
import { embedText, cosineSimilarity } from './embeddingService.js';
import {
  addShortMemory, getShortMemories, compressShortMemories, clearSessionShortMemories,
  addLongMemory, getLongMemoriesByAgent, getAllLongMemoriesWithEmbedding,
  incrementLongMemoryAccess, deleteLongMemory,
} from './database.js';
import { getChatApiKey, CHAT_API, CHAT_MODEL } from './llmConfig.js';

// ===== 配置 =====
const SHORT_MEMORY_MAX_TURNS = 15;
const LONG_MEMORY_MIN_IMPORTANCE = 0.3;
const LONG_MEMORY_SIMILARITY_THRESHOLD = 0.75;

// ===== 短期记忆 =====

/** 记录一轮 agent 对话 */
export function recordAgentTurn(params: {
  sessionId: string; agentName: string; turnIndex: number;
  role: 'user' | 'assistant' | 'system'; content: string; summary?: string;
}): void {
  addShortMemory({
    session_id: params.sessionId, agent_name: params.agentName,
    turn_index: params.turnIndex, role: params.role,
    content: params.content, summary: params.summary || '',
    token_estimate: Math.ceil(params.content.length / 2),
  });
}

/** 获取 agent 当前会话上下文（用于构建 LLM prompt） */
export function getAgentContext(sessionId: string, agentName: string): Array<{ role: string; content: string }> {
  const memories = getShortMemories(sessionId, agentName);
  return memories.map(m => ({ role: m.role, content: m.summary || m.content }));
}

/** 检查并自动压缩短期记忆 */
export async function checkAndCompress(sessionId: string, agentName: string): Promise<boolean> {
  const memories = getShortMemories(sessionId, agentName);
  if (memories.length < SHORT_MEMORY_MAX_TURNS) return false;
  const summary = await generateMemorySummary(memories, agentName);
  if (summary) { compressShortMemories(sessionId, agentName, summary, 5); console.log(`[Memory] ${agentName} 短期记忆已压缩 → 保留5轮 + 摘要`); return true; }
  return false;
}

export function clearSessionMemory(sessionId: string): void { clearSessionShortMemories(sessionId); }

async function generateMemorySummary(memories: any[], agentName: string): Promise<string> {
  const apiKey = getChatApiKey();
  if (!apiKey) return '';
  try {
    const dialogue = memories.map(m => `${m.role}: ${m.content.substring(0, 200)}`).join('\n');

    const systemPrompt = `你是 Agent 记忆压缩专家，负责将 ${agentName} Agent 的对话历史压缩为结构化摘要。

## 压缩原则
1. **保留关键信息**：用户核心需求、最终决策、使用的参数
2. **丢弃冗余**：中间追问、确认对话、无关闲聊
3. **优先级排序**：任务结果 > 参数选择 > 用户偏好 > 上下文线索
4. **结构化输出**：按以下格式输出

## 输出格式（严格按此格式）
【任务】用户的核心需求是什么（1句话）
【决策】Agent 最终选择了什么 action 和关键参数
【偏好】用户表现出的风格/时长/尺寸等偏好（如有）
【上下文】与前后轮次的关键关联（如有）

## 示例
输入：用户"画一只猫" → Agent 生成图片 → 用户"换成动漫风格" → Agent 修改
输出：【任务】用户需要生成一只猫的图片，后改为动漫风格 【决策】action=modify-image, style=anime, 主体=猫 【偏好】用户偏好动漫风格 【上下文】基于上一轮的猫图片进行修改`;

    const resp = await fetch(CHAT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请压缩以下 ${agentName} Agent 对话历史：\n\n${dialogue}` },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });
    const data = await resp.json() as any;
    return data.choices?.[0]?.message?.content?.trim() || '';
  } catch { return ''; }
}

// ===== 长期记忆 =====

/** 存储长期记忆（自动向量化 + 去重） */
export async function remember(params: {
  sessionId: string; agentName: string; category: string;
  content: string; importance?: number;
}): Promise<string | null> {
  const importance = params.importance || 0.5;
  if (importance < LONG_MEMORY_MIN_IMPORTANCE) return null;

  const existing = getLongMemoriesByAgent(params.agentName, 20);
  const duplicate = existing.find(m => m.content === params.content || (m.content.length > 20 && params.content.includes(m.content.substring(0, 30))));
  if (duplicate) { incrementLongMemoryAccess(duplicate.id); return duplicate.id; }

  let embeddingJson = '';
  try { embeddingJson = JSON.stringify(await embedText(params.content)); } catch { /* ok */ }

  const id = addLongMemory({ session_id: params.sessionId, agent_name: params.agentName, category: params.category, content: params.content, embedding_json: embeddingJson, importance });
  console.log(`[Memory] 长期记忆存储: ${params.agentName}/${params.category} (importance=${importance})`);
  return id;
}

/** 向量检索相关长期记忆 */
export async function recall(params: {
  agentName?: string; category?: string; query: string; limit?: number;
}): Promise<Array<{ content: string; importance: number; similarity: number }>> {
  const limit = params.limit || 10;
  let candidates: any[] = [];

  if (params.agentName) { candidates = getLongMemoriesByAgent(params.agentName, 100); }
  else if (params.category) { candidates = getAllLongMemoriesWithEmbedding(100).filter(m => m.category === params.category); }
  else { candidates = getAllLongMemoriesWithEmbedding(100); }

  if (candidates.length === 0) return [];

  try {
    const queryEmb = await embedText(params.query);
    const scored = candidates.filter(m => m.embedding_json).map(m => { let s = 0; try { s = cosineSimilarity(queryEmb, JSON.parse(m.embedding_json)); } catch { /* skip */ } return { ...m, similarity: s }; }).filter(m => m.similarity > LONG_MEMORY_SIMILARITY_THRESHOLD).sort((a, b) => b.importance * b.similarity - a.importance * a.similarity).slice(0, limit);
    scored.forEach(m => incrementLongMemoryAccess(m.id));
    return scored.map(m => ({ content: m.content, importance: m.importance, similarity: m.similarity }));
  } catch { return candidates.slice(0, limit).map(m => ({ content: m.content, importance: m.importance, similarity: 0.5 })); }
}

/** 清理低重要性记忆 */
export function forgetLowImportance(threshold = 0.1): number {
  const all = getAllLongMemoriesWithEmbedding(1000); let d = 0;
  all.forEach(m => { if (m.importance < threshold) { deleteLongMemory(m.id); d++; } });
  if (d > 0) console.log(`[Memory] 清理 ${d} 条低重要性长期记忆`);
  return d;
}
