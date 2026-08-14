/**
 * 本地 LLM 推理服务（基于 node-llama-cpp v3）
 *
 * 利用 GPU + CPU 卸载，在本地运行轻量级 GGUF 量化模型，
 * 作为云端 API 的降级/增强通道。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODELS_DIR = path.join(__dirname, '../data/gguf_models');
fs.mkdirSync(MODELS_DIR, { recursive: true });

// ======================== 类型 ========================

export interface LocalModelConfig {
  name: string;
  displayName: string;
  ggufFile: string;
  hfRepo: string;
  hfFile: string;
  contextLength: number;
  minVramGb: number;
  description: string;
}

export interface LocalInferenceResult {
  success: boolean;
  text?: string;
  tokensUsed?: number;
  durationMs?: number;
  modelName?: string;
  error?: string;
}

export interface LocalModelInfo {
  name: string;
  displayName: string;
  loaded: boolean;
  fileExists: boolean;
  fileSizeGb?: number;
  minVramGb: number;
  description: string;
}

// ======================== 模型注册表 ========================

const MODEL_REGISTRY: LocalModelConfig[] = [
  {
    name: 'qwen3-0.6b',
    displayName: 'Qwen3-0.6B-Q8_0 (本地推理)',
    ggufFile: 'qwen3-0.6b-q8_0.gguf',
    hfRepo: 'unsloth/Qwen3-0.6B-GGUF',
    hfFile: 'Qwen3-0.6B-Q8_0.gguf',
    contextLength: 32768,
    minVramGb: 1,
    description: '超轻量通用推理，中文优化，约610MB',
  },
  {
    name: 'qwen3-4b',
    displayName: 'Qwen3-4B (本地推理)',
    ggufFile: 'qwen3-4b-instruct-q4_k_m.gguf',
    hfRepo: 'lmstudio-community/Qwen3-4B-Instruct-GGUF',
    hfFile: 'qwen3-4b-instruct-q4_k_m.gguf',
    contextLength: 32768,
    minVramGb: 3,
    description: '通用推理/文案/Agent 编排，中文优化',
  },
];

// ======================== 实现 ========================

interface LoadedModel {
  model: any;
  context: any;
  config: LocalModelConfig;
  loadedAt: number;
  lastUsedAt: number;
}

class LocalLlmService {
  private llama: any = null;
  private loaded: Map<string, LoadedModel> = new Map();
  private loading = new Set<string>();
  private readonly MAX_IDLE_MS = 30 * 60 * 1000;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.loaded.forEach((entry, name) => {
        if (Date.now() - entry.lastUsedAt > this.MAX_IDLE_MS) {
          console.log(`[LocalLLM] Unloading idle model: ${name}`);
          this.unloadModel(name);
        }
      });
    }, 60 * 1000);
  }

  private async ensureLlama(): Promise<any> {
    if (this.llama) return this.llama;
    const { getLlama } = await import('node-llama-cpp');
    this.llama = await getLlama({
      maxThreads: Math.max(1, Math.floor(os.cpus().length / 2)),
    });
    return this.llama;
  }

  listModels(): LocalModelInfo[] {
    return MODEL_REGISTRY.map((cfg) => {
      const filePath = path.join(MODELS_DIR, cfg.ggufFile);
      const exists = fs.existsSync(filePath);
      let sizeGb: number | undefined;
      if (exists) {
        sizeGb = Math.round((fs.statSync(filePath).size / 1024 / 1024 / 1024) * 10) / 10;
      }
      return {
        name: cfg.name,
        displayName: cfg.displayName,
        loaded: this.loaded.has(cfg.name),
        fileExists: exists,
        fileSizeGb: sizeGb,
        minVramGb: cfg.minVramGb,
        description: cfg.description,
      };
    });
  }

  modelExists(name: string): boolean {
    const cfg = this.getConfig(name);
    if (!cfg) return false;
    return fs.existsSync(path.join(MODELS_DIR, cfg.ggufFile));
  }

  private getConfig(name: string): LocalModelConfig | undefined {
    return MODEL_REGISTRY.find((m) => m.name === name);
  }

  getModelPath(name: string): string {
    const cfg = this.getConfig(name);
    if (!cfg) throw new Error(`未知模型: ${name}`);
    return path.join(MODELS_DIR, cfg.ggufFile);
  }

  async loadModel(name: string): Promise<void> {
    const cfg = this.getConfig(name);
    if (!cfg) throw new Error(`未知模型: ${name}`);
    if (this.loaded.has(name)) return;

    const modelPath = this.getModelPath(name);
    if (!fs.existsSync(modelPath)) {
      throw new Error(`模型文件不存在: ${modelPath}\n请运行: npm run download-models`);
    }

    const startTime = Date.now();
    this.loading.add(name);

    try {
      const llama = await this.ensureLlama();
      const useCpu = process.env.LLM_USE_CPU === 'true';
      const vramGb = this.detectVramGb();
      const gpuLayers = useCpu ? 0 : (vramGb >= 4 ? 35 : vramGb >= 2 ? 20 : 0);

      console.log(`[LocalLLM] Loading ${name} (VRAM=${vramGb}GB, gpuLayers=${gpuLayers}, cpuOnly=${useCpu})...`);

      const model = await llama.loadModel({
        modelPath,
        gpuLayers,
        useMmap: true,
      });

      const context = await model.createContext({
        contextSize: Math.min(cfg.contextLength, 8192),
      });

      this.loaded.set(name, {
        model,
        context,
        config: cfg,
        loadedAt: Date.now(),
        lastUsedAt: Date.now(),
      });

      console.log(`[LocalLLM] ${name} loaded in ${Date.now() - startTime}ms`);
    } finally {
      this.loading.delete(name);
    }
  }

  unloadModel(name: string): void {
    const entry = this.loaded.get(name);
    if (!entry) return;
    try {
      entry.context.dispose();
      entry.model.dispose();
    } catch { }
    this.loaded.delete(name);
    console.log(`[LocalLLM] ${name} unloaded`);
  }

  unloadAll(): void {
    for (const name of this.loaded.keys()) {
      this.unloadModel(name);
    }
  }

  async generate(
    prompt: string,
    opts: {
      model?: string;
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    } = {},
  ): Promise<LocalInferenceResult> {
    const modelName = opts.model || 'qwen3-0.6b';
    const totalStart = Date.now();

    try {
      if (!this.loaded.has(modelName)) {
        if (!fs.existsSync(this.getModelPath(modelName))) {
          return {
            success: false,
            error: `模型文件不存在，请运行 npm run download-models 或放置 .gguf 文件到 ${MODELS_DIR}`,
            modelName,
          };
        }
        await this.loadModel(modelName);
      }

      const entry = this.loaded.get(modelName)!;
      entry.lastUsedAt = Date.now();

      const { LlamaChatSession } = await import('node-llama-cpp');

      const sequence = entry.context.getSequence();

      const session = new LlamaChatSession({
        contextSequence: sequence,
        systemPrompt: opts.systemPrompt,
        chatWrapper: 'auto',
      });

      if (opts.history && opts.history.length > 0) {
        const chatHistory = opts.history.map((msg) => {
          if (msg.role === 'user') {
            return { type: 'user' as const, text: msg.content };
          } else if (msg.role === 'assistant') {
            return { type: 'model' as const, response: [msg.content] };
          } else {
            return { type: 'system' as const, text: msg.content };
          }
        });
        session.setChatHistory(chatHistory);
      }

      const response = await session.prompt(prompt, {
        maxTokens: opts.maxTokens ?? 512,
        temperature: opts.temperature ?? 0.7,
      });

      session.dispose({ disposeSequence: true });

      return {
        success: true,
        text: response,
        durationMs: Date.now() - totalStart,
        modelName,
      };
    } catch (error) {
      console.error('[LocalLLM] Generate error:', error);
      return {
        success: false,
        error: (error as Error).message,
        durationMs: Date.now() - totalStart,
        modelName,
      };
    }
  }

  async healthCheck(): Promise<{
    available: boolean;
    models: LocalModelInfo[];
    gpuInfo?: string;
  }> {
    const models = this.listModels();
    return {
      available: models.some((m) => m.fileExists),
      models,
      gpuInfo: this.getGpuInfo(),
    };
  }

  private detectVramGb(): number {
    try {
      const output = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', { encoding: 'utf-8', timeout: 3000 });
      const gb = parseInt(output.trim());
      if (gb > 0) return gb;
    } catch { }
    return 4; // default: GTX 1650
  }

  private getGpuInfo(): string {
    try {
      const name = execSync('nvidia-smi --query-gpu=name --format=csv,noheader 2>nul', { encoding: 'utf-8' }).trim();
      const mem = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>nul', { encoding: 'utf-8' }).trim();
      return `${name} (${mem}MB)`;
    } catch {
      return 'GPU not detected';
    }
  }
}

export const localLlmService = new LocalLlmService();

process.on('exit', () => {
  localLlmService.unloadAll();
});
