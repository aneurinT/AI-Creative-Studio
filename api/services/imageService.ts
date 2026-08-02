import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { addPendingTask, removePendingTask } from './videoTaskService.js';
import { checkQuota, recordUsage } from './quotaService.js';

export type ImageModel = 'trae' | 'wanx' | 'cogview' | 'volcengine';

export type ImageSize = '1024*1024' | '1024*1792' | '1792*1024' | 'landscape_16_9';

export type VideoDuration = '5' | '10' | '15' | '18' | '30' | '36' | '45' | '60' | '75' | '90';

export interface VideoGenerateRequest {
  prompt: string;
  style?: string;
  duration?: VideoDuration;
}

export interface ModifyVideoRequest {
  originalVideoUrl?: string;
  originalPrompt: string;
  modifyInstruction: string;
  style?: string;
  duration?: VideoDuration;
}

export interface VideoGenerateResponse {
  success: boolean;
  videoUrl?: string;
  error?: string;
}

export interface VideoTaskStatusResponse {
  success: boolean;
  status?: string;
  progress?: number;
  videoUrl?: string;
  error?: string;
}

export interface GenerateRequest {
  prompt: string;
  style?: string;
  model?: ImageModel;
  size?: ImageSize;
}

export interface ModifyImageRequest {
  originalImageUrl?: string;
  originalPrompt: string;
  modifyInstruction: string;
  style?: string;
  model?: ImageModel;
  size?: ImageSize;
}

export interface GenerateResponse {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

export interface CaptionRequest {
  prompt: string;
  style?: string;
}

export interface CaptionResponse {
  success: boolean;
  caption?: string;
  error?: string;
}

export interface ImageAnalysisRequest {
  imagePath: string;
}

export interface ImageAnalysisResponse {
  success: boolean;
  description?: string;
  error?: string;
}

export interface RemoveBgRequest {
  imageUrl: string;
}

export interface RemoveBgResponse {
  success: boolean;
  imageUrl?: string;
  error?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const imagesDir = path.join(__dirname, '../public/images');
const configPath = path.join(__dirname, '../config.json');

/** 安全解析 API 响应为 JSON，失败时返回原始文本用于调试 */
async function safeParseJson(response: any): Promise<{ data: Record<string, any>; rawText: string }> {
  const rawText = await response.text().catch(() => '');
  try {
    return { data: rawText ? JSON.parse(rawText) : {}, rawText };
  } catch {
    return { data: { _rawResponse: rawText.substring(0, 300) }, rawText };
  }
}

interface ModelConfig {
  apiKey: string;
  modelId?: string;
}

interface Config {
  models: {
    wanx?: ModelConfig;
    cogview?: ModelConfig;
    volcengine?: ModelConfig;
  };
}

function loadConfig(): Config {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  return { models: {} };
}

function getApiKey(model: string): string | undefined {
  const config = loadConfig();
  // 图片模型
  if (model === 'wanx') {
    return config.models.wanx?.apiKey || process.env.DASHSCOPE_API_KEY;
  }
  if (model === 'cogview') {
    return config.models.cogview?.apiKey || process.env.ZHIPU_API_KEY;
  }
  if (model === 'volcengine') {
    return config.models.volcengine?.apiKey || process.env.VOLCENGINE_API_KEY;
  }
  // 视频模型
  if (model === 'cogvideox' || model === 'cogvideox-flash') {
    return config.models?.['cogvideox-flash']?.apiKey || process.env.ZHIPU_API_KEY;
  }
  if (model === 'wanx-video') {
    return config.models?.['wanx-video']?.apiKey || process.env.DASHSCOPE_API_KEY;
  }
  if (model === 'seedance') {
    return config.models?.seedance?.apiKey || process.env.SEEDANCE_API_KEY;
  }
  if (model === 'agnes') {
    return config.models?.agnes?.apiKey || process.env.AGNES_VIDEO_API_KEY;
  }
  // LLM 模型
  if (model === 'deepseek') {
    return config.models?.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY;
  }
  if (model === 'zhipu') {
    return config.models?.['cogvideox-flash']?.apiKey || process.env.ZHIPU_API_KEY;
  }
  return undefined;
}

function getModelId(model: string): string | undefined {
  const config = loadConfig();
  if (model === 'volcengine') {
    return config.models.volcengine?.modelId || process.env.VOLCENGINE_MODEL_ID;
  }
  return undefined;
}

function ensureImagesDir(): void {
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }
}

// 异步版本：保存图片到 public/images
async function saveImageBufferAsync(buffer: Buffer): Promise<string> {
  await fs.promises.mkdir(imagesDir, { recursive: true });
  const imageId = Date.now().toString();
  const imageFileName = `${imageId}.png`;
  const imagePath = path.join(imagesDir, imageFileName);
  await fs.promises.writeFile(imagePath, buffer);
  return `/images/${imageFileName}`;
}

function saveImageBuffer(buffer: Buffer): string {
  ensureImagesDir();
  const imageId = Date.now().toString();
  const imageFileName = `${imageId}.png`;
  const imagePath = path.join(imagesDir, imageFileName);
  fs.writeFileSync(imagePath, buffer);
  return `/images/${imageFileName}`;
}

// 异步版本：保存视频到 public/images
async function saveVideoBufferAsync(buffer: Buffer): Promise<string> {
  await fs.promises.mkdir(imagesDir, { recursive: true });
  const videoId = Date.now().toString();
  const videoFileName = `${videoId}.mp4`;
  const videoPath = path.join(imagesDir, videoFileName);
  await fs.promises.writeFile(videoPath, buffer);
  return `/images/${videoFileName}`;
}

function saveVideoBuffer(buffer: Buffer): string {
  ensureImagesDir();
  const videoId = Date.now().toString();
  const videoFileName = `${videoId}.mp4`;
  const videoPath = path.join(imagesDir, videoFileName);
  fs.writeFileSync(videoPath, buffer);
  return `/images/${videoFileName}`;
}

async function downloadImage(url: string): Promise<Buffer> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) {
      throw new Error(`Download image failed: ${response.status}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } finally {
    clearTimeout(timeoutId)
  }
}

async function generateWithTrae(request: GenerateRequest): Promise<GenerateResponse> {
  const { prompt, style = 'realistic', size = 'landscape_16_9' } = request;
  const fullPrompt = `${prompt}, ${style}`;
  const encodedPrompt = encodeURIComponent(fullPrompt);
  const apiUrl = `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodedPrompt}&image_size=${size}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(apiUrl, { signal: controller.signal, redirect: 'follow' } as any);

    // 先读取 body
    let responseBody = '';
    try {
      responseBody = await response.text();
    } catch {
      return { success: false, error: `API 响应读取失败 (HTTP ${response.status})` };
    }

    if (!response.ok) {
      return { success: false, error: responseBody.substring(0, 300) || `HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      let apiMessage = responseBody.substring(0, 300);
      try {
        const json = JSON.parse(responseBody);
        apiMessage = json.error || json.message || json.detail || apiMessage;
      } catch {}
      return { success: false, error: apiMessage || 'API 内容审核拦截，请修改提示词后重试' };
    }

    const imageBuffer = Buffer.from(responseBody, 'binary');
    if (imageBuffer.length < 1000) {
      return { success: false, error: 'API 返回异常，可能被内容审核拦截' };
    }
    const imageUrl = saveImageBuffer(imageBuffer);
    return { success: true, imageUrl };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return { success: false, error: '请求超时' };
    }
    const msg = (error as Error).message || String(error);
    return { success: false, error: msg.substring(0, 200) };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateWithWanx(request: GenerateRequest): Promise<GenerateResponse> {
  const { prompt, style = '', size = '1024*1024' } = request;
  const apiKey = getApiKey('wanx');
  const baseUrl = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1';

  console.log(`[Wanx] API Key configured: ${!!apiKey}`);
  console.log(`[Wanx] Base URL: ${baseUrl}`);

  if (!apiKey) {
    return { success: false, error: '通义万相 API Key 未配置，请在 .env 文件中设置 DASHSCOPE_API_KEY' };
  }

  const fullPrompt = style ? `${prompt}，${style}` : prompt;
  const sizeParam = size === 'landscape_16_9' ? '1024*1024' : size;

  console.log(`[Wanx] Creating task: prompt="${fullPrompt}", size="${sizeParam}"`);

  try {
    const createResponse = await fetch(
      `${baseUrl}/services/aigc/text2image/image-synthesis`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model: 'wanx2.1-t2i-turbo',
          input: { prompt: fullPrompt },
          parameters: { size: sizeParam, n: 1 },
        }),
      },
    );

    console.log(`[Wanx] Create response status: ${createResponse.status}`);

    if (!createResponse.ok) {
      const { data: errorData, rawText } = await safeParseJson(createResponse);
      console.error(`[Wanx] Create failed: HTTP ${createResponse.status} - ${JSON.stringify(errorData)}`);
      return { success: false, error: errorData.message || `通义万相创建任务失败: ${createResponse.status}` };
    }

    const taskData = await createResponse.json() as Record<string, any>;
    console.log(`[Wanx] Task response: ${JSON.stringify(taskData)}`);

    const taskId = taskData.output?.task_id;

    if (!taskId) {
      return { success: false, error: '通义万相未返回任务ID' };
    }

    console.log(`[Wanx] Task ID: ${taskId}, polling for result...`);

    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const statusResponse = await fetch(`${baseUrl}/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      const statusData = await statusResponse.json() as Record<string, any>;
      console.log(`[Wanx] Poll ${i + 1}: full response=${JSON.stringify(statusData)}`);

      const taskStatus = statusData.status || statusData.output?.task_status;

      if (taskStatus === 'SUCCEEDED' || taskStatus === 'SUCCESS') {
        const imageUrl = statusData.output?.results?.[0]?.url;
        if (!imageUrl) {
          return { success: false, error: '通义万相未返回图片URL' };
        }
        const imageBuffer = await downloadImage(imageUrl);
        const savedUrl = saveImageBuffer(imageBuffer);
        return { success: true, imageUrl: savedUrl };
      }

      if (taskStatus === 'FAILED' || taskStatus === 'FAILURE') {
        return { success: false, error: statusData.message || statusData.output?.message || '通义万相生成失败' };
      }
    }

    return { success: false, error: '通义万相生成超时' };
  } catch (error) {
    console.error(`[Wanx] Exception: ${error}`);
    return { success: false, error: `通义万相调用异常: ${(error as Error).message}` };
  }
}

async function generateWithCogView(request: GenerateRequest): Promise<GenerateResponse> {
  const { prompt, style = '', size = '1024x1024' } = request;
  const apiKey = getApiKey('cogview');

  if (!apiKey) {
    return { success: false, error: '智谱 API Key 未配置，请在 .env 文件中设置 ZHIPU_API_KEY' };
  }

  const fullPrompt = style ? `${prompt}，${style}` : prompt;
  const sizeParam = size === 'landscape_16_9' ? '1024x1024' : size.replace('*', 'x');

  try {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'cogview-4-250304',
        prompt: fullPrompt,
        size: sizeParam,
      }),
    });

    if (!response.ok) {
      const { data: errorData } = await safeParseJson(response);
      return { success: false, error: errorData.error?.message || `智谱API请求失败: ${response.status}` };
    }

    const data = await response.json() as Record<string, any>;
    const imageUrl = data.data?.[0]?.url;

    if (!imageUrl) {
      return { success: false, error: '智谱API未返回图片' };
    }

    const imageBuffer = await downloadImage(imageUrl);
    const savedUrl = saveImageBuffer(imageBuffer);

    return { success: true, imageUrl: savedUrl };
  } catch (error) {
    return { success: false, error: `智谱API调用异常: ${(error as Error).message}` };
  }
}

async function generateWithVolcengine(request: GenerateRequest): Promise<GenerateResponse> {
  const { prompt, style = '', size = '1024*1024' } = request;
  const apiKey = getApiKey('volcengine');
  const modelId = getModelId('volcengine');

  console.log(`[Volcengine] API Key configured: ${!!apiKey}`);
  console.log(`[Volcengine] Model ID configured: ${modelId || '未配置'}`);

  if (!apiKey) {
    return { success: false, error: '火山方舟 API Key 未配置，请在 .env 文件中设置 VOLCENGINE_API_KEY' };
  }

  if (!modelId) {
    return { success: false, error: '火山方舟 Model ID 未配置，请在 .env 文件中设置 VOLCENGINE_MODEL_ID' };
  }

  const fullPrompt = style ? `${prompt}，${style}` : prompt;
  const sizeParam = size === 'landscape_16_9' ? '1024*1024' : size;

  console.log(`[Volcengine] Creating task: prompt="${fullPrompt}", size="${sizeParam}", model="${modelId}"`);

  const volcSizeParam = sizeParam.replace('*', 'x');

  try {
    const createResponse = await fetch(
      'https://ark.cn-beijing.volces.com/api/v3/images/generations',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          prompt: fullPrompt,
          size: volcSizeParam,
        }),
      },
    );

    console.log(`[Volcengine] Create response status: ${createResponse.status}`);

    if (!createResponse.ok) {
      const { data: errorData } = await safeParseJson(createResponse);
      console.error(`[Volcengine] Create failed: HTTP ${createResponse.status} - ${JSON.stringify(errorData)}`);
      return { success: false, error: errorData.message || errorData.error?.message || `火山方舟创建任务失败: ${createResponse.status}` };
    }

    const taskData = await createResponse.json() as Record<string, any>;
    console.log(`[Volcengine] Task response: ${JSON.stringify(taskData)}`);

    const imageUrl = taskData.data?.[0]?.url;

    if (!imageUrl) {
      return { success: false, error: '火山方舟未返回图片URL' };
    }

    const imageBuffer = await downloadImage(imageUrl);
    const savedUrl = saveImageBuffer(imageBuffer);

    console.log(`[Volcengine] Success: ${savedUrl}`);

    return { success: true, imageUrl: savedUrl };
  } catch (error) {
    console.error(`[Volcengine] Exception: ${error}`);
    return { success: false, error: `火山方舟调用异常: ${(error as Error).message}` };
  }
}

export async function generateImage(request: GenerateRequest): Promise<GenerateResponse> {
  const { model = 'trae' } = request;

  // 模型名 → 配额 key 映射
  const modelQuotaMap: Record<string, string> = {
    trae: 'trae',
    wanx: 'wanx-image',
    cogview: 'cogview-4',
    volcengine: 'volcengine-seedream',
  }

  // 优先级列表：用户选定的模型 → 自动降级（已移除万相）
  const fallbackOrder: ImageModel[] = model === 'trae'
    ? ['trae', 'cogview', 'volcengine']
    : model === 'wanx'
      ? ['cogview', 'volcengine', 'trae']
      : model === 'cogview'
        ? ['cogview', 'volcengine', 'trae']
        : ['volcengine', 'cogview', 'trae'];

  // 配额检查：过滤掉额度用完的模型
  const availableModels = fallbackOrder.filter(tryModel => {
    const quotaKey = modelQuotaMap[tryModel]
    if (!quotaKey) return true
    const { allowed } = checkQuota(quotaKey)
    if (!allowed) {
      console.log(`[ImageGen] ${tryModel} 配额不足，从降级链中排除`)
    }
    return allowed
  })

  if (availableModels.length === 0) {
    return { success: false, error: '所有图片生成引擎的免费额度均已用完，请联系管理员或明天再试。' }
  }

  const MAX_RETRIES = 2;
  let lastError = '';

  for (const tryModel of availableModels) {
    const isFallback = tryModel !== model;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await (tryModel === 'trae'
          ? generateWithTrae(request)
          : tryModel === 'wanx'
            ? generateWithWanx(request)
            : tryModel === 'cogview'
              ? generateWithCogView(request)
              : generateWithVolcengine(request));

        if (result.success && result.imageUrl) {
          // 记录成功调用
          const quotaKey = modelQuotaMap[tryModel]
          if (quotaKey) recordUsage(quotaKey)

          if (isFallback) {
            return {
              ...result,
              error: `⚠️ ${model === 'trae' ? 'Trae' : model === 'wanx' ? '万相' : model === 'cogview' ? '智谱CogView' : '火山方舟'} 不可用，已自动切换到 ${tryModel === 'trae' ? 'Trae' : tryModel === 'wanx' ? '万相' : tryModel === 'cogview' ? '智谱CogView' : '火山方舟'}`,
            }
          }
          return result
        }

        lastError = result.error || '未知错误'
        console.log(`[ImageGen] ${tryModel} attempt ${attempt + 1} failed: ${lastError}`)

        if (isFallback) break
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 3000))
        }
      } catch (error) {
        lastError = (error as Error).message
        console.log(`[ImageGen] ${tryModel} attempt ${attempt + 1} exception: ${lastError}`)
        if (isFallback || attempt >= MAX_RETRIES - 1) break
        await new Promise(r => setTimeout(r, 3000))
      }
    }
  }

  return { success: false, error: `所有图片生成引擎均失败，最后错误: ${lastError}` }
}

export async function modifyImage(request: ModifyImageRequest): Promise<GenerateResponse> {
  const { originalPrompt, modifyInstruction, style = 'realistic', model = 'trae', size = 'landscape_16_9' } = request;

  console.log(`[ModifyImage] Original: ${originalPrompt.substring(0, 50)}...`);
  console.log(`[ModifyImage] Modify: ${modifyInstruction}`);

  const systemPrompt = '你是一位专业的图片修改助手。根据用户的原始描述和修改需求，生成新的图片描述。要求：1. 保留原始描述的核心内容；2. 根据修改需求调整相应的部分；3. 生成的描述要完整、详细、自然；4. 只返回新的图片描述，不要加引号或其他修饰。';
  const userPrompt = `原始图片描述：${originalPrompt}\n修改需求：${modifyInstruction}\n请生成新的图片描述。`;

  let newPrompt = '';
  const apiKey = getApiKey('zhipu') || process.env.ZHIPU_API_KEY;

  if (apiKey) {
    try {
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'glm-4-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      });

      if (response.ok) {
        const data = await response.json() as Record<string, any>;
        newPrompt = data.choices?.[0]?.message?.content?.trim() || '';
      }
    } catch (error) {
      console.error('[ModifyImage] LLM call failed:', error);
    }
  }

  if (!newPrompt) {
    newPrompt = `${originalPrompt}，${modifyInstruction}`;
  }

  console.log(`[ModifyImage] New prompt: ${newPrompt.substring(0, 50)}...`);

  return await generateImage({
    prompt: newPrompt,
    style,
    model,
    size,
  });
}

export async function analyzeImage(request: ImageAnalysisRequest): Promise<ImageAnalysisResponse> {
  const { imagePath } = request;
  const realPath = resolveImagePath(imagePath);

  console.log(`[ImageAnalysis] Analyzing image: ${imagePath} -> ${realPath}`);

  const apiKey = getApiKey('zhipu') || process.env.ZHIPU_API_KEY;

  if (!apiKey) {
    console.log('[ImageAnalysis] No API key configured, using mock analysis');
    return { success: true, description: generateMockImageDescription(imagePath) };
  }

  // 使用 GLM-4V (视觉模型) 真实分析图片内容
  const imageBase64 = readImageAsBase64(realPath);
  if (!imageBase64) {
    console.warn('[ImageAnalysis] Cannot read image file, using mock');
    return { success: true, description: generateMockImageDescription(imagePath) };
  }

  try {
    const ext = path.extname(realPath).replace('.', '').toLowerCase();
    const mimeMap: Record<string, string> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif' };
    const mime = mimeMap[ext] || 'jpeg';

    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'glm-4v-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/${mime};base64,${imageBase64}` } },
              {
                type: 'text',
                text: '请详细描述这张图片的内容，包括：1. 画面主体是什么；2. 背景环境；3. 色彩和光线；4. 整体氛围风格。限制在80-150字之间，只返回描述文字。',
              },
            ],
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const { data: errorData } = await safeParseJson(response);
      console.error(`[ImageAnalysis] API failed: HTTP ${response.status} - ${JSON.stringify(errorData)}`);
      return { success: true, description: generateMockImageDescription(imagePath) };
    }

    const data = await response.json() as Record<string, any>;
    const description = data.choices?.[0]?.message?.content?.trim();

    if (!description) {
      return { success: true, description: generateMockImageDescription(imagePath) };
    }

    console.log(`[ImageAnalysis] Vision result: ${description.substring(0, 80)}...`);
    return { success: true, description };
  } catch (error) {
    console.error(`[ImageAnalysis] Exception: ${error}`);
    return { success: true, description: generateMockImageDescription(imagePath) };
  }
}

/**
 * 图片+文字混合分析：用视觉模型同时理解图片和用户意图
 */
export async function analyzeImageWithText(request: {
  imageUrl: string;
  message: string;
}): Promise<{ success: boolean; description?: string; action?: string; params?: Record<string, any>; error?: string }> {
  const { imageUrl, message } = request;
  // 图片存储在不同位置，需要解析
  let realPath = '';
  if (imageUrl.startsWith('/images/')) {
    realPath = path.join(__dirname, '../public/images', imageUrl.replace(/^\/images\//, ''));
  } else if (imageUrl.startsWith('/uploads/')) {
    realPath = path.join(__dirname, '../public/uploads', imageUrl.replace(/^\/uploads\//, ''));
  } else {
    realPath = path.join(__dirname, '../public', imageUrl.replace(/^\//, ''));
  }

  const apiKey = getApiKey('zhipu') || process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return { success: false, error: '未配置视觉分析API密钥' };
  }

  const imageBase64 = readImageAsBase64(realPath);
  if (!imageBase64) {
    return { success: false, error: '无法读取图片文件' };
  }

  try {
    const ext = path.extname(realPath).replace('.', '').toLowerCase();
    const mimeMap: Record<string, string> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif' };
    const mime = mimeMap[ext] || 'jpeg';

    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'glm-4v-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/${mime};base64,${imageBase64}` } },
              {
                type: 'text',
                text: `用户上传了一张图片并发送了以下指令："${message}"。请结合图片内容理解用户的创作需求，返回JSON格式（只返回JSON，不要其他文字）：
{
  "description": "图片的视觉描述(50-100字)",
  "intent": "用户的创作意图推断",
  "action": "image/video/modify-image/modify-video/general",
  "prompt": "最终用于生成的详细提示词(中文,100-200字)",
  "style": "realistic/cinematic/anime/3d/illustration",
  "analysis": "综合分析"
}`,
              },
            ],
          },
        ],
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      return { success: false, error: `Vision API failed (${response.status})` };
    }

    const data = await response.json() as Record<string, any>;
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return { success: false, error: 'Vision API 返回空内容' };
    }

    // 解析 JSON
    let parsed: Record<string, any>;
    try {
      const jsonStr = content.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      // 纯文本回退
      return { success: true, description: content };
    }

    return {
      success: true,
      description: parsed.description || content,
      action: parsed.action,
      params: {
        prompt: parsed.prompt || message,
        style: parsed.style || 'realistic',
      },
    };
  } catch (error) {
    console.error(`[analyzeImageWithText] Error:`, error);
    return { success: false, error: (error as Error).message };
  }
}

/** 读取图片为 base64 */
function readImageAsBase64(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const buffer = fs.readFileSync(filePath);
    return buffer.toString('base64');
  } catch {
    return null;
  }
}

/** 解析图片路径为实际文件路径 */
function resolveImagePath(imagePath: string): string {
  if (imagePath.startsWith('/images/')) {
    return path.join(__dirname, '../public/images', imagePath.replace(/^\/images\//, ''));
  }
  if (imagePath.startsWith('/uploads/')) {
    return path.join(__dirname, '../public/uploads', imagePath.replace(/^\/uploads\//, ''));
  }
  if (imagePath.startsWith(__dirname)) {
    return imagePath;
  }
  return path.join(__dirname, '../public', imagePath.replace(/^\//, ''));
}

function generateMockImageDescription(imagePath: string): string {
  const descriptions = [
    '一幅美丽的风景照片，展现了大自然的壮丽与宁静。画面中有青山绿水，蓝天白云，阳光洒落在湖面上，波光粼粼，远处有几艘小船在水面上轻轻摇曳，营造出一种祥和美好的氛围。',
    '一张精美的人物肖像照片，人物表情生动自然，眼神中透露出自信与智慧。背景简洁，突出了人物的主体地位，光线柔和，色彩温暖，整体画面给人一种专业而亲切的感觉。',
    '一幅创意十足的艺术插画，运用了丰富的色彩和独特的构图手法。画面中充满了想象力，各种元素交织在一起，形成了一个奇幻的世界，展现了创作者的独特视角和艺术才华。',
    '一张美食摄影作品，展示了一道精致的菜肴。食物色彩鲜艳，摆盘精美，香气仿佛扑面而来。光线恰到好处地照亮了食物的细节，让人食欲大增，感受到美食带来的愉悦。',
    '一幅城市夜景照片，灯火辉煌，繁华热闹。高楼大厦林立，霓虹灯闪烁，车流穿梭不息，展现了都市的活力与魅力。夜色中的城市别有一番韵味，让人感受到现代文明的脉搏。',
  ];
  const index = Math.floor(Math.random() * descriptions.length);
  return descriptions[index];
}

export async function generateCaption(request: CaptionRequest): Promise<CaptionResponse> {
  const { prompt, style = '' } = request;
  const apiKey = getApiKey('zhipu') || process.env.ZHIPU_API_KEY;

  if (!apiKey) {
    return { success: false, error: '智谱 API Key 未配置' };
  }

  const styleHint = style ? `，风格为${style}` : '';
  const systemPrompt = '你是一位富有创意的文案大师。根据用户提供的图片描述，生成一段优美的配图文案。要求：1. 文案必须与图片内容强关联；2. 文案富有诗意和画面感；3. 长度在30-80字之间；4. 只返回文案内容，不要加引号或其他修饰。';
  const userPrompt = `请为以下图片描述生成一段配图文案：${prompt}${styleHint}`;

  try {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const { data: errorData } = await safeParseJson(response);
      return { success: false, error: errorData.error?.message || `智谱API请求失败: ${response.status}` };
    }

    const data = await response.json() as Record<string, any>;
    const caption = data.choices?.[0]?.message?.content?.trim();

    if (!caption) {
      return { success: false, error: '智谱API未返回文案' };
    }

    return { success: true, caption };
  } catch (error) {
    return { success: false, error: `文案生成异常: ${(error as Error).message}` };
  }
}

export async function removeBg(request: RemoveBgRequest): Promise<RemoveBgResponse> {
  const { imageUrl } = request;

  console.log(`[RemoveBg] Request: imageUrl=${imageUrl}`);

  const apiKey = process.env.REMOVE_BG_API_KEY;

  if (apiKey) {
    return await removeBgWithRemoveBg(imageUrl, apiKey);
  } else {
    return await removeBgWithEraseBg(imageUrl);
  }
}

async function removeBgWithRemoveBg(imageUrl: string, apiKey: string): Promise<RemoveBgResponse> {
  try {
    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        image_url: imageUrl,
        size: 'auto',
      }),
    });

    console.log(`[RemoveBg] remove.bg Response status: ${response.status}`);

    if (!response.ok) {
      const { data: errorData } = await safeParseJson(response);
      console.error(`[RemoveBg] remove.bg Failed: HTTP ${response.status} - ${JSON.stringify(errorData)}`);
      return { success: false, error: errorData.errors?.[0]?.title || `remove.bg请求失败: ${response.status}` };
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return { success: false, error: 'remove.bg返回非图片响应' };
    }

    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    const savedUrl = saveImageBuffer(imageBuffer);

    console.log(`[RemoveBg] remove.bg Success: ${savedUrl}`);

    return { success: true, imageUrl: savedUrl };
  } catch (error) {
    console.error(`[RemoveBg] remove.bg Exception: ${error}`);
    return { success: false, error: `remove.bg调用异常: ${(error as Error).message}` };
  }
}

async function removeBgWithEraseBg(imageUrl: string): Promise<RemoveBgResponse> {
  try {
    const response = await fetch('https://api.erase.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: imageUrl,
        size: 'auto',
      }),
    });

    console.log(`[RemoveBg] erase.bg Response status: ${response.status}`);

    if (!response.ok) {
      const { data: errorData } = await safeParseJson(response);
      console.error(`[RemoveBg] erase.bg Failed: HTTP ${response.status} - ${JSON.stringify(errorData)}`);
      const errorMessage = errorData.errors?.[0]?.title || errorData.message || `erase.bg请求失败: ${response.status}`;
      return { success: false, error: errorMessage };
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      return { success: false, error: 'erase.bg返回非图片响应' };
    }

    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    const savedUrl = saveImageBuffer(imageBuffer);

    console.log(`[RemoveBg] erase.bg Success: ${savedUrl}`);

    return { success: true, imageUrl: savedUrl };
  } catch (error) {
    console.error(`[RemoveBg] erase.bg Exception: ${error}`);
    return { success: false, error: `免费抠图服务调用异常: ${(error as Error).message}` };
  }
}

const DURATION_TO_FRAMES: Record<string, { num_frames: number; frame_rate: number; resolution: string }> = {
  '5': { num_frames: 121, frame_rate: 24, resolution: '1080p' },
  '10': { num_frames: 241, frame_rate: 24, resolution: '1080p' },
  '15': { num_frames: 361, frame_rate: 24, resolution: '720p' },
  '18': { num_frames: 441, frame_rate: 24, resolution: '720p' },
  '30': { num_frames: 721, frame_rate: 24, resolution: '480p' },
  '36': { num_frames: 865, frame_rate: 24, resolution: '480p' },
  '45': { num_frames: 1081, frame_rate: 24, resolution: '480p' },
  '60': { num_frames: 1441, frame_rate: 24, resolution: '480p' },
  '75': { num_frames: 1801, frame_rate: 24, resolution: '480p' },
  '90': { num_frames: 2161, frame_rate: 24, resolution: '480p' },
};

export async function generateVideo(request: VideoGenerateRequest): Promise<VideoGenerateResponse> {
  const { prompt, style = '', duration = '10' } = request;
  const apiKey = getApiKey('agnes') || process.env.AGNES_VIDEO_API_KEY;

  console.log(`[Agnes Video] API Key configured: ${!!apiKey}`);

  if (!apiKey) {
    return { success: false, error: 'Agnes Video API Key 未配置，请在 .env 文件中设置 AGNES_VIDEO_API_KEY' };
  }

  const fullPrompt = style ? `${prompt}，${style}` : prompt;
  const frameConfig = DURATION_TO_FRAMES[duration] || DURATION_TO_FRAMES['10'];

  console.log(`[Agnes Video] Creating video: prompt="${fullPrompt}", duration="${duration}s", num_frames=${frameConfig.num_frames}, frame_rate=${frameConfig.frame_rate}`);

  const MAX_CREATE_RETRIES = 3;
  const RETRY_DELAY_MS = 10000;

  let taskData: any;
  let videoId: string | undefined;

  try {
    for (let attempt = 0; attempt <= MAX_CREATE_RETRIES; attempt++) {
      const createResponse = await fetch(
        'https://apihub.agnes-ai.com/v1/videos',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'agnes-video-v2.0',
            prompt: fullPrompt,
            num_frames: frameConfig.num_frames,
            frame_rate: frameConfig.frame_rate,
            resolution: frameConfig.resolution,
          }),
        },
      );

      console.log(`[Agnes Video] Create response status: ${createResponse.status} (attempt ${attempt + 1}/${MAX_CREATE_RETRIES + 1})`);

      if (createResponse.ok) {
        taskData = await createResponse.json() as Record<string, any>;
        console.log(`[Agnes Video] Task response: ${JSON.stringify(taskData)}`);
        videoId = taskData.video_id || taskData.data?.video_id || taskData.task_id;
        break;
      }

      const { data: errorData } = await safeParseJson(createResponse);
      const errorMessage = errorData.message || errorData.error?.message || `Agnes Video创建任务失败: ${createResponse.status}`;
      console.error(`[Agnes Video] Create failed: HTTP ${createResponse.status} - ${JSON.stringify(errorData)}`);

      const isQueueFull = createResponse.status === 429 ||
        errorMessage.toLowerCase().includes('queue') ||
        errorMessage.toLowerCase().includes('retry later');

      if (isQueueFull && attempt < MAX_CREATE_RETRIES) {
        console.log(`[Agnes Video] Queue full, retrying in ${RETRY_DELAY_MS / 1000}s... (${attempt + 1}/${MAX_CREATE_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }

      return { success: false, error: errorMessage };
    }

    if (!videoId) {
      return { success: false, error: 'Agnes Video未返回任务ID' };
    }

    addPendingTask({
      taskId: videoId,
      prompt,
      style: style || '',
      duration: duration || '10',
    });

    console.log(`[Agnes Video] Video ID: ${videoId}, polling for result...`);

    let pollInterval = 5000;

    for (let i = 0; i < 120; i++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const statusResponse = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${videoId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      const statusData = await statusResponse.json() as Record<string, any>;
      console.log(`[Agnes Video] Poll ${i + 1}: status=${statusData.status}, progress=${statusData.progress || 0}%`);

      if (statusData.error) {
        if (statusData.error.code === 429) {
          console.warn('[Agnes Video] Rate limit exceeded, increasing poll interval');
          pollInterval = Math.min(pollInterval * 2, 30000);
          continue;
        }
        return { success: false, error: statusData.error.message || 'Agnes Video生成失败' };
      }

      const taskStatus = statusData.status;

      if (taskStatus === 'completed' || taskStatus === 'SUCCEEDED' || taskStatus === 'SUCCESS') {
        const videoUrl = statusData.url || statusData.metadata?.url || statusData.video_url || statusData.data?.video_url || statusData.output?.video_url;
        if (!videoUrl) {
          console.error(`[Agnes Video] Video URL not found in response: ${JSON.stringify(statusData)}`);
          removePendingTask(videoId);
          return { success: false, error: 'Agnes Video未返回视频URL' };
        }
        const videoBuffer = await downloadImage(videoUrl);
        const savedUrl = saveVideoBuffer(videoBuffer);
        removePendingTask(videoId);
        return { success: true, videoUrl: savedUrl };
      }

      if (taskStatus === 'failed' || taskStatus === 'FAILED' || taskStatus === 'FAILURE') {
        removePendingTask(videoId);
        return { success: false, error: statusData.message || statusData.output?.message || 'Agnes Video生成失败' };
      }
    }

    removePendingTask(videoId);
    return { success: false, error: 'Agnes Video生成超时' };
  } catch (error) {
    console.error(`[Agnes Video] Exception: ${error}`);
    return { success: false, error: `Agnes Video调用异常: ${(error as Error).message}` };
  }
}

export async function modifyVideo(request: ModifyVideoRequest): Promise<VideoGenerateResponse> {
  const { originalPrompt, modifyInstruction, style = '', duration = '10' } = request;

  console.log(`[ModifyVideo] Original: ${originalPrompt.substring(0, 50)}...`);
  console.log(`[ModifyVideo] Modify: ${modifyInstruction}`);

  const systemPrompt = '你是一位专业的视频修改助手。根据用户的原始视频描述和修改需求，生成新的视频描述。要求：1. 保留原始描述的核心内容和场景；2. 根据修改需求调整相应的部分；3. 生成的描述要完整、详细、自然，适合视频生成；4. 只返回新的视频描述，不要加引号或其他修饰。';
  const userPrompt = `原始视频描述：${originalPrompt}\n修改需求：${modifyInstruction}\n请生成新的视频描述。`;

  let newPrompt = '';
  const apiKey = getApiKey('zhipu') || process.env.ZHIPU_API_KEY;

  if (apiKey) {
    try {
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'glm-4-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      });

      if (response.ok) {
        const data = await response.json() as Record<string, any>;
        newPrompt = data.choices?.[0]?.message?.content?.trim() || '';
      }
    } catch (error) {
      console.error('[ModifyVideo] LLM call failed:', error);
    }
  }

  if (!newPrompt) {
    newPrompt = `${originalPrompt}，${modifyInstruction}`;
  }

  console.log(`[ModifyVideo] New prompt: ${newPrompt.substring(0, 50)}...`);

  return await generateVideo({
    prompt: newPrompt,
    style,
    duration,
  });
}

export async function checkVideoTaskStatus(taskId: string, apiKey: string): Promise<VideoTaskStatusResponse> {
  console.log(`[Agnes Video] Checking task status: ${taskId}`);

  try {
    const statusResponse = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    const statusData = await statusResponse.json() as Record<string, any>;
    console.log(`[Agnes Video] Task status check: ${JSON.stringify(statusData)}`);

    const taskStatus = statusData.status;

    if (statusData.error) {
      return {
        success: false,
        status: taskStatus,
        error: statusData.error.message || '查询任务状态失败',
      };
    }

    if (taskStatus === 'completed' || taskStatus === 'SUCCEEDED' || taskStatus === 'SUCCESS') {
      const videoUrl = statusData.url || statusData.metadata?.url || statusData.video_url || statusData.data?.video_url || statusData.output?.video_url;
      if (!videoUrl) {
        return { success: false, status: taskStatus, error: '任务已完成但未返回视频URL' };
      }
      const videoBuffer = await downloadImage(videoUrl);
      const savedUrl = saveVideoBuffer(videoBuffer);
      return { success: true, status: taskStatus, videoUrl: savedUrl };
    }

    if (taskStatus === 'failed' || taskStatus === 'FAILED' || taskStatus === 'FAILURE') {
      const errorMsg = statusData.error?.message || statusData.message || statusData.output?.message || '视频生成失败';
      return {
        success: false,
        status: taskStatus,
        error: errorMsg,
      };
    }

    return {
      success: false,
      status: taskStatus,
      progress: statusData.progress || 0,
    };
  } catch (error) {
    console.error(`[Agnes Video] Status check exception: ${error}`);
    return { success: false, error: `查询任务状态异常: ${(error as Error).message}` };
  }
}

export const availableModels: { id: ImageModel; name: string; description: string; requiresKey: boolean }[] = [
  { id: 'trae', name: 'Trae AI', description: '内置图片生成服务（无需配置）', requiresKey: false },
  { id: 'wanx', name: '通义万相', description: '阿里云 wanx2.1-turbo（新用户100次免费）', requiresKey: true },
  { id: 'cogview', name: '智谱 CogView-4', description: '智谱AI文生图模型（新用户2000万Tokens）', requiresKey: true },
  { id: 'volcengine', name: '火山方舟', description: '火山引擎大模型平台（按需付费）', requiresKey: true },
];
