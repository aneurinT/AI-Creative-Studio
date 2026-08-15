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
  /** 并发加载锁：同一模型的并发请求共享同一个加载 Promise */
  private loadingPromises = new Map<string, Promise<void>>();
  /** 推理串行队列：node-llama-cpp 序列槽位有限，并发 getSequence 会竞争导致 "No sequences left" */
  private inferenceChain: Promise<void> = Promise.resolve();
  private activeInferences = 0;
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

    // 加载锁：若已有并发加载在跑，直接等待同一个 Promise
    const existing = this.loadingPromises.get(name);
    if (existing) {
      await existing;
      return;
    }

    // 发起本次加载，并登记到 Map 供后续并发请求复用
    const promise = this._doLoadModel(name);
    this.loadingPromises.set(name, promise);
    try {
      await promise;
    } finally {
      this.loadingPromises.delete(name);
    }
  }

  private async _doLoadModel(name: string): Promise<void> {
    const cfg = this.getConfig(name);
    if (!cfg) throw new Error(`未知模型: ${name}`);
    // 二次检查，避免排队期间已被其他请求加载
    if (this.loaded.has(name)) return;

    const modelPath = this.getModelPath(name);
    if (!fs.existsSync(modelPath)) {
      throw new Error(`模型文件不存在: ${modelPath}\n请运行: npm run download-models`);
    }

    const startTime = Date.now();

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
      contextSize: Math.min(cfg.contextLength, 4096),
    });

    this.loaded.set(name, {
      model,
      context,
      config: cfg,
      loadedAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    console.log(`[LocalLLM] ${name} loaded in ${Date.now() - startTime}ms`);
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
      // 加载阶段：可并发（不争抢 CPU 推理），加载锁会去重
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

      // 推理阶段：串行排队，避免序列竞争（node-llama-cpp 序列槽位有限）
      return await this.runInferenceSerial(() => this._runInference(modelName, prompt, opts, totalStart));
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

  /**
   * 串行推理调度器：node-llama-cpp 的 context 序列槽位有限，
   * 并发 getSequence 会抛 "No sequences left"，且序列耗尽时的 unloadModel
   * 会 dispose 正在推理的模型导致 DisposedError。
   * 串行队列保证同一时刻只有一个推理在跑，避免序列竞争。
   */
  private runInferenceSerial<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.activeInferences++;
      try {
        return await task();
      } finally {
        this.activeInferences--;
      }
    };

    // 链式挂载：无论前一个成功失败都继续执行下一个
    const next = this.inferenceChain.then(run, run);
    // 保持链永不 reject，避免后续任务被连带中断
    this.inferenceChain = next.then(() => undefined, () => undefined);

    return next;
  }

  private async _runInference(
    modelName: string,
    prompt: string,
    opts: {
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    },
    totalStart: number,
  ): Promise<LocalInferenceResult> {
    const entry = this.loaded.get(modelName);
    if (!entry) {
      return { success: false, error: `模型未加载: ${modelName}`, modelName };
    }
    entry.lastUsedAt = Date.now();

    const { LlamaChatSession } = await import('node-llama-cpp');

    // 获取序列，如果序列耗尽则完全重新加载模型
    let sequence: any;
    let session: any = null;

    try {
      sequence = entry.context.getSequence();
    } catch {
      // 序列耗尽，完全重新加载模型（最可靠的恢复方式）
      console.log('[LocalLLM] 序列耗尽，重新加载模型...');
      this.unloadModel(modelName);
      await this.loadModel(modelName);
      sequence = this.loaded.get(modelName)!.context.getSequence();
    }

    try {
      session = new LlamaChatSession({
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

      return {
        success: true,
        text: response,
        durationMs: Date.now() - totalStart,
        modelName,
      };
    } finally {
      // 确保序列总是被释放
      try {
        if (session) session.dispose({ disposeSequence: true });
        else if (sequence) sequence.dispose();
      } catch { /* 忽略释放错误 */ }
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
