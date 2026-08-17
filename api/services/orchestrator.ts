/**
 * Agent 调度编排器（Orchestrator）
 *
 * 核心能力：
 * 1. 并行判断 — 分析用户任务是否可拆分为并行子任务
 * 2. 动态调度 — 根据上下文动态选择下一个执行 Agent
 * 3. 重试+回退 — 失败自动重试（最多3次），全部失败则回退到人工确认
 * 4. 共享上下文 — 所有 Agent 共享 session 上下文 + 长短记忆
 * 5. 操作日志 — 每步操作记录到持久化日志
 */
import { getChatApiKey, CHAT_API, CHAT_MODEL } from './llmConfig.js';
import { recall, remember } from './agentMemory.js';
import { addOperationLog } from './database.js';
import { startSpan, endSpan, createTrace, finishTrace, setSpanRetryCount } from './tracing.js';
import type { ActiveSpan } from './tracing.js';
import { recordExperience, suggestOptimalAgent, suggestOptimalParams, queryExperience } from './globalExperiencePool.js';

// ===== 类型定义 =====

export interface AgentTask {
  id: string;
  agentName: string;
  action: string;
  params: Record<string, any>;
  dependencies?: string[];    // 依赖的任务 ID 列表
  canParallel?: boolean;      // 是否可与其他任务并行
  retryCount: number;
  maxRetries: number;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  result?: any;
  error?: string;
  startTime?: number;
  endTime?: number;
  retryHistory: Array<{ time: number; error: string }>;
}

export interface OrchestrationPlan {
  tasks: AgentTask[];
  executionMode: 'sequential' | 'parallel' | 'hybrid';
  reasoning: string;           // 调度决策理由
  parallelGroups: string[][];  // 并行组：同组内可并行执行
}

export interface OrchestrationContext {
  sessionId: string;
  userMessage: string;
  history?: any[];
  imageContext?: any;
  videoContext?: any;
  /** 所有 agent 共享的上下文快照 */
  sharedContext: Record<string, any>;
  /** 链路追踪 ID（由 traceMiddleware 注入，贯穿整个调度链路） */
  traceId?: string;
  /** 父 span ID（executePlan 设置为 planSpan.spanId，供 executeWithRetry 子 span 继承） */
  parentSpanId?: string;
}

// ===== 并行判断 — LLM 分析用户任务 =====

const PARALLEL_ANALYSIS_PROMPT = `你是任务编排分析专家（Orchestrator Agent），负责分析用户请求并判断任务是否可以并行执行。

## 判断规则
1. **可并行（parallel）**：任务之间没有依赖关系，可以同时执行
   - 例："同时生成一张图片和一段视频" → 两个任务独立，可并行
   - 例："帮我生成海报和宣传片" → compose 拆为 image + video，可并行
2. **串行（sequential）**：任务有先后依赖，必须按顺序执行
   - 例："先生成图片，再修改它" → 修改依赖图片生成结果
   - 例："生成视频，然后加上字幕" → 字幕依赖视频完成
3. **混合（hybrid）**：部分可并行，部分需串行
   - 例："生成海报和宣传片，然后把海报改成竖版" → 海报+宣传片可并行，海报修改串行

## 任务拆分原则
- 每个任务必须指定 agentName（storyWriter/videoMaker/imageCreator/hermes）
- 每个任务必须指定 action 类型
- dependencies 数组列出依赖的任务 ID
- canParallel 标记该任务是否可以与其他任务并行

## 输出 JSON
{
  "tasks": [
    {"taskId": "task-1", "agentName": "imageCreator", "action": "image", "params": {"prompt": "..."}, "dependencies": [], "canParallel": true},
    {"taskId": "task-2", "agentName": "videoMaker", "action": "video", "params": {"prompt": "..."}, "dependencies": [], "canParallel": true}
  ],
  "executionMode": "parallel",
  "parallelGroups": [["task-1", "task-2"]],
  "reasoning": "图片和视频生成无依赖关系，可同时执行"
}`;

export async function analyzeParallelism(
  userMessage: string,
  context: OrchestrationContext
): Promise<OrchestrationPlan> {
  const traceId = context.traceId;
  const span = traceId
    ? startSpan(traceId, context.parentSpanId || null, 'orchestrator', 'analyzeParallelism', { userMessage: userMessage.substring(0, 200) })
    : null;

  // 查询相关历史经验，用于辅助任务分析
  const relevantExperiences = queryExperience({ message: userMessage });
  const experienceHint = relevantExperiences.length > 0
    ? `\n\n【历史经验参考】\n${relevantExperiences.map(e =>
      `- ${e.agentName}/${e.action}: 成功率${(e.successRate * 100).toFixed(0)}%, 平均耗时${e.durationMs}ms, 命中${e.hitCount}次`
    ).join('\n')}`
    : '';
  if (experienceHint) {
    console.log(`[Orchestrator] 查询到 ${relevantExperiences.length} 条相关历史经验`);
  }

  const apiKey = getChatApiKey();
  if (!apiKey) {
    // 无 LLM 时：单任务顺序执行
    const result = {
      tasks: [createDefaultTask(userMessage, context)],
      executionMode: 'sequential' as const,
      reasoning: '无 LLM 可用，默认串行执行',
      parallelGroups: [['task-0']],
    };
    if (span) endSpan(span, 'success', { executionMode: result.executionMode });
    return result;
  }

  try {
    // 注入共享上下文
    const contextSummary = context.sharedContext?.lastAction
      ? `当前上下文：上一个操作是 ${context.sharedContext.lastAction}`
      : '';

    const resp = await fetch(CHAT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [
          { role: 'system', content: PARALLEL_ANALYSIS_PROMPT },
          { role: 'user', content: `${contextSummary}${experienceHint}\n\n用户请求：${userMessage}` },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json() as any;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('空响应');

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON解析失败');

    const parsed = JSON.parse(jsonMatch[0]);

    // 构建任务列表
    const tasks: AgentTask[] = (parsed.tasks || []).map((t: any, i: number) => ({
      id: `task-${Date.now()}-${i}`,
      agentName: t.agentName || 'hermes',
      action: t.action || 'general',
      params: t.params || {},
      dependencies: t.dependencies || [],
      canParallel: t.canParallel !== false,
      retryCount: 0,
      maxRetries: 3,
      status: 'pending' as const,
      retryHistory: [],
    }));

    if (tasks.length === 0) {
      tasks.push(createDefaultTask(userMessage, context));
    }

    const successResult = {
      tasks,
      executionMode: parsed.executionMode || 'sequential',
      reasoning: parsed.reasoning || 'AI 分析完成',
      parallelGroups: parsed.parallelGroups || [tasks.map(t => t.id)],
    };
    if (span) endSpan(span, 'success', { executionMode: successResult.executionMode, reasoning: successResult.reasoning });
    return successResult;

  } catch (err) {
    console.warn('[Orchestrator] 并行分析失败，使用默认串行:', (err as Error).message);
    const task = createDefaultTask(userMessage, context);
    const failResult = {
      tasks: [task],
      executionMode: 'sequential' as const,
      reasoning: `分析异常(${(err as Error).message})，默认串行执行`,
      parallelGroups: [[task.id]],
    };
    if (span) endSpan(span, 'failed', undefined, (err as Error).message);
    return failResult;
  }
}

function createDefaultTask(userMessage: string, context: OrchestrationContext): AgentTask {
  const lower = userMessage.toLowerCase();
  let action = 'general';
  let agentName = 'hermes';

  if (lower.includes('视频') || lower.includes('video')) { action = 'video'; agentName = 'videoMaker'; }
  else if (lower.includes('图片') || lower.includes('图像') || lower.includes('画')) { action = 'image'; agentName = 'imageCreator'; }
  else if (lower.includes('修改')) { action = lower.includes('视频') ? 'modify-video' : 'modify-image'; agentName = 'videoMaker'; }

  return {
    id: `task-${Date.now()}-0`,
    agentName, action,
    params: { prompt: userMessage },
    dependencies: [], canParallel: false,
    retryCount: 0, maxRetries: 3,
    status: 'pending', retryHistory: [],
  };
}

// ===== 重试+回退机制 =====

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;      // 基础延迟（ms）
  backoffMultiplier: number; // 指数退避倍率
  retryableErrors: string[]; // 可重试的错误类型
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  backoffMultiplier: 2,
  retryableErrors: ['timeout', 'rate_limit', 'server_error', 'network'],
};

/** 判断错误是否可重试 */
export function isRetryable(error: string, config: RetryConfig = DEFAULT_RETRY_CONFIG): boolean {
  const lower = error.toLowerCase();
  return config.retryableErrors.some(e => lower.includes(e));
}

/** 计算重试延迟（指数退避） */
export function getRetryDelay(retryCount: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  return config.baseDelay * Math.pow(config.backoffMultiplier, retryCount);
}

/** 执行带重试的任务 */
export async function executeWithRetry(
  task: AgentTask,
  executor: (task: AgentTask) => Promise<any>,
  context: OrchestrationContext,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<AgentTask> {
  let lastError = '';

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const span = context.traceId
      ? startSpan(context.traceId, context.parentSpanId || null, task.agentName, task.action, { attempt, maxRetries: config.maxRetries, taskId: task.id })
      : null;
    try {
      task.status = 'running';
      task.startTime = Date.now();
      task.retryCount = attempt;
      if (span) setSpanRetryCount(span, attempt);

      const result = await executor(task);
      task.status = 'success';
      task.result = result;
      task.endTime = Date.now();

      const duration = task.endTime - task.startTime!;
      addOperationLog({
        level: 'INFO', category: 'agent-orchestration',
        session_id: context.sessionId,
        operation: `[${task.agentName}] ${task.action}`,
        detail: `成功${attempt > 0 ? `(重试${attempt}次后)` : ''} | 耗时${duration}ms`,
        duration_ms: duration,
        result: 'success',
      });

      // 收集成功经验到全局经验池
      recordExperience({
        message: context.userMessage,
        agentName: task.agentName,
        action: task.action,
        params: task.params,
        status: 'success',
        durationMs: duration,
        retryCount: attempt,
        resultSummary: typeof result === 'string' ? result.substring(0, 200) : JSON.stringify(result).substring(0, 200),
      });

      if (span) endSpan(span, 'success', result);
      return task;

    } catch (err) {
      lastError = (err as Error).message;
      task.retryHistory.push({ time: Date.now(), error: lastError });

      if (attempt < config.maxRetries && isRetryable(lastError, config)) {
        const delay = getRetryDelay(attempt, config);
        addOperationLog({
          level: 'WARN', category: 'agent-orchestration',
          session_id: context.sessionId,
          operation: `[${task.agentName}] 重试`,
          detail: `第${attempt + 1}次重试，等待${delay}ms | 错误: ${lastError.substring(0, 100)}`,
          result: 'failure', error_text: lastError,
        });
        console.warn(`[Orchestrator] ${task.agentName} 失败，${delay}ms后重试(${attempt + 1}/${config.maxRetries}):`, lastError.substring(0, 80));
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // 不可重试或已达最大次数
      task.status = 'failed';
      task.error = lastError;
      task.endTime = Date.now();

      addOperationLog({
        level: 'ERROR', category: 'agent-orchestration',
        session_id: context.sessionId,
        operation: `[${task.agentName}] 最终失败`,
        detail: `已重试${attempt}次 | 错误: ${lastError.substring(0, 200)}`,
        result: 'failure', error_text: lastError,
      });

      // 收集失败经验到全局经验池
      recordExperience({
        message: context.userMessage,
        agentName: task.agentName,
        action: task.action,
        params: task.params,
        status: 'failed',
        durationMs: task.endTime! - task.startTime!,
        retryCount: attempt,
        errorMessage: lastError,
      });

      break;
    }
  }

  // 全部失败 → 回退建议
  task.error = `[回退] ${task.agentName} 任务失败(重试${task.retryCount}次): ${lastError}`;
  return task;
}

// ===== 调度引擎 =====

/** 按执行计划调度执行所有任务 */
export async function executePlan(
  plan: OrchestrationPlan,
  context: OrchestrationContext,
  executor: (task: AgentTask, ctx: OrchestrationContext) => Promise<any>
): Promise<AgentTask[]> {
  const completed = new Map<string, AgentTask>();
  const results: AgentTask[] = [];

  // 顶层 root span：包裹整个计划执行，作为所有子任务 span 的父节点
  const planSpan = context.traceId
    ? startSpan(
      context.traceId,
      context.parentSpanId || null,
      'orchestrator',
      'executePlan',
      { executionMode: plan.executionMode, taskCount: plan.tasks.length, reasoning: plan.reasoning.substring(0, 200) },
    )
    : null;
  // 让子任务（executeWithRetry）的 span 继承 planSpan
  if (planSpan) context.parentSpanId = planSpan.spanId;
  const planStart = Date.now();

  addOperationLog({
    level: 'INFO', category: 'agent-orchestration',
    session_id: context.sessionId,
    operation: '执行计划',
    detail: `模式: ${plan.executionMode} | ${plan.tasks.length}个任务 | ${plan.reasoning}`,
    metadata: JSON.stringify({ executionMode: plan.executionMode, taskCount: plan.tasks.length }),
  });

  // 更新共享上下文
  context.sharedContext.executionPlan = plan;
  context.sharedContext.taskCount = plan.tasks.length;

  try {
    if (plan.executionMode === 'parallel' || plan.executionMode === 'hybrid') {
      // 按并行组执行
      for (const group of plan.parallelGroups) {
        const groupTasks = group.map(id => plan.tasks.find(t => t.id === id)).filter(Boolean) as AgentTask[];

        if (groupTasks.length > 1) {
          // 并行组：同时执行
          console.log(`[Orchestrator] 并行执行 ${groupTasks.length} 个任务:`, groupTasks.map(t => t.agentName));
          const groupResults = await Promise.allSettled(
            groupTasks.map(task => executeWithRetry(task, t => executor(t, context), context))
          );
          groupResults.forEach((r, i) => {
            const task = r.status === 'fulfilled' ? r.value : { ...groupTasks[i], status: 'failed' as const, error: r.reason };
            completed.set(task.id, task);
            results.push(task);
            context.sharedContext.lastResult = task.result;
          });
        } else {
          // 单任务串行
          const task = await executeWithRetry(groupTasks[0], t => executor(t, context), context);
          completed.set(task.id, task);
          results.push(task);
          context.sharedContext.lastResult = task.result;
        }
      }
    } else {
      // 纯串行
      for (const task of plan.tasks) {
        const executed = await executeWithRetry(task, t => executor(t, context), context);
        completed.set(executed.id, executed);
        results.push(executed);
        context.sharedContext.lastResult = executed.result;
      }
    }
  } catch (err) {
    // 计划级异常（非单任务失败）
    if (planSpan) endSpan(planSpan, 'failed', undefined, (err as Error).message);
    throw err;
  }

  // 存储执行摘要到长期记忆
  const summary = results.map(r => `${r.agentName}:${r.action}=${r.status}`).join(', ');
  remember({
    sessionId: context.sessionId, agentName: 'orchestrator',
    category: 'execution_summary',
    content: `用户"${context.userMessage.substring(0, 80)}" → 执行: ${summary}`,
    importance: 0.5,
  }).catch(() => { });

  // 结束 root span：状态根据子任务结果汇总
  const failCount = results.filter(r => r.status === 'failed').length;
  if (planSpan) {
    endSpan(planSpan, failCount === 0 ? 'success' : 'failed', {
      successCount: results.length - failCount,
      failCount,
      totalDurationMs: Date.now() - planStart,
    });
  }

  return results;
}

/**
 * 一体化编排入口：分析 + 执行
 * 供 AI 协作者、外部 SaaS API 等调用
 */
export async function runOrchestration(params: {
  userMessage: string;
  userId?: string;
  history?: any[];
  imageContext?: any;
  videoContext?: any;
}): Promise<{
  success: boolean;
  durationMs: number;
  output?: any;
  error?: string;
  traceId?: string;
}> {
  const { userMessage, userId, history, imageContext, videoContext } = params;
  const sessionId = `session_${userId || 'anonymous'}_${Date.now()}`;
  const startTs = Date.now();

  const context: OrchestrationContext = {
    sessionId,
    userMessage,
    history: history || [],
    imageContext,
    videoContext,
    sharedContext: {},
  };

  try {
    const plan = await analyzeParallelism(userMessage, context);

    const results = await executePlan(plan, context, async (task, ctx) => {
      // 默认执行器：仅做标记。实际场景由调用方注入或由 Agent 端点处理
      return { agentName: task.agentName, action: task.action, status: 'executed', params: task.params };
    });

    const successCount = results.filter(r => r.status === 'success').length;
    const failCount = results.filter(r => r.status === 'failed').length;
    const lastResult = results.find(r => r.status === 'success' && r.result);

    return {
      success: failCount === 0,
      durationMs: Date.now() - startTs,
      output: lastResult?.result || {
        summary: `${results.length}个任务: ${successCount}成功, ${failCount}失败`,
        results: results.map(r => ({
          agentName: r.agentName,
          action: r.action,
          status: r.status,
          error: r.error,
        })),
      },
    };
  } catch (error) {
    return {
      success: false,
      durationMs: Date.now() - startTs,
      error: (error as Error).message,
    };
  }
}
