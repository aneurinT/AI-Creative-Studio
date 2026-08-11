/**
 * Checkpointing 与状态持久化服务
 *
 * 在 Agent 工作流的关键节点保存状态快照，支持：
 * - 失败恢复：从最近的检查点恢复执行
 * - 状态追踪：查看 Agent 执行到哪一步
 * - 断点续传：用户刷新页面后恢复上下文
 * - 自动过期：超过 24 小时的检查点自动清理
 *
 * 检查点阶段（按 Agent 工作流）：
 *   hermes: intent_detected → review_passed → task_dispatched → task_completed
 *   video:  script_generated → script_reviewed → params_extracted → video_generating → video_completed
 *   image:  prompt_optimized → image_generating → image_completed
 *   compose: parallel_tasks_created → all_tasks_completed
 */

import {
  saveCheckpoint,
  getActiveCheckpoints,
  getLatestCheckpoint,
  completeCheckpoint,
  failCheckpoint,
  expireOldCheckpoints,
  type CheckpointRow,
} from './database.js';

// ===== 检查点阶段定义 =====

export const CHECKPOINT_STAGES = {
  // Hermes Agent（意图识别与路由）
  HERMES_INTENT_DETECTED: 'hermes:intent_detected',
  HERMES_REVIEW_PASSED: 'hermes:review_passed',
  HERMES_TASK_DISPATCHED: 'hermes:task_dispatched',
  HERMES_TASK_COMPLETED: 'hermes:task_completed',

  // Video Agent（视频生成流程）
  VIDEO_SCRIPT_GENERATED: 'video:script_generated',
  VIDEO_SCRIPT_REVIEWED: 'video:script_reviewed',
  VIDEO_PARAMS_EXTRACTED: 'video:params_extracted',
  VIDEO_GENERATING: 'video:generating',
  VIDEO_COMPLETED: 'video:completed',

  // Image Agent（图片生成流程）
  IMAGE_PROMPT_OPTIMIZED: 'image:prompt_optimized',
  IMAGE_GENERATING: 'image:generating',
  IMAGE_COMPLETED: 'image:completed',

  // Compose Agent（并行任务编排）
  COMPOSE_PARALLEL_CREATED: 'compose:parallel_created',
  COMPOSE_ALL_COMPLETED: 'compose:all_completed',
} as const;

export type CheckpointStage = typeof CHECKPOINT_STAGES[keyof typeof CHECKPOINT_STAGES];

// ===== 检查点状态接口 =====

export interface CheckpointState {
  /** 用户原始消息 */
  userMessage?: string;
  /** 识别的 action */
  action?: string;
  /** 生成参数 */
  params?: Record<string, any>;
  /** LLM 响应文本 */
  response?: string;
  /** 推理过程（推理模型） */
  reasoning?: string;
  /** 使用的模型 */
  modelUsed?: string;
  /** 任务 ID（视频/图片生成任务） */
  taskId?: string;
  /** 生成的资源 URL */
  generatedUrl?: string;
  /** 错误信息 */
  error?: string;
  /** 额外上下文 */
  context?: Record<string, any>;
}

// ===== 核心 API =====

/**
 * 在指定阶段创建检查点
 * @returns 检查点 ID
 */
export function createCheckpoint(params: {
  sessionId: string;
  agentName: string;
  stage: CheckpointStage;
  state: CheckpointState;
  summary?: string;
}): string {
  const id = saveCheckpoint({
    session_id: params.sessionId,
    agent_name: params.agentName,
    stage: params.stage,
    state_json: JSON.stringify(params.state),
    summary: params.summary || `${params.agentName}:${params.stage}`,
    status: 'active',
  });

  console.log(`[Checkpoint] ✅ ${params.agentName} → ${params.stage} (id=${id.substring(0, 30)}...)`);
  return id;
}

/**
 * 完成一个检查点（标记为 completed）
 */
export function resolveCheckpoint(checkpointId: string): void {
  completeCheckpoint(checkpointId);
  console.log(`[Checkpoint] 🏁 完成检查点 ${checkpointId.substring(0, 30)}...`);
}

/**
 * 标记检查点为失败
 */
export function rejectCheckpoint(checkpointId: string, error?: string): void {
  failCheckpoint(checkpointId);
  if (error) {
    console.warn(`[Checkpoint] ❌ 检查点失败 ${checkpointId.substring(0, 30)}...: ${error}`);
  }
}

/**
 * 获取最近的活跃检查点（用于恢复）
 */
export function getLatestState(
  sessionId: string,
  agentName: string,
  stage?: CheckpointStage,
): { checkpointId: string; stage: CheckpointStage; state: CheckpointState } | null {
  const cp = getLatestCheckpoint(sessionId, agentName, stage);
  if (!cp) return null;

  let state: CheckpointState = {};
  try {
    state = JSON.parse(cp.state_json);
  } catch {
    state = {};
  }

  return {
    checkpointId: cp.id,
    stage: cp.stage as CheckpointStage,
    state,
  };
}

/**
 * 获取会话的所有活跃检查点（用于前端展示执行进度）
 */
export function getSessionProgress(sessionId: string): Array<{
  agentName: string;
  stage: string;
  summary: string;
  createdAt: string;
  isActive: boolean;
}> {
  const checkpoints = getActiveCheckpoints(sessionId);
  return checkpoints.map(cp => ({
    agentName: cp.agent_name,
    stage: cp.stage,
    summary: cp.summary,
    createdAt: cp.created_at,
    isActive: cp.status === 'active',
  }));
}

/**
 * 检查是否可以从此检查点恢复
 * 返回 true 表示可以安全恢复
 */
export function canResumeFrom(sessionId: string, agentName: string): {
  canResume: boolean;
  stage?: CheckpointStage;
  state?: CheckpointState;
  checkpointId?: string;
} {
  const latest = getLatestState(sessionId, agentName);
  if (!latest) return { canResume: false };

  // 只有以下阶段可以恢复（未完成的状态）
  const resumableStages: CheckpointStage[] = [
    CHECKPOINT_STAGES.HERMES_INTENT_DETECTED,
    CHECKPOINT_STAGES.HERMES_REVIEW_PASSED,
    CHECKPOINT_STAGES.VIDEO_SCRIPT_GENERATED,
    CHECKPOINT_STAGES.VIDEO_SCRIPT_REVIEWED,
    CHECKPOINT_STAGES.VIDEO_PARAMS_EXTRACTED,
    CHECKPOINT_STAGES.IMAGE_PROMPT_OPTIMIZED,
    CHECKPOINT_STAGES.COMPOSE_PARALLEL_CREATED,
  ];

  if (resumableStages.includes(latest.stage)) {
    return {
      canResume: true,
      stage: latest.stage,
      state: latest.state,
      checkpointId: latest.checkpointId,
    };
  }

  return { canResume: false };
}

/**
 * 自动清理过期检查点（建议在服务启动时调用）
 */
export function cleanupExpiredCheckpoints(): number {
  const count = expireOldCheckpoints(24);
  if (count > 0) {
    console.log(`[Checkpoint] 🧹 清理了 ${count} 个过期检查点`);
  }
  return count;
}

/**
 * 完成某个 Agent 的所有活跃检查点
 * 当一个任务流完全结束时调用
 */
export function completeAgentCheckpoints(sessionId: string, agentName: string): number {
  const checkpoints = getActiveCheckpoints(sessionId, agentName);
  let count = 0;
  for (const cp of checkpoints) {
    completeCheckpoint(cp.id);
    count++;
  }
  if (count > 0) {
    console.log(`[Checkpoint] 🏁 完成 ${agentName} 的 ${count} 个检查点`);
  }
  return count;
}