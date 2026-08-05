/**
 * Agent 记忆服务
 * 
 * 短期记忆（会话级）：
 * - 每个 agent 在会话内的对话轮次
 * - 自动压缩：超过阈值时用 LLM 生成摘要
 * - 会话结束自动清理
 *
 * 长期记忆（跨会话）：
 * - 用户偏好、创作历史、风格偏好
 * - 向量嵌入 + 相似度检索
 * - 重要性评分 + 衰减机制
 */
import { embedText, cosineSimilarity } from './embeddingService.js';
import {
  addShortMemory, getShortMemories, compressShortMemories, clearSessionShortMemories,
  addLongMemory, getLongMemoriesByAgent, getAllLongMemoriesWithEmbedding,
  incrementLongMemoryAccess, deleteLongMemory,
} from './database.js';
import { getChatApiKey, CHAT_API, CHAT_MODEL } from './llmConfig.js';

// ===== 配置 =====
const SHORT_MEMORY_MAX_TURNS = 15; // 短期记忆最大轮次，超过则压缩
const LONG_MEMORY_MIN_IMPORTANCE = 0.3; // 长期记忆最低重要性阈值
const LONG_MEMORY_SIMILARITY_THRESHOLD = 0.75; // 向量相似度阈值

// ===== 短期记忆 =====

/** 为 agent 记录一轮对话 */
export function recordAgentTurn(params: {
  sessionId: string;
  agentName: string;
  turnIndex: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  summary?: string;
}): void {
  const tokenEstimate = Math.ceil(params.content.length / 2); // 粗略估算
  addShortMemory({
    session_id: params.sessionId,
    agent_name: params.agentName,
    turn_index: params.turnIndex,
    role: params.role,
    content: params.content,
    summary: params.summary || '',
    token_estimate: tokenEstimate,
  });
}

/** 获取 agent 在当前会话的上下文（用于构建 LLM prompt） */
export function getAgentContext(sessionId: string, agentName: string): Array<{ role: string; content: string }> {
  const memories = getShortMemories(sessionId, agentName);
  return memories.map(m => ({ role: m.role, content: m.summary || m.content }));
}

/** 检查是否需要压缩，如果超过阈值则自动压缩 */
export async function checkAndCompress(sessionId: string, agentName: string): Promise<boolean> {
  const memories = getShortMemories(sessionId, agentName);
  if (memories.length < SHORT_MEMORY_MAX_TURNS) return false;

  // 生成摘要
  const summary = await generateMemorySummary(memories, agentName);
  if (summary) {
    compressShortMemories(sessionId, agentName, summary, 5); // 保留最近 5 轮
    console.log(`[AgentMemory] ${agentName} 短期记忆已压缩，保留最近 5 轮 + 摘要`);
    return true;
  }
  return false;
}

/** 清理会话的短期记忆 */
export function clearSessionMemory(sessionId: string): void {
  clearSessionShortMemories(sessionId);
}

/** 用 LLM 生成记忆摘要 */
async function generateMemorySummary(memories: any[], agentName: string): Promise<string> {
  const apiKey = getChatApiKey();
  if (!apiKey) return '';

  try {
    const dialogue = memories.map(m => `${m.role}: ${m.content.substring(0, 200)}`).join('\n');
    const response = await fetch(CHAT_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          {
            role: 'system',
            content: `你是记忆压缩助手。将 ${agentName} agent 的对话历史压缩为 2-3 句话的摘要，保留关键信息：用户需求、任务类型、参数选择、重要上下文。`,
          },
          { role: 'user', content: dialogue },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content?.trim() || '';
  } catch {
    return '';
  }
}

// ===== 长期记忆 =====

/** 记录长期记忆（自动向量化 + 去重） */
export async function remember(params: {
  sessionId: string;
  agentName: string;
  category: string;
  content: string;
  importance?: number;
}): Promise<string | null> {
  const importance = params.importance || 0.5;
  if (importance < LONG_MEMORY_MIN_IMPORTANCE) return null;

  // 检查是否有相似记忆（避免重复）
  const existing = getLongMemoriesByAgent(params.agentName, 20);
  const duplicate = existing.find(m =>
    m.content === params.content ||
    (m.content.length > 20 && params.content.includes(m.content.substring(0, 30)))
  );
  if (duplicate) {
    incrementLongMemoryAccess(duplicate.id);
    // 提升重要性
    return duplicate.id;
  }

  // 向量化
  let embeddingJson = '';
  try {
    const embedding = await embedText(params.content);
    embeddingJson = JSON.stringify(embedding);
  } catch {
    // 向量化失败不影响存储
  }

  const id = addLongMemory({
    session_id: params.sessionId,
    agent_name: params.agentName,
    category: params.category,
    content: params.content,
    embedding_json: embeddingJson,
    importance,
  });

  console.log(`[AgentMemory] 长期记忆已存储: ${params.agentName}/${params.category} (importance=${importance})`);
  return id;
}

/** 检索相关长期记忆（向量 + 关键词混合） */
export async function recall(params: {
  agentName?: string;
  category?: string;
  query: string;
  limit?: number;
}): Promise<Array<{ content: string; importance: number; similarity: number }>> {
  const limit = params.limit || 10;
  let candidates: any[] = [];

  // 按 agent 或 category 过滤
  if (params.agentName) {
    candidates = getLongMemoriesByAgent(params.agentName, 100);
  } else if (params.category) {
    // 这里使用带 embedding 的查询
    candidates = getAllLongMemoriesWithEmbedding(100);
    candidates = candidates.filter(m => m.category === params.category);
  } else {
    candidates = getAllLongMemoriesWithEmbedding(100);
  }

  if (candidates.length === 0) return [];

  // 向量检索
  try {
    const queryEmbedding = await embedText(params.query);
    const scored = candidates
      .filter(m => m.embedding_json)
      .map(m => {
        let similarity = 0;
        try {
          const emb = JSON.parse(m.embedding_json);
          similarity = cosineSimilarity(queryEmbedding, emb);
        } catch { /* skip */ }
        return { ...m, similarity };
      })
      .filter(m => m.similarity > LONG_MEMORY_SIMILARITY_THRESHOLD)
      .sort((a, b) => b.importance * b.similarity - a.importance * a.similarity)
      .slice(0, limit);

    // 更新访问计数
    scored.forEach(m => incrementLongMemoryAccess(m.id));

    return scored.map(m => ({
      content: m.content,
      importance: m.importance,
      similarity: m.similarity,
    }));
  } catch {
    // 向量检索失败，回退到关键词
    return candidates.slice(0, limit).map(m => ({
      content: m.content,
      importance: m.importance,
      similarity: 0.5,
    }));
  }
}

/** 遗忘不重要的记忆（重要性衰减 + 清理） */
export function forgetLowImportance(threshold: number = 0.1): number {
  const all = getAllLongMemoriesWithEmbedding(1000);
  let deleted = 0;
  all.forEach(m => {
    if (m.importance < threshold) {
      deleteLongMemory(m.id);
      deleted++;
    }
  });
  if (deleted > 0) {
    console.log(`[AgentMemory] 清理了 ${deleted} 条低重要性长期记忆`);
  }
  return deleted;
}
