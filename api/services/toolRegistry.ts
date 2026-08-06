/**
 * 标准化 Tool Calling 注册中心
 *
 * 替代硬编码 switch-case 的 agent action 路由。
 * 每个 tool 有 name / description / parameters schema / handler，
 * agent 可以动态发现和组合调用工具。
 *
 * 同时提供 MCP 协议兼容层：将 tools 暴露为 MCP Server 格式。
 */
import type { Request, Response } from 'express';

// ===== Tool 定义 =====

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: any;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'image' | 'video' | 'edit' | 'ocr' | 'knowledge' | 'system';
  parameters: ToolParameter[];
  /** 执行工具 */
  handler: (params: Record<string, any>, context: ToolContext) => Promise<ToolResult>;
  /** 是否需要异步等待结果 */
  async?: boolean;
  /** 预计耗时（秒），用于前端进度展示 */
  estimatedDuration?: number;
}

export interface ToolContext {
  sessionId: string;
  userId?: string;
  agentName?: string;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  /** 操作摘要，用于 agent 上下文传递 */
  summary?: string;
}

// ===== 注册中心 =====

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    console.log(`[ToolRegistry] 注册工具: ${tool.name} (${tool.category})`);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  listByCategory(category: string): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(t => t.category === category);
  }

  /** 生成 LLM Function Calling 格式 */
  toLLMFunctions(): Array<{ type: 'function'; function: { name: string; description: string; parameters: object } }> {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(tool.parameters.map(p => [p.name, { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}) }])),
          required: tool.parameters.filter(p => p.required).map(p => p.name),
        },
      },
    }));
  }

  /** 生成 MCP 协议 tools/list 响应 */
  toMCPTools(): any[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(tool.parameters.map(p => [p.name, { type: p.type, description: p.description, ...(p.enum ? { enum: p.enum } : {}) }])),
        required: tool.parameters.filter(p => p.required).map(p => p.name),
      },
    }));
  }

  /** 执行工具 */
  async execute(name: string, params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { success: false, error: `未知工具: ${name}` };

    try {
      console.log(`[Tool] ${tool.name} 开始执行 | params=${JSON.stringify(params).substring(0, 100)}`);
      const result = await tool.handler(params, context);
      console.log(`[Tool] ${tool.name} ${result.success ? '✅' : '❌'} | ${result.summary || ''}`);
      return result;
    } catch (err) {
      console.error(`[Tool] ${tool.name} 异常:`, (err as Error).message);
      return { success: false, error: (err as Error).message };
    }
  }
}

// 全局单例
export const toolRegistry = new ToolRegistry();

// ===== 内置工具注册 =====

// --- 图片生成工具 ---
toolRegistry.register({
  name: 'generate_image',
  description: '根据文本描述生成图片。支持多种风格：写实、动漫、电影感、3D、插画。',
  category: 'image',
  parameters: [
    { name: 'prompt', type: 'string', description: '图片描述（英文更佳）', required: true },
    { name: 'style', type: 'string', description: '视觉风格', enum: ['realistic', 'anime', 'cinematic', '3d', 'illustration'] },
    { name: 'size', type: 'string', description: '图片尺寸', default: '1024x1024' },
  ],
  handler: async (params, ctx) => {
    // 委托给现有的图片生成服务
    const { generateImage } = await import('./imageService.js');
    const result = await generateImage({ prompt: params.prompt, style: params.style || 'realistic', size: params.size || '1024x1024' });
    return { success: result.success, data: result, summary: `图片生成: ${params.style || 'realistic'}风格, ${params.prompt?.substring(0, 30)}...` };
  },
  async: true,
  estimatedDuration: 30,
});

// --- 视频生成工具 ---
toolRegistry.register({
  name: 'generate_video',
  description: '根据文本描述生成视频。支持写实、动漫、电影感等风格，可指定时长。',
  category: 'video',
  parameters: [
    { name: 'prompt', type: 'string', description: '视频描述', required: true },
    { name: 'style', type: 'string', description: '视觉风格', enum: ['realistic', 'anime', 'cinematic', '3d'] },
    { name: 'duration', type: 'string', description: '视频时长（秒）', default: '10' },
  ],
  handler: async (params, ctx) => {
    // 委托给视频生成路由
    const token = process.env.AUTH_TOKEN || '';
    const resp = await fetch('http://localhost:3001/api/video/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ prompt: params.prompt, style: params.style || 'realistic', duration: params.duration || '10' }),
    });
    const data = await resp.json() as any;
    return { success: data.success, data, summary: `视频生成: ${params.style || 'realistic'}风格, ${params.duration || 10}秒` };
  },
  async: true,
  estimatedDuration: 120,
});

// --- 抠图工具 ---
toolRegistry.register({
  name: 'remove_background',
  description: '移除图片背景，保留主体。适用于产品图、人像等。',
  category: 'image',
  parameters: [
    { name: 'imageUrl', type: 'string', description: '图片URL或base64数据', required: true },
  ],
  handler: async (params, ctx) => {
    const { removeBackground } = await import('./imageService.js');
    const result = await removeBackground(params.imageUrl);
    return { success: result.success, data: result, summary: '背景移除完成' };
  },
  async: true,
  estimatedDuration: 15,
});

// --- OCR 识别工具 ---
toolRegistry.register({
  name: 'ocr_recognize',
  description: '识别图片中的文字，支持返回文本/表格/JSON格式。',
  category: 'ocr',
  parameters: [
    { name: 'imageUrl', type: 'string', description: '图片URL或base64数据', required: true },
    { name: 'format', type: 'string', description: '输出格式', enum: ['text', 'json', 'table'], default: 'text' },
  ],
  handler: async (params, ctx) => {
    const { recognizeText } = await import('./ocrService.js');
    const result = await recognizeText({ imageUrl: params.imageUrl, format: params.format || 'text' });
    return { success: result.success, data: result, summary: `OCR: ${result.text?.length || 0}字符` };
  },
  async: true,
  estimatedDuration: 10,
});

// --- 修改图片工具 ---
toolRegistry.register({
  name: 'modify_image',
  description: '修改已生成的图片，如更改背景、人物、风格等。',
  category: 'edit',
  parameters: [
    { name: 'description', type: 'string', description: '修改描述', required: true },
    { name: 'modifyType', type: 'string', description: '修改类型', enum: ['background', 'character', 'style', 'general'] },
    { name: 'currentPrompt', type: 'string', description: '当前图片的原始prompt' },
  ],
  handler: async (params, ctx) => {
    const { modifyImage } = await import('./imageService.js');
    const result = await modifyImage(params);
    return { success: result.success, data: result, summary: `图片修改: ${params.modifyType || 'general'}` };
  },
  async: true,
  estimatedDuration: 20,
});

// --- 知识检索工具 ---
toolRegistry.register({
  name: 'search_knowledge',
  description: '从知识库中检索相关信息，支持向量+关键词混合检索。',
  category: 'knowledge',
  parameters: [
    { name: 'query', type: 'string', description: '搜索查询', required: true },
    { name: 'topK', type: 'number', description: '返回结果数', default: 5 },
  ],
  handler: async (params, ctx) => {
    const { hybridSearch } = await import('./vectorStore.js');
    const results = await hybridSearch(params.query, params.topK || 5);
    return { success: true, data: results, summary: `知识检索: 找到 ${results.length} 条相关结果` };
  },
  estimatedDuration: 2,
});

// --- 记忆存储工具 ---
toolRegistry.register({
  name: 'remember_context',
  description: '将重要信息存入长期记忆，供后续对话使用。',
  category: 'system',
  parameters: [
    { name: 'content', type: 'string', description: '要记住的内容', required: true },
    { name: 'category', type: 'string', description: '分类标签', default: 'general' },
    { name: 'importance', type: 'number', description: '重要性 0-1', default: 0.5 },
  ],
  handler: async (params, ctx) => {
    const { remember } = await import('./agentMemory.js');
    await remember({ sessionId: ctx.sessionId, agentName: ctx.agentName || 'system', category: params.category || 'general', content: params.content, importance: params.importance || 0.5 });
    return { success: true, summary: `长期记忆已存储: ${params.category}` };
  },
  estimatedDuration: 1,
});

// --- 记忆召回工具 ---
toolRegistry.register({
  name: 'recall_memory',
  description: '从长期记忆中召回相关信息，支持向量相似度检索。',
  category: 'system',
  parameters: [
    { name: 'query', type: 'string', description: '搜索查询', required: true },
    { name: 'limit', type: 'number', description: '返回结果数', default: 5 },
  ],
  handler: async (params, ctx) => {
    const { recall } = await import('./agentMemory.js');
    const results = await recall({ agentName: ctx.agentName, query: params.query, limit: params.limit || 5 });
    return { success: true, data: results, summary: `记忆召回: 找到 ${results.length} 条相关记忆` };
  },
  estimatedDuration: 1,
});

// ===== MCP 协议路由 =====

/** 注册 MCP 协议端点到 Express Router */
export function registerMCPRoutes(router: any): void {
  // MCP tools/list
  router.get('/mcp/tools', (req: Request, res: Response) => {
    res.json({ jsonrpc: '2.0', result: { tools: toolRegistry.toMCPTools() } });
  });

  // MCP tools/call
  router.post('/mcp/tools/call', async (req: Request, res: Response) => {
    const { name, arguments: args } = req.body;
    if (!name) { res.status(400).json({ jsonrpc: '2.0', error: { code: -32602, message: 'Missing tool name' } }); return; }

    const result = await toolRegistry.execute(name, args || {}, {
      sessionId: (req as any).sessionId || 'mcp',
      userId: (req as any).user?.id,
      agentName: 'mcp-client',
    });

    if (result.success) {
      res.json({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: JSON.stringify(result.data) }], summary: result.summary } });
    } else {
      res.json({ jsonrpc: '2.0', error: { code: -32000, message: result.error } });
    }
  });

  // LLM Function Calling 格式
  router.get('/tools/functions', (req: Request, res: Response) => {
    res.json({ success: true, tools: toolRegistry.toLLMFunctions() });
  });

  // 简单工具列表
  router.get('/tools', (req: Request, res: Response) => {
    res.json({ success: true, tools: toolRegistry.list().map(t => ({ name: t.name, description: t.description, category: t.category, parameters: t.parameters, estimatedDuration: t.estimatedDuration })) });
  });

  console.log('[ToolRegistry] MCP 协议端点已注册: /api/mcp/tools, /api/mcp/tools/call');
}
