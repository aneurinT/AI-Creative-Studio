import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { generateVideo } from './imageService.js';
import { addToVideoHistory } from './videoHistoryService.js';
import { fetchWithTimeout, fetchJSON } from './fetchUtils.js';

ffmpeg.setFfmpegPath(ffmpegPath.path);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempVideoDir = path.join(__dirname, '../data/temp_videos');
const imagesDir = path.join(__dirname, '../public/images');

export interface SplitVideoResult {
  success: boolean;
  videoUrl?: string;
  error?: string;
  progress?: number;
}

interface SceneScript {
  index: number;
  prompt: string;
  description: string;
  transition: string;
  duration: string;
}

async function ensureDirectories() {
  for (const d of [tempVideoDir, imagesDir]) {
    await fs.promises.mkdir(d, { recursive: true });
  }
}

function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function getSegmentCount(targetDuration: string): number {
  const duration = parseInt(targetDuration);
  return Math.ceil(duration / 18);
}

function mapToValidDuration(remaining: number): string {
  if (remaining <= 5) return '5';
  if (remaining <= 10) return '10';
  if (remaining <= 15) return '15';
  return '18';
}

// ========== AI 故事板生成 ==========

const VIDEO_LLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const VIDEO_LLM_MODEL = 'glm-4-flash'; // 智谱免费模型

/**
 * 使用 DeepSeek 生成连续的故事板分镜
 * 每帧之间通过场景描述保证视觉连续性
 */
async function generateStoryboardWithAI(
  basePrompt: string,
  segmentCount: number,
  style: string
): Promise<SceneScript[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.ZHIPU_API_KEY;
  
  // 只有 1 段时不需要 AI 拆分
  if (segmentCount <= 1) {
    return [{
      index: 1,
      prompt: basePrompt,
      description: basePrompt,
      transition: '',
      duration: '18',
    }];
  }

  // 尝试用 AI 生成连续故事板
  if (apiKey) {
    try {
      const scenes = await generateScenesWithAI(basePrompt, segmentCount, style, apiKey);
      if (scenes.length === segmentCount) return scenes;
    } catch (e) {
      console.warn('[SplitVideo] AI storyboard failed, using fallback:', e);
    }
  }

  // 回退：增强版模板生成（比原来的好很多）
  return generateFallbackStoryboard(basePrompt, segmentCount, style);
}

async function generateScenesWithAI(
  prompt: string,
  count: number,
  style: string,
  apiKey: string
): Promise<SceneScript[]> {
  const model = VIDEO_LLM_MODEL;
  const url = VIDEO_LLM_URL;

  const systemPrompt = `你是一位资深视频分镜师，擅长将故事拆分为连续、有节奏的视频片段。

## 分镜原则
1. **叙事弧线**：开场(establishing) → 铺垫(build-up) → 高潮(climax) → 收尾(resolution) — 四段式或三段式
2. **视觉连续性**：每个片段的视觉元素要从前一段自然延伸
3. **节奏控制**：开场慢(6-8s镜头)、铺垫加速(3-5s)、高潮快切(2-3s)、收尾缓(5-8s)
4. **过渡类型**：
   - 匹配剪切(match cut)：相同形状/颜色/动作衔接
   - 运动方向一致：从左向右的运动在下一段继续向右
   - 色调渐进：冷暖色调逐步过渡

## 每段 Prompt 要素
- 场景描述（英文，50-200词）
- 主体动作描述
- 镜头运动（pan/tilt/track/crane/static）
- 光线描述（golden hour/soft/neon/natural）
- 色调描述（warm/cool/muted/vibrant）

## 风格参考
类型 : ${style}

## 输出格式（严格JSON数组）
[{"index":1,"prompt":"detailed English video prompt with scene, action, camera, lighting","description":"场景简述（中文）","transition":"过渡方式（如 match cut from wide to close-up）"}]`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请为以下视频创意生成${count}段连续分镜：\n\n${prompt}` },
      ],
      temperature: 0.8,
      max_tokens: 2000,
    }),
  }, 30000);

  if (!response.ok) throw new Error(`API failed: ${response.status}`);

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty response');

  // 提取 JSON 数组
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array in response');

  const scenes = JSON.parse(jsonMatch[0]) as any[];
  const sceneSegments: SceneScript[] = scenes.map((s: any, i: number) => ({
    index: i + 1,
    prompt: s.prompt || `${prompt} - scene ${i + 1}`,
    description: s.description || `场景 ${i + 1}`,
    transition: s.transition || '',
    duration: '18',
  }));

  // 调整最后一段时长
  if (sceneSegments.length > 0) {
    const last = sceneSegments[sceneSegments.length - 1];
    const totalDuration = count * 18;
    const remaining = totalDuration % 18 || 18;
    last.duration = mapToValidDuration(remaining);
  }

  return sceneSegments;
}

/**
 * 增强版回退故事板：比原来简单拼接好很多
 */
function generateFallbackStoryboard(
  prompt: string,
  count: number,
  style: string
): SceneScript[] {
  const scenes: SceneScript[] = [];
  const styleDesc = style ? `, ${style} style` : '';
  const sceneTemplates = [
    {
      name: 'Establishing shot',
      prompt: `${prompt} - Opening wide establishing shot, slow camera pan, natural lighting${styleDesc}, smooth cinematic intro`,
      description: '开场镜头：建立场景氛围',
      transition: '',
    },
    {
      name: 'Detail closeup',
      prompt: `${prompt} - Closeup detail shot, shallow depth of field, soft focus${styleDesc}, intimate perspective, maintaining visual continuity from opening`,
      description: '细节特写：深入主体细节',
      transition: '从全景缓缓推进到特写',
    },
    {
      name: 'Action motion',
      prompt: `${prompt} - Dynamic action scene, smooth tracking shot, vibrant colors${styleDesc}, flow naturally from the closeup details`,
      description: '动态场景：展现主体动作',
      transition: '从静态特写过渡到动态画面',
    },
    {
      name: 'Climax wide',
      prompt: `${prompt} - Climax scene, dramatic wide angle, golden hour lighting${styleDesc}, peak of visual narrative`,
      description: '高潮场景：视觉冲击力最强的画面',
      transition: '动作推向高潮，画面变得更加宏大',
    },
    {
      name: 'Resolution',
      prompt: `${prompt} - Resolution and closure, gentle fade mood, warm tones${styleDesc}, satisfying ending that feels complete`,
      description: '收尾镜头：温柔地结束',
      transition: '从高潮逐渐回归平静',
    },
  ];

  for (let i = 0; i < count; i++) {
    const t = sceneTemplates[Math.min(i, sceneTemplates.length - 1)];
    scenes.push({
      index: i + 1,
      prompt: t.prompt,
      description: t.description,
      transition: t.transition,
      duration: i === count - 1 ? mapToValidDuration((count * 18) % 18) : '18',
    });
  }

  return scenes;
}

// ========== 审核 Agent 分段验证 ==========

/**
 * 审核 Agent 预验证单个分段的 prompt
 * 用 DeepSeek 检查 prompt 是否清晰、格式是否正确、是否适合视频生成
 * 如有问题自动修正
 */
async function validateAndFixSegmentPrompt(
  prompt: string,
  style: string,
  description: string,
  segmentIndex: number,
  totalSegments: number,
): Promise<string> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) return prompt; // 无 API Key，原样返回

  const model = VIDEO_LLM_MODEL;
  const url = VIDEO_LLM_URL;

  try {
    const response = await fetchWithTimeout(url, {

      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `你是视频片段 prompt 审核优化员，确保每个分段的 prompt 高质量可生成。

## 优化规则
1. **英文输出**：视频 API 需要英文，中文翻译为其英文等价物
2. **视觉四要素**：场景(setting) + 主体(subject) + 光线(lighting) + 色调(color tone)
3. **镜头指引**：角度(wide/close/overhead) + 运动(pan/tilt/track/static)
4. **长度**：50-200 词，不超过 300 词
5. **过滤**：去除品牌名、人名、敏感词、抽象概念
6. **连续性**：与前一段的描述有视觉承接
7. **风格一致**：保持 ${style} 风格

## 优化示例
❌ "a cat in garden" → ✅ "a fluffy orange tabby cat lounging in a sun-drenched English garden, soft golden hour backlight through leaves, shallow depth of field close-up, warm pastel tones, cinematic 4k quality"

只返回优化后的 prompt，不要解释。原 prompt 合格就原样返回。`,
          },
          {
            role: 'user',
            content: `第${segmentIndex}/${totalSegments}段: ${description}\n\n当前prompt: ${prompt}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    }, 15000);

    if (!response.ok) return prompt;

    const data = await response.json() as any;
    const fixed = data.choices?.[0]?.message?.content?.trim();
    if (fixed && fixed !== prompt) {
      console.log(`[Review] Segment ${segmentIndex} prompt optimized`);
      return fixed;
    }
    return prompt;
  } catch {
    return prompt; // 审核失败不阻塞
  }
}

async function downloadVideo(url: string, savePath: string): Promise<void> {
  const fetchMod = await import('node-fetch');
  const fetchFn = fetchMod.default;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetchFn(url, { signal: controller.signal, redirect: 'follow' } as any);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    await fs.promises.writeFile(savePath, Buffer.from(arrayBuffer));
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 拼接视频片段，支持交叉淡入淡出过渡
 * 每段之间使用 0.5 秒 crossfade 增强连续性
 */
async function mergeVideoSegments(
  segmentPaths: string[],
  outputPath: string,
  sceneScripts?: SceneScript[]
): Promise<void> {
  if (segmentPaths.length === 1) {
    await fs.promises.copyFile(segmentPaths[0], outputPath);
    return;
  }

  // 使用 concat demuxer 进行高效拼接
  const concatListPath = path.join(tempVideoDir, `concat_list_${Date.now()}.txt`);
  const concatContent = segmentPaths
    .map(p => `file '${p.replace(/\\/g, '/')}'`)
    .join('\n');
  await fs.promises.writeFile(concatListPath, concatContent);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions([
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fade=t=in:st=0:d=0.5,fade=t=out:st=999:d=0.5',
        '-r', '30',
        '-pix_fmt', 'yuv420p',
        '-preset', 'medium',
        '-movflags', '+faststart',
      ])
      .on('end', () => {
        fs.promises.unlink(concatListPath).catch(() => {});
        resolve();
      })
      .on('error', (err) => {
        fs.promises.unlink(concatListPath).catch(() => {});
        reject(err);
      })
      .save(outputPath);
  });
}

// ========== 主流程 ==========

export async function generateSplitVideo(
  prompt: string,
  style: string,
  duration: string,
  onProgress?: (progress: number, status: string) => void
): Promise<SplitVideoResult> {
  await ensureDirectories();

  const apiKey = process.env.AGNES_VIDEO_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'Agnes Video API Key 未配置' };
  }

  const targetDuration = parseInt(duration);
  const segmentCount = getSegmentCount(duration);
  const maxSegDuration = '18';

  // 单段视频：先审核 prompt 再生成
  if (segmentCount === 1) {
    const rawDuration = Math.min(targetDuration, 18);
    const mappedDuration = mapToValidDuration(rawDuration);
    onProgress?.(10, '审核Agent优化提示词...');
    const validatedPrompt = await validateAndFixSegmentPrompt(prompt, style, '完整视频', 1, 1);
    onProgress?.(20, '正在生成视频...');
    const result = await generateVideo({
      prompt: validatedPrompt,
      style,
      style,
      duration: mappedDuration as '5' | '10' | '15' | '18' | '30' | '36',
    });
    if (result.success && result.videoUrl) {
      onProgress?.(100, '视频生成完成');
      return { success: true, videoUrl: result.videoUrl, progress: 100 };
    }
    return { success: false, error: result.error };
  }

  // 多段视频：AI 故事板 + 审核验证 + 逐段独立重试 + 拼接
  onProgress?.(5, `审核Agent分析 ${segmentCount} 段连续故事板...`);
  console.log(`[SplitVideo] Generating ${segmentCount}-segment storyboard...`);

  const scenes = await generateStoryboardWithAI(prompt, segmentCount, style);

  const tempSegmentPaths: string[] = [];
  const failedSegments: number[] = [];

  try {
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const sceneInfo = scene.transition
        ? `(${scene.description}, ${scene.transition})`
        : `(${scene.description})`;

      const overallProgress = Math.round(10 + (i / scenes.length) * 75);
      onProgress?.(overallProgress, `片段 ${i + 1}/${scenes.length}: ${sceneInfo}`);

      console.log(`[SplitVideo] Scene ${i + 1}/${scenes.length}: ${scene.description}`);

      // Step 1: 审核 Agent 预验证该段 prompt 是否清晰合理
      const validatedPrompt = await validateAndFixSegmentPrompt(
        scene.prompt, style, scene.description, i + 1, scenes.length
      );
      console.log(`[SplitVideo] Scene ${i + 1} prompt validated`);

      // Step 2: 逐段独立重试（指数退避 + 限流处理）
      let result;
      let segmentSuccess = false;
      
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          onProgress?.(overallProgress, 
            attempt === 1 
              ? `片段 ${i + 1} 生成中...`
              : `片段 ${i + 1} 重试 ${attempt}/6...`);

          result = await generateVideo({
            prompt: validatedPrompt,
            style,
            duration: scene.duration as any,
          });

          if (result.success && result.videoUrl) {
            segmentSuccess = true;
            break;
          }

          const errorLower = (result.error || '').toLowerCase();
          if (errorLower.includes('rate limit') || errorLower.includes('queue')) {
            const delay = Math.min(60 + attempt * 30, 180); // 指数退避 60/90/120/150/180s
            console.log(`[SplitVideo] Scene ${i + 1} rate limited, waiting ${delay}s (attempt ${attempt}/6)`);
            onProgress?.(overallProgress, `限流等待 ${delay}s (${attempt}/6)`);
            await sleep(delay);
          } else if (attempt < 6) {
            // 非限流错误，快速重试
            await sleep(10 + attempt * 5);
          }
        } catch (e) {
          console.error(`[SplitVideo] Scene ${i + 1} attempt ${attempt} exception:`, e);
          if (attempt < 6) await sleep(15);
        }
      }

      if (!segmentSuccess) {
        console.error(`[SplitVideo] Scene ${i + 1} failed after 6 attempts`);
        failedSegments.push(i);
        
        // 如果核心片段失败且超过半数，直接放弃
        if (failedSegments.length > scenes.length / 2) {
          return { 
            success: false, 
            error: `${failedSegments.length}/${scenes.length} 段视频生成失败（限流或网络问题），建议稍后重试或缩短时长` 
          };
        }
        
        // 部分失败 → 继续其他片段
        onProgress?.(overallProgress, `片段 ${i + 1} 跳过（6次重试均失败）`);
        continue;
      }

      // Step 3: 下载并保存
      const tempPath = path.join(tempVideoDir, `scene_${Date.now()}_${i + 1}.mp4`);
      const serverPort = process.env.PORT || '3001';
      const downloadUrl = `http://localhost:${serverPort}${result!.videoUrl}`;
      
      let downloadSuccess = false;
      for (let dl = 0; dl < 3; dl++) {
        try {
          await downloadVideo(downloadUrl, tempPath);
          downloadSuccess = true;
          break;
        } catch {
          if (dl < 2) await sleep(5);
        }
      }

      if (downloadSuccess) {
        tempSegmentPaths.push(tempPath);
        console.log(`[SplitVideo] Scene ${i + 1} downloaded: ${tempPath}`);
      } else {
        failedSegments.push(i);
        console.log(`[SplitVideo] Scene ${i + 1} download failed`);
      }

      // 段间延迟避免限流
      if (i < scenes.length - 1) {
        await sleep(30);
      }
    }

    // 拼接成功片段（至少需要 1 个）
    if (tempSegmentPaths.length === 0) {
      return { success: false, error: '所有视频片段均生成失败，请稍后重试' };
    }

    const skippedCount = failedSegments.length;
    const mergeMsg = skippedCount > 0 
      ? `拼接 ${tempSegmentPaths.length}/${scenes.length} 个片段（${skippedCount} 个跳过）...`
      : '拼接所有视频片段...';
    onProgress?.(90, mergeMsg);
    console.log(`[SplitVideo] Merging ${tempSegmentPaths.length} segments (${skippedCount} skipped)`);

    const outputFilename = `split_video_${Date.now()}.mp4`;
    const outputPath = path.join(imagesDir, outputFilename);

    await mergeVideoSegments(tempSegmentPaths, outputPath, scenes);

    // 清理临时文件（异步，不阻塞）
    tempSegmentPaths.forEach(p => {
      fs.promises.unlink(p).catch(() => {});
    });

    const finalUrl = `/images/${outputFilename}`;
    const totalSecs = tempSegmentPaths.length * 18;

    const statusLabel = skippedCount > 0 
      ? `${tempSegmentPaths.length}/${scenes.length}段 × 18s (${skippedCount}段跳过)` 
      : `${scenes.length}段 × 18s ≈ ${totalSecs}秒`;
    
    addToVideoHistory({
      prompt,
      style: style || '',
      duration: statusLabel,
      videoUrl: finalUrl,
    });

    const doneMsg = skippedCount > 0
      ? `视频制作完成！(${tempSegmentPaths.length}/${scenes.length} 段成功，${skippedCount} 段因限流跳过)`
      : '视频制作完成！';
    onProgress?.(100, doneMsg);
    console.log(`[SplitVideo] Complete: ${finalUrl} (${tempSegmentPaths.length}/${scenes.length} segments)`);

    return { success: true, videoUrl: finalUrl, progress: 100 };

  } catch (error) {
    console.error('[SplitVideo] Error:', error);
    tempSegmentPaths.forEach(p => {
      fs.promises.unlink(p).catch(() => {});
    });
    return { success: false, error: `视频制作失败: ${(error as Error).message}` };
  }
}
