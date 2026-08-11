/**
 * A2A (Agent-to-Agent) Protocol Service
 *
 * 基于 Google A2A v1.0 规范实现 Agent 间互操作协议。
 * 提供 Agent Card 发布、Task API 和 Agent 发现能力。
 *
 * 参考: https://a2a-mcp.org/ | https://github.com/google/A2A
 */

import { toolRegistry } from './toolRegistry.js';
import { v4 as uuidv4 } from 'uuid';

// ===== 类型定义 =====

/** A2A Task 状态 */
export type A2ATaskState = 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled';

/** A2A Task 消息角色 */
export type A2AMessageRole = 'user' | 'agent';

/** A2A Artifact 部件 */
export interface A2APart {
  type: 'text' | 'file' | 'data';
  text?: string;
  file?: { url: string; mimeType?: string; name?: string };
  data?: Record<string, any>;
}

/** A2A Message */
export interface A2AMessage {
  messageId: string;
  role: A2AMessageRole;
  parts: A2APart[];
  metadata?: Record<string, any>;
}

/** A2A Artifact */
export interface A2AArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, any>;
}

/** A2A Task */
export interface A2ATask {
  id: string;
  sessionId?: string;
  status: { state: A2ATaskState; message?: string; timestamp: string };
  history?: A2AMessage[];
  artifacts?: A2AArtifact[];
  metadata?: Record<string, any>;
}

/** Agent Card - 机器可读的 Agent 能力描述 */
export interface AgentCard {
  /** Agent 唯一标识 */
  name: string;
  /** 人类可读名称 */
  description: string;
  /** Agent Card 文档 URL */
  url: string;
  /** 服务提供者 */
  provider?: {
    organization: string;
    url?: string;
  };
  /** Agent 版本 */
  version: string;
  /** 文档 URL */
  documentationUrl?: string;
  /** 图标 URL */
  iconUrl?: string;
  /** Agent 能力 */
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  /** 默认输入/输出模式 */
  defaultInputModes: string[];
  defaultOutputModes: string[];
  /** Agent 技能列表 */
  skills: AgentSkill[];
  /** 支持的认证方案 */
  authentication?: {
    schemes: string[];
  };
  /** 协议版本 */
  protocolVersion: string;
}

/** Agent Skill */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

// ===== A2A 服务 =====

class A2AService {
  private tasks = new Map<string, A2ATask>();
  private taskCleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // 定期清理过期任务（1 小时后）
    this.taskCleanupInterval = setInterval(() => this.cleanupExpiredTasks(), 60000);
  }

  /** 生成 Agent Card */
  generateAgentCard(baseUrl: string): AgentCard {
    const tools = toolRegistry.list();
    const skills: AgentSkill[] = tools.map((tool) => ({
      id: tool.name,
      name: tool.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      description: tool.description,
      tags: [tool.category, 'ai-creative-studio', 'mcp'],
      examples: tool.name === 'generate_image'
        ? ['生成一张赛博朋克风格的城市夜景', '生成一张可爱的小猫头像']
        : tool.name === 'generate_video'
          ? ['生成一段10秒的日落延时视频', '生成一段产品展示视频']
          : undefined,
    }));

    return {
      name: 'AI创意工坊 (AI Creative Studio)',
      description: '基于多 Agent 协作的 AI 图片/视频创意生成平台。支持文生图、文生视频、智能抠图、OCR 识别、图片合成等全链路创意工作流。',
      url: `${baseUrl}/.well-known/agent-card.json`,
      provider: {
        organization: 'AI Creative Studio',
        url: baseUrl,
      },
      version: '2.0.0',
      documentationUrl: `${baseUrl}/docs`,
      iconUrl: `${baseUrl}/favicon.ico`,
      capabilities: {
        streaming: true,
        pushNotifications: true,
        stateTransitionHistory: true,
      },
      defaultInputModes: ['text', 'text/plain', 'image/png', 'image/jpeg'],
      defaultOutputModes: ['text', 'text/plain', 'image/png', 'video/mp4'],
      skills,
      authentication: {
        schemes: ['bearer'],
      },
      protocolVersion: '1.0',
    };
  }

  /** 创建 A2A Task */
  async createTask(params: {
    sessionId?: string;
    message: A2AMessage;
    acceptedOutputModes?: string[];
    metadata?: Record<string, any>;
  }): Promise<A2ATask> {
    const taskId = uuidv4();
    const task: A2ATask = {
      id: taskId,
      sessionId: params.sessionId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [params.message],
      metadata: {
        ...params.metadata,
        acceptedOutputModes: params.acceptedOutputModes,
        createdAt: new Date().toISOString(),
      },
    };

    this.tasks.set(taskId, task);

    // 异步处理任务
    this.processTask(taskId).catch((err) => {
      console.error(`[A2A] Task ${taskId} processing failed:`, err.message);
    });

    return task;
  }

  /** 获取 Task 状态 */
  getTask(taskId: string): A2ATask | undefined {
    return this.tasks.get(taskId);
  }

  /** 取消 Task */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (['completed', 'failed', 'canceled'].includes(task.status.state)) return false;

    task.status = { state: 'canceled', message: 'Task cancelled by user', timestamp: new Date().toISOString() };
    return true;
  }

  /** 列出所有 Task */
  listTasks(filter?: { sessionId?: string; state?: A2ATaskState }): A2ATask[] {
    let tasks = Array.from(this.tasks.values());
    if (filter?.sessionId) {
      tasks = tasks.filter((t) => t.sessionId === filter.sessionId);
    }
    if (filter?.state) {
      tasks = tasks.filter((t) => t.status.state === filter.state);
    }
    return tasks;
  }

  /** 更新 Task 状态 */
  updateTaskState(taskId: string, state: A2ATaskState, message?: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    task.status = { state, message, timestamp: new Date().toISOString() };
    return true;
  }

  /** 添加 Task Artifact */
  addArtifact(taskId: string, artifact: A2AArtifact): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (!task.artifacts) task.artifacts = [];
    task.artifacts.push(artifact);
    return true;
  }

  /** 添加 Task Message */
  addMessage(taskId: string, message: A2AMessage): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (!task.history) task.history = [];
    task.history.push(message);
    return true;
  }

  /** 异步处理 Task */
  private async processTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    this.updateTaskState(taskId, 'working', 'Agent is processing the request');

    try {
      // 解析用户消息中的意图
      const userMessage = task.history?.find((m) => m.role === 'user');
      const textPart = userMessage?.parts.find((p) => p.type === 'text');

      if (!textPart?.text) {
        this.updateTaskState(taskId, 'failed', 'No text input found in message');
        return;
      }

      // 模拟 Agent 处理（实际项目中会调用 Hermes Agent 进行意图识别和处理）
      const response: A2AArtifact = {
        artifactId: uuidv4(),
        name: 'AI Creative Studio Response',
        description: 'Generated by AI Creative Studio multi-agent pipeline',
        parts: [
          {
            type: 'text',
            text: `收到您的请求："${textPart.text.substring(0, 100)}${textPart.text.length > 100 ? '...' : ''}"。AI创意工坊正在使用多Agent协作处理您的创意任务。`,
          },
          {
            type: 'data',
            data: {
              agentChain: ['Hermes', 'Review', 'Orchestrator'],
              toolsAvailable: toolRegistry.list().map((t) => t.name),
              modelRouting: 'auto',
              timestamp: new Date().toISOString(),
            },
          },
        ],
        metadata: {
          agentId: 'ai-creative-studio',
          version: '2.0.0',
        },
      };

      this.addArtifact(taskId, response);

      // 添加 Agent 响应消息
      this.addMessage(taskId, {
        messageId: uuidv4(),
        role: 'agent',
        parts: response.parts,
        metadata: response.metadata,
      });

      this.updateTaskState(taskId, 'completed', 'Task completed successfully');
    } catch (err: any) {
      this.updateTaskState(taskId, 'failed', `Task failed: ${err.message}`);
    }
  }

  /** 清理过期任务 */
  private cleanupExpiredTasks(): void {
    const now = Date.now();
    const expireMs = 60 * 60 * 1000; // 1 小时

    for (const [taskId, task] of this.tasks) {
      const createdAt = task.metadata?.createdAt;
      if (createdAt && now - new Date(createdAt).getTime() > expireMs) {
        this.tasks.delete(taskId);
      }
    }

    // 清理已完成/失败/取消的任务（30 分钟后）
    for (const [taskId, task] of this.tasks) {
      if (['completed', 'failed', 'canceled'].includes(task.status.state)) {
        const completedAt = task.status.timestamp;
        if (completedAt && now - new Date(completedAt).getTime() > 30 * 60 * 1000) {
          this.tasks.delete(taskId);
        }
      }
    }
  }

  /** 获取 Task 统计 */
  getTaskStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const task of this.tasks.values()) {
      stats[task.status.state] = (stats[task.status.state] || 0) + 1;
    }
    stats.total = this.tasks.size;
    return stats;
  }

  /** 销毁服务 */
  destroy(): void {
    if (this.taskCleanupInterval) {
      clearInterval(this.taskCleanupInterval);
    }
    this.tasks.clear();
  }
}

// 单例导出
export const a2aService = new A2AService();