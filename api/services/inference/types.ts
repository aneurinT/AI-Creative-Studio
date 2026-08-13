/**
 * 推理后端标准接口定义
 *
 * 将 LTX、SVD 等本地/远程视频推理服务抽象为可插拔后端。
 * 主服务通过 BackendRegistry 获取后端实例，调用统一接口，
 * 未来可无缝替换或新增推理后端（如 Stable Video Diffusion）。
 */

/** 任务提交参数（通用） */
export interface InferenceTaskParams {
  prompt: string;
  style?: string;
  duration?: string;
  model?: string;
  seed?: number;
  /** 图生视频条件参数 */
  conditioningMediaPaths?: string[];
  conditioningStrengths?: number[];
  conditioningStartFrames?: number[];
}

/** 任务状态详情 */
export interface InferenceTaskStatus {
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  videoUrl?: string; // 已下载到本地可访问的 URL
  error?: string;
  /** 后端原始状态（调试用） */
  rawStatus?: Record<string, any>;
}

/** 模型信息 */
export interface InferenceModelInfo {
  id: string;
  name: string;
  minVramGb?: number;
  description?: string;
  [k: string]: any;
}

/** 后端能力声明（消除主服务端的硬编码配置） */
export interface InferenceCapabilities {
  supportsImageToVideo: boolean;
  supportsNegativePrompt: boolean;
  maxDurationSec: number;
  supportedResolutions: Array<{ width: number; height: number }>;
  /** 时长到帧数的映射（后端特有，如 LTX 的 30fps 帧数表） */
  durationToFrames?: Record<string, { numFrames: number; width: number; height: number }>;
}

/** 推理后端标准接口 */
export interface InferenceBackend {
  readonly name: string;

  /** 健康检查（GPU 可用性、服务可达性） */
  healthCheck(): Promise<{ available: boolean; error?: string; details?: Record<string, any> }>;

  /** 获取可用模型列表（异步，从后端服务动态拉取） */
  getModels(): Promise<Record<string, InferenceModelInfo>>;

  /** 声明后端能力（分辨率/时长/帧数映射等） */
  getCapabilities(): InferenceCapabilities;

  /** 提交推理任务（异步，返回 taskId） */
  startTask(params: InferenceTaskParams): Promise<{
    success: boolean;
    taskId?: string;
    error?: string;
    message?: string;
  }>;

  /** 查询任务状态 */
  queryStatus(taskId: string): Promise<{
    success: boolean;
    status?: InferenceTaskStatus;
    error?: string;
  }>;

  /** 取消任务 */
  cancelTask(taskId: string): Promise<{ success: boolean; error?: string }>;
}
