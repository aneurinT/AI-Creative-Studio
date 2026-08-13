/**
 * 多模态理解增强服务
 *
 * 能力：
 *  1. 视频理解：输入视频 URL/路径，抽帧后使用 GLM-4V 生成描述/分镜脚本
 *  2. 图生图增强：以原图为基础，结合视觉分析 + 用户指令，生成新风格/新内容的图片
 *
 * 依赖：
 *  - GLM-4V 视觉模型（智谱 API）
 *  - ffmpeg 抽帧
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { spawn } from 'child_process';
import { analyzeImageWithText, generateImage, type GenerateRequest, type ImageModel } from './imageService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRAMES_DIR = path.join(__dirname, '../data/video_frames');
const PROMPTS_DIR = path.join(__dirname, '../data/video_prompts');

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(FRAMES_DIR);
ensureDir(PROMPTS_DIR);

// ======================== 类型定义 ========================

export interface VideoUnderstandingRequest {
  /** 视频的可访问 URL 或本地路径 */
  videoUrl: string;
  /** 需要生成的理解深度，默认 'script' */
  mode?: 'description' | 'script' | 'shot-list' | 'emotion';
  /** 抽帧数量（默认 6 帧） */
  frameCount?: number;
  /** 用户可选的补充指令（例如 "重点突出人物表情"） */
  focus?: string;
}

export interface VideoUnderstandingResponse {
  success: boolean;
  description?: string;
  script?: string;
  shotList?: Array<{ shot: number; description: string; duration?: string }>;
  emotionCurve?: Array<{ time: string; emotion: string; intensity: number }>;
  framesExtracted?: number;
  error?: string;
}

export interface ImageToImageRequest {
  /** 原图 URL、本地路径或 base64 data URL */
  sourceImage: string;
  /** 用户的修改/风格指令，如 "变成水彩风格"、"把背景换成海边" */
  instruction: string;
  /** 可选：覆盖风格提示 */
  style?: string;
  /** 可选：覆盖模型 */
  model?: ImageModel;
  /** 可选：覆盖尺寸 */
  size?: string;
}

export interface ImageToImageResponse {
  success: boolean;
  imageUrl?: string;
  /** 视觉模型推断出的原图描述 */
  sourceDescription?: string;
  /** 最终送给文生图模型的 prompt */
  finalPrompt?: string;
  error?: string;
}

// ======================== 工具函数 ========================

/** 读取 API key（与 imageService 保持一致） */
function getZhipuApiKey(): string | undefined {
  return process.env.ZHIPU_API_KEY;
}

/** 下载远程资源到本地临时文件 */
async function downloadToLocal(url: string, localPath: string): Promise<void> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!resp.ok) throw new Error(`下载失败: HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(localPath, buf);
}

/** 解析输入：将 videoUrl 解析为本地 mp4 文件路径 */
async function resolveVideoToLocal(videoUrl: string): Promise<string> {
  if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
    ensureDir(FRAMES_DIR);
    const ext = path.extname(new URL(videoUrl).pathname) || '.mp4';
    const localPath = path.join(FRAMES_DIR, `video_${Date.now()}${ext}`);
    await downloadToLocal(videoUrl, localPath);
    return localPath;
  }

  if (videoUrl.startsWith('/images/') || videoUrl.startsWith('/uploads/') || videoUrl.startsWith('/videos/')) {
    return path.join(__dirname, '../public', videoUrl);
  }

  if (fs.existsSync(videoUrl)) return videoUrl;
  throw new Error(`视频文件不存在：${videoUrl}`);
}

/** 获取 ffmpeg 路径（与 video.ts 保持一致） */
function getFfmpegPath(): string {
  try {
    const platform = `${process.platform}-${process.arch}`;
    const pkgPath = path.join(__dirname, `../../node_modules/@ffmpeg-installer/${platform}`);
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const exePath = path.join(pkgPath, exeName);
    if (fs.existsSync(exePath)) return exePath;
  } catch {}
  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer.path && fs.existsSync(installer.path)) return installer.path;
  } catch {}
  try {
    const searchDir = path.join(__dirname, '../../node_modules/@ffmpeg-installer');
    if (fs.existsSync(searchDir)) {
      for (const d of fs.readdirSync(searchDir, { withFileTypes: true })) {
        if (d.isDirectory() && d.name.startsWith('win')) {
          const exe = path.join(searchDir, d.name, 'ffmpeg.exe');
          if (fs.existsSync(exe)) return exe;
        }
      }
    }
  } catch {}
  return 'ffmpeg';
}

/** 使用 ffprobe 获取视频时长（秒） */
function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobePath = getFfmpegPath().replace('ffmpeg', 'ffprobe');
    const proc = spawn(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', () => {});
    proc.on('close', (code) => {
      if (code === 0) resolve(parseFloat(out) || 0);
      else reject(new Error('ffprobe failed'));
    });
    proc.on('error', (e) => reject(e));
  });
}

/** 从视频抽 N 帧，返回帧图片路径数组 */
async function extractFrames(videoPath: string, frameCount: number): Promise<string[]> {
  const duration = await getVideoDuration(videoPath);
  if (duration <= 0) throw new Error('无法读取视频时长');

  const interval = duration / (frameCount + 1);
  const framePaths: string[] = [];
  const ffmpegPath = getFfmpegPath();

  ensureDir(FRAMES_DIR);
  const jobDir = path.join(FRAMES_DIR, `frames_${Date.now()}`);
  ensureDir(jobDir);

  for (let i = 0; i < frameCount; i++) {
    const time = interval * (i + 1);
    const framePath = path.join(jobDir, `frame_${String(i + 1).padStart(2, '0')}.jpg`);
    framePaths.push(framePath);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-ss', time.toFixed(2),
        '-i', videoPath,
        '-frames:v', '1',
        '-q:v', '2',
        '-y',
        framePath,
      ]);
      proc.on('close', (code) => {
        if (code === 0 || code === null) resolve();
        else reject(new Error(`ffmpeg 抽帧失败 exit=${code}`));
      });
      proc.on('error', reject);
    });
  }

  return framePaths.filter((p) => fs.existsSync(p));
}

/** 批量读取图片为 base64 */
function readFramesAsBase64(framePaths: string[]): { base64: string; mime: string }[] {
  return framePaths.map((p) => {
    const buf = fs.readFileSync(p);
    return { base64: buf.toString('base64'), mime: 'jpeg' };
  });
}

// ======================== 视频理解主流程 ========================

/** 调用 GLM-4V 批量理解帧，返回结构化分析 */
async function callVisionForVideo(
  frames: { base64: string; mime: string }[],
  mode: VideoUnderstandingRequest['mode'],
  focus?: string,
): Promise<any> {
  const apiKey = getZhipuApiKey();
  if (!apiKey) {
    throw new Error('未配置 ZHIPU_API_KEY，无法进行视频理解');
  }

  const frameContents = frames.map((f, idx) => ({
    type: 'image_url' as const,
    image_url: { url: `data:image/${f.mime};base64,${f.base64}` },
  }));

  const modeDesc: Record<string, string> = {
    description: '生成 100-200 字的视频内容概述',
    script: '生成完整的分镜脚本：包含场景、人物动作、镜头运动、对白提示',
    'shot-list': '生成分镜表：每个镜头的序号、画面描述、建议时长',
    emotion: '生成情感曲线：每个时间点的主要情绪和强度',
  };

  const focusHint = focus ? `\n\n重点关注：${focus}` : '';

  const systemPrompt = `你是视频理解专家（Video Understanding Agent），会综合多张关键帧图片分析视频内容。

## 任务
用户选择的理解模式：${mode}
目标：${modeDesc[mode || 'script']}${focusHint}

## 分析要点
1. 画面主体：人物/物体/场景
2. 动作与叙事：关键帧之间的动作连贯性
3. 视觉风格：色彩、光线、构图、运镜
4. 情绪与节奏：整体氛围与节奏感

## 输出格式（严格 JSON，不要其他文字）
{
  "description": "100-200字中文概述",
  "script": [
    { "scene": "场景1", "visual": "画面描述", "action": "人物动作", "camera": "运镜" }
  ],
  "shotList": [
    { "shot": 1, "description": "镜头描述", "duration": "3秒" }
  ],
  "emotionCurve": [
    { "time": "0-5s", "emotion": "紧张", "intensity": 0.8 }
  ],
  "styleTags": ["电影感", "写实", "暖色调"]
}`;

  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'glm-4v-flash',
      messages: [
        {
          role: 'user',
          content: [
            ...frameContents,
            { type: 'text', text: systemPrompt },
          ],
        },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`视觉理解 API 失败 (HTTP ${response.status}): ${text.substring(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('视觉理解返回空内容');

  // 解析 JSON
  try {
    const jsonStr = content.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
    return JSON.parse(jsonStr);
  } catch {
    return { description: content, script: [], shotList: [], emotionCurve: [], styleTags: [] };
  }
}

/**
 * 视频理解主入口
 */
export async function understandVideo(req: VideoUnderstandingRequest): Promise<VideoUnderstandingResponse> {
  const { videoUrl, mode = 'script', frameCount = 6, focus } = req;

  console.log(`[VideoUnderstanding] Start: url=${videoUrl}, mode=${mode}, frames=${frameCount}`);

  try {
    // 1. 解析视频到本地
    const localPath = await resolveVideoToLocal(videoUrl);
    console.log(`[VideoUnderstanding] Local path: ${localPath}`);

    // 2. 抽帧
    const frames = await extractFrames(localPath, frameCount);
    console.log(`[VideoUnderstanding] Extracted ${frames.length} frames`);

    if (frames.length === 0) {
      return { success: false, error: '未能从视频中提取任何关键帧' };
    }

    // 3. 读取帧为 base64
    const frameB64 = readFramesAsBase64(frames);

    // 4. 调用视觉模型
    const result = await callVisionForVideo(frameB64, mode, focus);

    const response: VideoUnderstandingResponse = {
      success: true,
      framesExtracted: frames.length,
      description: result.description,
      script: result.script ? JSON.stringify(result.script, null, 2) : undefined,
      shotList: result.shotList,
      emotionCurve: result.emotionCurve,
    };

    // 5. 同步保存一份原始结果到文件，便于后续 Agent 学习
    try {
      ensureDir(PROMPTS_DIR);
      fs.writeFileSync(
        path.join(PROMPTS_DIR, `video_${Date.now()}.json`),
        JSON.stringify({ input: req, result, timestamp: Date.now() }, null, 2),
        'utf-8',
      );
    } catch {}

    return response;
  } catch (error) {
    console.error('[VideoUnderstanding] Error:', error);
    return { success: false, error: (error as Error).message };
  }
}

// ======================== 图生图增强 ========================

/**
 * 图生图主入口：先让视觉模型理解原图，再结合用户指令重写 prompt，最后生成新图
 */
export async function imageToImage(req: ImageToImageRequest): Promise<ImageToImageResponse> {
  const { sourceImage, instruction, style = 'realistic', model = 'trae', size = 'landscape_16_9' } = req;

  console.log(`[ImageToImage] Start: source=${sourceImage?.substring(0, 60)}..., instruction=${instruction}`);

  try {
    // 1. 使用现有 analyzeImageWithText 得到原图描述 + 意图分析
    const analysis = await analyzeImageWithText({
      imageUrl: sourceImage,
      message: instruction,
    });

    if (!analysis.success) {
      return { success: false, error: analysis.error || '原图分析失败' };
    }

    const sourceDescription = analysis.description || '';
    const visionAction = analysis.action;

    // 2. 进一步让 LLM 基于视觉分析 + 用户指令生成更精确的 prompt
    const refined = await refinePromptFromVision(sourceDescription, instruction, style, analysis.params);

    if (!refined.success) {
      return {
        success: false,
        sourceDescription,
        error: refined.error,
      };
    }

    const finalPrompt = refined.refinedPrompt || analysis.params?.prompt || instruction;

    // 3. 调用文生图模型生成新图
    const generateRequest: GenerateRequest = {
      prompt: finalPrompt,
      style,
      model,
      size: size as any,
    };

    const generateResult = await generateImage(generateRequest);

    if (!generateResult.success || !generateResult.imageUrl) {
      return {
        success: false,
        sourceDescription,
        finalPrompt,
        error: generateResult.error || '图片生成失败',
      };
    }

    return {
      success: true,
      imageUrl: generateResult.imageUrl,
      sourceDescription,
      finalPrompt,
    };
  } catch (error) {
    console.error('[ImageToImage] Error:', error);
    return { success: false, error: (error as Error).message };
  }
}

/** 基于视觉分析结果和用户指令，生成更精确的文生图 prompt */
async function refinePromptFromVision(
  sourceDescription: string,
  instruction: string,
  style: string,
  params?: Record<string, any>,
): Promise<{ success: boolean; refinedPrompt?: string; error?: string }> {
  const apiKey = getZhipuApiKey() || process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return { success: false, error: '未配置 ZHIPU_API_KEY，跳过 prompt 精炼' };
  }

  const systemPrompt = `你是图像风格迁移与内容编辑专家（Image-to-Image Agent）。根据用户提供的原图描述和修改指令，生成一份全新的、可直接用于文生图模型的英文 prompt。

## 规则
1. **保留主体**：原图的核心主体（人物/物体/场景）必须保留
2. **执行修改**：按用户指令精确修改，避免额外发挥
3. **视觉强化**：加入具体的视觉描述（光线、色调、构图、镜头语言）
4. **风格切换**：若用户要求特定风格，使用该风格的典型术语
5. **英文输出**：最终 prompt 必须为英文，80-200 词

## 输出格式（严格 JSON）
{
  "refinedPrompt": "English prompt for text-to-image model",
  "styleApplied": "watercolor",
  "keyElementsChanged": ["background", "lighting"]
}`;

  const userPrompt = `## 原图描述
${sourceDescription}

## 用户修改指令
${instruction}

## 当前风格
${params?.style || style}

请生成新的、可直接用于文生图模型的英文 prompt。`;

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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 600,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { success: false, error: `LLM 精炼失败 (HTTP ${response.status}): ${text.substring(0, 200)}` };
    }

    const data = (await response.json()) as Record<string, any>;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return { success: false, error: 'LLM 返回空内容' };

    try {
      const jsonStr = content.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (parsed.refinedPrompt) {
        return { success: true, refinedPrompt: parsed.refinedPrompt };
      }
    } catch {
      // 非 JSON 回退
    }

    return { success: true, refinedPrompt: content };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
