/**
 * AI 协作者服务
 *
 * 能力：在多人协同房间中，AI Agent 可主动加入、监听对话、提供创意建议或自动执行任务
 *
 * 实现要点：
 *  - 监听房间消息：当用户消息包含创作意图关键词时触发
 *  - 上下文化分析：拉取最近对话作为上下文
 *  - 智能响应：生成创意建议或自动编排 Agent 执行
 *  - 协作感知：避免打断人类主导的讨论，使用"建议"而非"命令"口吻
 */

import {
  getRoom,
  getRoomMessages,
  broadcastMessage,
  type CollaborationMessage,
} from './collaborationService.js';
import { runOrchestration } from './orchestrator.js';
import { recordExperience } from './globalExperiencePool.js';
import fetch from 'node-fetch';

const AI_COLLABORATOR_USER_ID = 'ai-collaborator';
const AI_COLLABORATOR_NAME = 'AI 协作者';

// 触发 AI 协作者的关键词
const TRIGGER_KEYWORDS = [
  '帮我', '建议', '想法', '创意', '生成', '制作', '优化',
  '改一下', '做一下', '写一个', '做一张', '做一段',
  'video', 'image', '海报', '视频', '图片', '配音', '字幕',
  'suggest', 'idea', 'create', 'make', 'generate',
];

// AI 协作者的"人设"：以创意伙伴的身份提供帮助
const SYSTEM_PROMPT = `你是一名嵌入在多人协作房间中的 AI 创意协作者。
你的身份：AI 协作者（AI Collaborator）
你的角色：创意伙伴 + 执行助手

## 行为准则
1. **倾听优先**：先理解对话上下文，再发言
2. **不抢主导**：当人类在讨论时，不要每句都插话；只在出现创作意图时主动提供建议
3. **建议口吻**：使用 "我建议..." "可以考虑..." "如果需要我可以..." 的语气
4. **行动导向**：如果用户明确说"帮我生成/做"，直接编排执行，不要只给建议
5. **透明化**：告诉用户你打算调用哪个能力（图片生成/视频生成/文案等）

## 输出格式（严格 JSON）
{
  "shouldRespond": true/false,
  "responseType": "suggestion" | "action" | "observe",
  "message": "给用户的中文回复",
  "action": { "agentName": "xxx", "action": "xxx", "params": {} } | null
}`;

// ======================== 类型 ========================

export interface AICollaboratorOptions {
  /** 是否启用自动监听（默认 true） */
  autoListen?: boolean;
  /** 触发阈值：最近 N 条消息内出现关键词即触发 */
  triggerWindow?: number;
  /** 是否允许 AI 自主执行任务（默认 true） */
  allowAutoExecute?: boolean;
}

const DEFAULT_OPTIONS: Required<AICollaboratorOptions> = {
  autoListen: true,
  triggerWindow: 5,
  allowAutoExecute: true,
};

// 每个房间的协作者状态
interface RoomCollaboratorState {
  enabled: boolean;
  lastMessageHandled: number; // timestamp
  options: Required<AICollaboratorOptions>;
}

const roomStates = new Map<string, RoomCollaboratorState>();

// 防频控：避免 AI 连续触发
const lastResponseAt = new Map<string, number>();
const MIN_RESPONSE_INTERVAL_MS = 8000;

// ======================== 公开 API ========================

/** 启用 AI 协作者进入指定房间 */
export function enableCollaborator(roomId: string, options?: AICollaboratorOptions): void {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  roomStates.set(roomId, {
    enabled: true,
    lastMessageHandled: 0,
    options: merged,
  });
  console.log(`[AICollaborator] Enabled for room ${roomId}`);
}

/** 禁用 AI 协作者 */
export function disableCollaborator(roomId: string): void {
  roomStates.delete(roomId);
  console.log(`[AICollaborator] Disabled for room ${roomId}`);
}

/** 列出 AI 协作者已加入的房间 */
export function listCollaboratorRooms(): string[] {
  return Array.from(roomStates.entries())
    .filter(([, s]) => s.enabled)
    .map(([roomId]) => roomId);
}

/**
 * 当房间有新消息时调用，AI 协作者在后台判断是否介入
 * 由路由层的消息广播入口自动调用
 */
export function onRoomMessage(msg: CollaborationMessage): void {
  const state = roomStates.get(msg.roomId);
  if (!state || !state.enabled || !state.options.autoListen) return;

  // 忽略 AI 自己的消息，避免死循环
  if (msg.userId === AI_COLLABORATOR_USER_ID) return;

  // 防频控
  const lastAt = lastResponseAt.get(msg.roomId) || 0;
  if (Date.now() - lastAt < MIN_RESPONSE_INTERVAL_MS) return;

  // 检测是否包含触发关键词
  const contentLower = msg.content.toLowerCase();
  const triggered = TRIGGER_KEYWORDS.some((kw) => contentLower.includes(kw.toLowerCase()));
  if (!triggered) return;

  // 后台异步处理（不阻塞消息广播）
  lastResponseAt.set(msg.roomId, Date.now());
  setTimeout(async () => {
    try {
      await processAndRespond(msg.roomId, state);
    } catch (err) {
      console.error('[AICollaborator] Background error:', err);
    }
  }, 300);
}

// ======================== 内部逻辑 ========================

async function processAndRespond(roomId: string, state: RoomCollaboratorState): Promise<void> {
  // 1. 拉取最近 N 条消息作为上下文
  const recentMessages = getRoomMessages(roomId, state.options.triggerWindow);
  if (recentMessages.length === 0) return;

  // 2. 构建对话历史
  const conversationHistory = recentMessages
    .filter((m) => m.userId !== AI_COLLABORATOR_USER_ID)
    .map((m) => `${m.username}: ${m.content}`)
    .join('\n');

  // 3. 调用 LLM 判断是否介入、如何介入
  const decision = await decideIntervention(conversationHistory, state.options.allowAutoExecute);
  if (!decision || !decision.shouldRespond) return;

  // 4. 广播 AI 的回复（以"system"或"agent_response"类型）
  broadcastMessage({
    roomId,
    userId: AI_COLLABORATOR_USER_ID,
    username: AI_COLLABORATOR_NAME,
    content: decision.message,
    type: 'agent_response',
  });

  // 5. 如果决策包含行动，编排执行
  if (state.options.allowAutoExecute && decision.action) {
    broadcastMessage({
      roomId,
      userId: AI_COLLABORATOR_USER_ID,
      username: AI_COLLABORATOR_NAME,
      content: `正在执行：${decision.action.agentName} / ${decision.action.action} ...`,
      type: 'task_update',
    });

    try {
      const result = await runOrchestration({
        userMessage: buildExecutionPrompt(decision.action, conversationHistory),
        userId: AI_COLLABORATOR_USER_ID,
      });

      broadcastMessage({
        roomId,
        userId: AI_COLLABORATOR_USER_ID,
        username: AI_COLLABORATOR_NAME,
        content: formatExecutionResult(result),
        type: 'agent_response',
      });

      // 记录执行结果到经验池
      recordExperience({
        message: conversationHistory,
        agentName: decision.action.agentName,
        action: decision.action.action,
        params: decision.action.params,
        status: result.success ? 'success' : 'failed',
        durationMs: result.durationMs || 0,
        retryCount: 0,
        resultSummary: typeof result.output === 'string'
          ? result.output.substring(0, 300)
          : JSON.stringify(result.output).substring(0, 300),
      });
    } catch (err) {
      broadcastMessage({
        roomId,
        userId: AI_COLLABORATOR_USER_ID,
        username: AI_COLLABORATOR_NAME,
        content: `执行遇到问题：${(err as Error).message}`,
        type: 'agent_response',
      });
    }
  }
}

async function decideIntervention(
  conversationHistory: string,
  allowAction: boolean,
): Promise<any> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    // 无 API key 时退化为基于关键词的简单规则
    return heuristicDecision(conversationHistory, allowAction);
  }

  try {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `最近协作对话：\n${conversationHistory}\n\n请判断你是否应该介入，以及如何介入。${allowAction ? '' : '注意：当前不允许自动执行任务，只能给出建议。'}`,
          },
        ],
        temperature: 0.6,
        max_tokens: 600,
      }),
    });

    if (!response.ok) {
      console.warn(`[AICollaborator] Decision API failed (${response.status}), fallback to heuristic`);
      return heuristicDecision(conversationHistory, allowAction);
    }

    const data = (await response.json()) as Record<string, any>;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    try {
      const jsonStr = content.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
      return JSON.parse(jsonStr);
    } catch {
      return {
        shouldRespond: true,
        responseType: 'suggestion',
        message: content,
        action: null,
      };
    }
  } catch (error) {
    console.warn('[AICollaborator] Decision exception:', error);
    return heuristicDecision(conversationHistory, allowAction);
  }
}

/** 无 LLM 时的基于规则的回退决策 */
function heuristicDecision(conversationHistory: string, allowAction: boolean): any {
  const lower = conversationHistory.toLowerCase();

  // 检测明确的"帮我"意图
  if (lower.includes('帮我') || lower.includes('建议') || lower.includes('生成')) {
    // 基于简单规则选一个合适的 Agent
    let action: any = null;
    if (allowAction) {
      if (lower.includes('视频') || lower.includes('video')) {
        action = { agentName: 'videoAgent', action: 'generate', params: { prompt: conversationHistory } };
      } else if (lower.includes('图片') || lower.includes('海报') || lower.includes('image')) {
        action = { agentName: 'imageAgent', action: 'generate', params: { prompt: conversationHistory } };
      } else if (lower.includes('文案') || lower.includes('caption') || lower.includes('脚本')) {
        action = { agentName: 'contentAgent', action: 'write', params: { prompt: conversationHistory } };
      }
    }

    return {
      shouldRespond: true,
      responseType: action ? 'action' : 'suggestion',
      message: action
        ? `我可以帮你完成这个需求，正在为你编排 ${action.agentName}...`
        : '这是一个有趣的方向，我建议我们可以结合图片生成 + 文案创作两步走。如果你需要，我可以立即执行。',
      action,
    };
  }

  return null;
}

function buildExecutionPrompt(action: any, history: string): string {
  const userMessages = history
    .split('\n')
    .filter((line) => !line.startsWith('AI 协作者:'))
    .join('\n');
  return `基于协作对话上下文执行任务：\n${userMessages}\n\n目标能力：${action.agentName} / ${action.action}`;
}

function formatExecutionResult(result: any): string {
  if (!result || !result.success) {
    return `执行未成功：${result?.error || '未知错误'}`;
  }

  const output = typeof result.output === 'string'
    ? result.output
    : JSON.stringify(result.output, null, 2);
  const url = result.output?.imageUrl || result.output?.videoUrl;
  if (url) {
    return `已为你完成，结果地址：${url}`;
  }
  return `执行完成，结果：${output.substring(0, 500)}`;
}
