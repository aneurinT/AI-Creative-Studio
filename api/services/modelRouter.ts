/**
 * 智能模型路由器
 * 
 * 核心决策逻辑：
 * 1. 简单任务（关键词匹配/格式转换）→ 本地向量知识库（0 API 调用）
 * 2. 中等任务（意图识别/参数提取）→ 小模型（glm-4-flash，快速）
 * 3. 复杂任务（深度推理/创意生成/上下文融合）→ 大模型（DeepSeek-R1，深度）
 * 4. 视觉任务 → glm-4v-flash
 * 
 * 决策因素：任务复杂度、历史上下文长度、是否需要推理、API 余额
 */
import { semanticRAG } from './ragKnowledge.js';

// ===== 任务复杂度评分 =====

export type TaskComplexity = 'simple' | 'medium' | 'complex' | 'vision';
export type ModelTier = 'local' | 'small' | 'large' | 'vision';

export interface RoutingDecision {
  tier: ModelTier;
  model: string;
  reason: string;
  useLocalFirst: boolean;
  estimatedTokens: number;
}

/**
 * 分析用户消息，决定使用哪个模型层级
 */
export function analyzeTaskComplexity(
  message: string,
  historyLength: number,
  hasImages: boolean = false
): TaskComplexity {
  const lower = message.toLowerCase();
  const len = message.length;

  // 视觉任务
  if (hasImages) return 'vision';

  // 复杂任务特征
  const complexIndicators = [
    '分析', '对比', '评估', '总结', '融合', '结合',
    '多个', '同时', '之前', '刚才', '再', '还是',
    '修改', '更改', '换成', '改成', '优化',
    '策略', '方案', '规划', '建议',
  ];
  const complexCount = complexIndicators.filter(kw => lower.includes(kw)).length;

  // 上下文长度影响
  const isLongContext = historyLength > 5;

  // 简单任务特征
  const simpleIndicators = ['是什么', '价格', '多少', '哪里', '什么时候', '如何操作'];
  const isSimpleQuery = simpleIndicators.some(kw => lower.includes(kw));

  // 决策
  if (complexCount >= 3 || (complexCount >= 1 && isLongContext) || len > 200) {
    return 'complex';
  }
  if (isSimpleQuery && len < 50) {
    return 'simple';
  }
  return 'medium';
}

/**
 * 智能路由：根据任务复杂度选择模型
 */
export function routeModel(
  message: string,
  historyLength: number = 0,
  hasImages: boolean = false
): RoutingDecision {
  const complexity = analyzeTaskComplexity(message, historyLength, hasImages);

  switch (complexity) {
    case 'simple':
      return {
        tier: 'local',
        model: 'local-rag',
        reason: '简单查询，使用本地知识库',
        useLocalFirst: true,
        estimatedTokens: 50,
      };
    case 'medium':
      return {
        tier: 'small',
        model: process.env.LOCAL_LLM_ENABLED === 'true' ? 'local-qwen3-4b' : 'glm-4-flash',
        reason: '中等复杂度，使用本地/云端小模型',
        useLocalFirst: process.env.LOCAL_LLM_ENABLED === 'true',
        estimatedTokens: 200,
      };
    case 'complex':
      return {
        tier: 'large',
        model: process.env.LOCAL_LLM_ENABLED === 'true' ? 'local-qwen3-4b' : 'deepseek-v4-pro',
        reason: `复杂任务(${historyLength}轮上下文)，使用深度推理模型`,
        useLocalFirst: false,
        estimatedTokens: 1000,
      };
    case 'vision':
      return {
        tier: 'vision',
        model: 'glm-4v-flash',
        reason: '视觉理解任务',
        useLocalFirst: false,
        estimatedTokens: 500,
      };
  }
}

/**
 * 带缓存的智能路由：先用本地知识库快速匹配
 * 如果本地匹配置信度 > 0.8，直接返回本地结果
 */
export async function smartRoute(
  message: string,
  historyLength: number = 0,
  hasImages: boolean = false,
  precomputedRag?: any
): Promise<{ decision: RoutingDecision; localResult?: any }> {
  // 先尝试本地知识库
  try {
    const ragResult = precomputedRag || await semanticRAG(message);
    if (ragResult.source === 'llm' && ragResult.template) {
      // LLM 检索命中了高质量模板，可直接使用
      return {
        decision: {
          tier: 'local',
          model: 'local-rag',
          reason: `本地知识库命中(${ragResult.source}): ${ragResult.template.description}`,
          useLocalFirst: true,
          estimatedTokens: 50,
        },
        localResult: ragResult,
      };
    }
    if (ragResult.source === 'keyword' && ragResult.template) {
      // 关键词匹配，可以先用小模型确认
      return {
        decision: {
          tier: 'small',
          model: 'glm-4-flash',
          reason: `关键词匹配(${ragResult.template.description})，用小模型确认`,
          useLocalFirst: true,
          estimatedTokens: 100,
        },
        localResult: ragResult,
      };
    }
  } catch { /* RAG 失败不影响路由 */ }

  // 常规路由
  const decision = routeModel(message, historyLength, hasImages);
  return { decision };
}

/**
 * 模型调用策略：决定什么时候用大模型、什么时候用小模型
 * 
 * 策略表：
 * | 场景                      | 模型          | 原因                    |
 * |---------------------------|--------------|------------------------|
 * | 简单问答(是什么/价格)       | 本地RAG      | 零API调用，毫秒级        |
 * | 意图识别(单轮)              | glm-4-flash  | 快速响应，2秒内          |
 * | 意图识别(多轮上下文)        | deepseek-R1  | 需要深度理解上下文        |
 * | 故事创作                    | glm-4-flash  | 创意任务，快速迭代        |
 * | 参数提取                    | glm-4-flash  | 结构化输出，小模型即可     |
 * | 上下文融合(多任务合并)       | deepseek-R1  | 复杂推理，需要深度思考     |
 * | 审核                       | glm-4-flash  | 规则判断，小模型即可       |
 * | 视觉理解                    | glm-4v-flash | 多模态任务               |
 * | 深度分析(竞品/策略)         | deepseek-R1  | 需要Chain-of-Thought     |
 */
export const MODEL_STRATEGY: Record<string, { model: string; tier: ModelTier; reason: string }> = {
  // 快速响应场景 → 小模型
  'intent_single': { model: 'glm-4-flash', tier: 'small', reason: '单轮意图识别，小模型足够' },
  'param_extract': { model: 'glm-4-flash', tier: 'small', reason: '结构化参数提取，小模型高效' },
  'review': { model: 'glm-4-flash', tier: 'small', reason: '规则审核，小模型即可' },
  'story_write': { model: 'glm-4-flash', tier: 'small', reason: '创意脚本，小模型快速迭代' },
  'simple_qa': { model: 'local-rag', tier: 'local', reason: '简单问答，本地知识库直接回答' },
  'image_analyze': { model: 'glm-4-flash', tier: 'small', reason: '图像参数提取，小模型高效' },
  'video_analyze': { model: 'glm-4-flash', tier: 'small', reason: '视频参数分析，小模型高效' },

  // 深度思考场景 → 大模型
  'intent_complex': { model: 'deepseek-v4-pro', tier: 'large', reason: '多轮上下文意图识别，需要深度推理' },
  'context_fusion': { model: 'deepseek-v4-pro', tier: 'large', reason: '多任务上下文融合，需要深度思考' },
  'competitor_analysis': { model: 'deepseek-v4-pro', tier: 'large', reason: '竞品分析，需要多维推理' },
  'orchestration': { model: 'deepseek-v4-pro', tier: 'large', reason: '任务编排，需要复杂决策' },
  'compose_plan': { model: 'deepseek-v4-pro', tier: 'large', reason: '复合任务规划，需要深度推理' },
  'long_video': { model: 'deepseek-v4-pro', tier: 'large', reason: '长视频分镜，需要深度创意' },
};

// ===== 调度 Agent (Supervisor)：统一决策入口 =====

export interface SupervisorDecision {
  model: string;
  tier: ModelTier;
  reason: string;
  useReasoning: boolean;
  maxTokens: number;
  tryRagFirst: boolean;
  scenario: string;
}

/**
 * 调度 Agent 主函数：根据场景决定用哪个模型
 * 
 * 决策维度：Agent类型、用户意图、复杂度、历史上下文、是否多模态
 * 
 * 策略：
 * - 简单参数提取/审核 → 小模型（快、省）
 * - 创意生成/复杂推理/多任务融合 → 大模型（深度思考）
 * - 多模态 → 视觉模型
 * - 简单问答 → 本地知识库
 */
export function supervisorRoute(params: {
  agentName?: string;
  intent?: string;
  messageLength?: number;
  historyLength?: number;
  hasImages?: boolean;
  isLongVideo?: boolean;
  isCompose?: boolean;
}): SupervisorDecision {
  const {
    agentName, intent,
    messageLength = 0, historyLength = 0,
    hasImages = false, isLongVideo = false, isCompose = false,
  } = params;

  // 视觉任务 → 视觉模型
  if (hasImages) {
    return { model: 'glm-4v-flash', tier: 'vision', reason: '包含图片，需要视觉理解', useReasoning: false, maxTokens: 500, tryRagFirst: false, scenario: 'vision' };
  }

  // 复合任务 → 大模型规划
  if (isCompose) {
    return { model: 'deepseek-v4-pro', tier: 'large', reason: '复合任务需要深度规划', useReasoning: true, maxTokens: 2000, tryRagFirst: false, scenario: 'compose_plan' };
  }

  // 长视频 → 大模型创意
  if (isLongVideo) {
    return { model: 'deepseek-v4-pro', tier: 'large', reason: '长视频需要深度分镜创意', useReasoning: true, maxTokens: 3000, tryRagFirst: false, scenario: 'long_video' };
  }

  // 多轮上下文 → 大模型
  if (historyLength > 5 && (messageLength > 200 || intent === 'compose')) {
    return { model: 'deepseek-v4-pro', tier: 'large', reason: '多轮上下文融合需要深度推理', useReasoning: true, maxTokens: 2000, tryRagFirst: false, scenario: 'context_fusion' };
  }

  // 按 Agent 类型决策
  if (agentName) {
    if (agentName === 'storyWriter') {
      if (messageLength > 300 || intent === 'video') {
        return { model: 'deepseek-v4-pro', tier: 'large', reason: '复杂脚本需要深度创意', useReasoning: true, maxTokens: 3000, tryRagFirst: false, scenario: 'story_write_complex' };
      }
      return { model: 'glm-4-flash', tier: 'small', reason: '创意脚本，小模型快速迭代', useReasoning: false, maxTokens: 1500, tryRagFirst: false, scenario: 'story_write' };
    }
    if (agentName === 'videoMaker') {
      return { model: 'glm-4-flash', tier: 'small', reason: '视频参数分析，小模型高效', useReasoning: false, maxTokens: 1000, tryRagFirst: false, scenario: 'video_analyze' };
    }
    if (agentName === 'imageCreator') {
      return { model: 'glm-4-flash', tier: 'small', reason: '图像参数提取，小模型高效', useReasoning: false, maxTokens: 800, tryRagFirst: false, scenario: 'image_analyze' };
    }
  }

  // 简单消息 → RAG 本地
  if (messageLength < 50 && historyLength < 3) {
    return { model: 'local-rag', tier: 'local', reason: '简单消息，优先本地知识库', useReasoning: false, maxTokens: 200, tryRagFirst: true, scenario: 'simple_qa' };
  }

  // 默认：小模型
  return { model: 'glm-4-flash', tier: 'small', reason: '默认小模型高效响应', useReasoning: false, maxTokens: 1000, tryRagFirst: false, scenario: 'param_extract' };
}
