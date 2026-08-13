/**
 * 推理后端注册表
 *
 * 管理所有已注册的 InferenceBackend 实例，支持按名称获取和默认后端切换。
 * 启动时由 index.ts 根据 *_ENABLED 环境变量注册启用的后端。
 *
 * 用法：
 *   inferenceRegistry.register(new LtxBackend(), true);  // 注册为默认
 *   const backend = inferenceRegistry.getDefault();      // 获取默认后端
 *   const ltx = inferenceRegistry.get('ltx');            // 按名称获取
 */
import type { InferenceBackend } from './types.js';

class BackendRegistry {
  private backends = new Map<string, InferenceBackend>();
  private defaultName: string | null = null;

  /** 注册后端，isDefault=true 设为默认 */
  register(backend: InferenceBackend, isDefault = false): void {
    this.backends.set(backend.name, backend);
    if (isDefault || this.defaultName === null) {
      this.defaultName = backend.name;
    }
    console.log(`[InferenceRegistry] 已注册后端: ${backend.name}${isDefault ? '（默认）' : ''}`);
  }

  /** 按名称获取后端，无 name 返回默认后端 */
  get(name?: string): InferenceBackend {
    if (name) {
      const backend = this.backends.get(name);
      if (!backend) {
        throw new Error(`推理后端未注册: ${name}，可用: ${this.list().join(', ')}`);
      }
      return backend;
    }
    return this.getDefault();
  }

  /** 获取默认后端 */
  getDefault(): InferenceBackend {
    if (!this.defaultName) {
      throw new Error('未注册任何推理后端，请检查 INFERENCE_DEFAULT_BACKEND 配置');
    }
    return this.backends.get(this.defaultName)!;
  }

  /** 列出所有已注册后端名称 */
  list(): string[] {
    return Array.from(this.backends.keys());
  }

  /** 设置默认后端 */
  setDefault(name: string): void {
    if (!this.backends.has(name)) {
      throw new Error(`后端未注册: ${name}`);
    }
    this.defaultName = name;
    console.log(`[InferenceRegistry] 默认后端已切换为: ${name}`);
  }

  /** 是否已注册任何后端 */
  hasAny(): boolean {
    return this.backends.size > 0;
  }
}

export const inferenceRegistry = new BackendRegistry();
