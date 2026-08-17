import { Router, type Request, type Response } from 'express'
import { checkVideoTaskStatus } from '../services/imageService.js'
import { generateSplitVideo } from '../services/videoSplitService.js'
import { getVideoHistory, addToVideoHistory, deleteFromVideoHistory, clearVideoHistory } from '../services/videoHistoryService.js'
import { getPendingTasks, addPendingTask, removePendingTask, clearAllPendingTasks, updateTaskStatus, cleanStaleTasks } from '../services/videoTaskService.js'
import { getTaskProgress, setTaskProgress, updateTaskProgress, removeTaskProgress, checkTaskExists } from '../services/videoTaskProgressService.js'
import { createFreeVideoTask, checkFreeVideoStatus, generateZhipuVideo, generateWanxVideo, checkZhipuVideoStatus, checkWanxVideoStatus, generateSeedanceVideo, checkSeedanceStatus } from '../services/freeVideoService.js'
import { recommendEngine, listAvailableEngines } from '../services/engineCapabilityMatrix.js'
import fetch from 'node-fetch'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const RATE_LIMIT_WAIT_SECONDS = 35
const RATE_LIMIT_RETRY_MAX = 5

/** 检测 Agnes Video API 是否可达（带缓存，60秒内不重复检测） */
let agnesReachable: boolean | null = null;
let agnesCheckTime = 0;
const AGNES_CHECK_TTL = 60_000; // 60秒缓存

async function checkAgnesReachable(): Promise<boolean> {
  const now = Date.now();
  if (agnesReachable !== null && (now - agnesCheckTime) < AGNES_CHECK_TTL) {
    return agnesReachable;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch('https://apihub.agnes-ai.cn/v1/videos', {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timer);
    agnesReachable = true;
  } catch {
    agnesReachable = false;
  }
  agnesCheckTime = now;
  return agnesReachable;
}

// ========================
// 各模型单次最大视频时长（秒）
// ========================
const MODEL_MAX_DURATION: Record<string, number> = {
  'cogvideox': 6,         // 智谱 CogVideoX-Flash（免费，API 不接受 duration 参数，固定 6 秒）
  'cogvideox-flash': 6,  // 兼容旧键名
  'cogvideox-3': 10,     // 智谱 CogVideoX-3（付费）
  'wanx-video': 10,      // 通义万相视频
  'seedance': 15,        // Seedance 2.0（API 支持 5/10/15 秒）
  'agnes': 18,           // Agnes Video V2.0
}

/**
 * 计算需要拆分的片段数和每段时长
 * @param targetDuration 目标总时长（秒）
 * @param model 模型名
 * @returns { segmentCount, segDuration }
 */
function calculateSplit(targetDuration: number, model: string): { segmentCount: number; segDuration: number } {
  const maxDuration = MODEL_MAX_DURATION[model] || 10

  if (targetDuration <= maxDuration) {
    return { segmentCount: 1, segDuration: targetDuration }
  }

  // 向上取整：比如 25 秒 ÷ 6 = 4.17 → 5 段
  const segmentCount = Math.ceil(targetDuration / maxDuration)
  // 每段时长取整：25 ÷ 5 = 5 秒
  const segDuration = Math.ceil(targetDuration / segmentCount)

  return { segmentCount, segDuration }
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
}

const router = Router()

// Agnes API 健康检查
router.get('/health-check', async (_req: Request, res: Response) => {
  const reachable = await checkAgnesReachable();
  res.json({
    success: true,
    agnesReachable: reachable,
    message: reachable
      ? 'Agnes Video API 可达'
      : 'Agnes Video API 不可达，建议使用 /api/video/free 或 LTX 本地服务',
  });
});

router.get('/history', (req: Request, res: Response) => {
  const result = getVideoHistory()
  res.json(result)
})

router.delete('/history/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const result = deleteFromVideoHistory(id)
  res.json(result)
})

router.delete('/history', (req: Request, res: Response) => {
  const result = clearVideoHistory()
  res.json(result)
})

router.get('/pending', (req: Request, res: Response) => {
  const userId = (req as any).user?.userId
  const result = getPendingTasks(userId)
  res.json(result)
})

router.delete('/pending/:taskId', (req: Request, res: Response) => {
  const { taskId } = req.params
  const userId = (req as any).user?.userId
  const result = removePendingTask(taskId, userId)
  // 同时标记任务为 cancelled，让后台轮询可以检测到并停止
  updateTaskProgress(taskId, { status: 'cancelled', error: '用户已取消任务' })
  res.json(result)
})

router.delete('/pending', (req: Request, res: Response) => {
  const result = clearAllPendingTasks()
  res.json(result)
})

router.put('/pending/:taskId/status', (req: Request, res: Response) => {
  const { taskId } = req.params
  const { status } = req.body
  if (!status || !['completed', 'failed'].includes(status)) {
    res.status(400).json({ success: false, error: 'status must be completed or failed' })
    return
  }
  const result = updateTaskStatus(taskId, status)
  res.json(result)
})

router.post('/pending/clean', (req: Request, res: Response) => {
  const result = cleanStaleTasks()
  res.json(result)
})

/** 取消任务：前端通知后端停止后台轮询 */
router.post('/cancel/:taskId', (req: Request, res: Response) => {
  const { taskId } = req.params
  removePendingTask(taskId)
  updateTaskProgress(taskId, { status: 'cancelled', error: '任务已被取消' })
  console.log(`[Video] Task ${taskId} cancelled by user`)
  res.json({ success: true, message: '任务已取消' })
})

router.get('/pending/:taskId/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const { taskId } = req.params

    // 优先检查持久化的任务进度（split_/merge_/普通任务统一）
    // 后台轮询会将结果写入此处，避免重复查询 Agnes API
    const progressInfo = getTaskProgress(taskId)
    if (progressInfo) {
      const isCompleted = progressInfo.status === 'completed' && progressInfo.videoUrl
      const isFailed = progressInfo.status === 'failed'

      if (isCompleted) {
        // 成功：移除 pending task，返回视频地址
        removePendingTask(taskId)
        // 延迟清理进度记录（保留一段时间供前端获取最终结果）
        setTimeout(() => removeTaskProgress(taskId), 300000)
        res.json({
          success: true,
          status: 'completed',
          progress: 100,
          videoUrl: progressInfo.videoUrl,
        })
      } else if (isFailed) {
        removePendingTask(taskId)
        setTimeout(() => removeTaskProgress(taskId), 300000)
        res.json({
          success: false,
          status: 'failed',
          progress: 0,
          error: progressInfo.error || '视频生成失败',
        })
      } else {
        // 检查是否已超时（普通任务20分钟，拆分任务45分钟）
        // Agnes 免费额度每分钟 2 次，split 任务需要多段生成+拼接，时间需放宽
        const isSplitTask = progressInfo.taskType === 'split';
        const timeoutMs = isSplitTask ? 45 * 60 * 1000 : 20 * 60 * 1000;
        // 优先用 createdAt，但如果 updatedAt 更晚（比如服务重启后进度被保留），用更晚的时间点
        // 防止因 createdAt 异常导致误判超时
        const baseTime = Math.max(progressInfo.createdAt || 0, progressInfo.updatedAt || 0);
        const elapsed = Date.now() - (baseTime || 0);
        if (elapsed > timeoutMs) {
          // 超时自动标记为失败
          setTaskProgress(taskId, {
            progress: 0,
            status: 'failed',
            error: isSplitTask ? '视频拆分生成超时（超过45分钟），请稍后重试' : '视频生成超时（超过20分钟），后台任务可能已中断',
            taskType: progressInfo.taskType || 'normal',
          });
          removePendingTask(taskId);
          res.json({
            success: false,
            status: 'failed',
            progress: 0,
            error: isSplitTask ? '视频拆分生成超时（超过45分钟），请稍后重试' : '视频生成超时，请重新尝试',
          });
        } else {
          // 仍在处理中，返回进度
          res.json({
            success: false,
            status: 'processing',
            progress: progressInfo.progress || 0,
          });
        }
      }
      return
    }

    // 持久化记录中没有，检查任务是否曾经存在（区分"不存在"和"已过期"）
    const taskCheck = checkTaskExists(taskId)

    // 对于普通任务（非 split_/merge_），降级为直接查询 Agnes API
    if (!taskId.startsWith('split_') && !taskId.startsWith('merge_')) {
      const apiKey = process.env.AGNES_VIDEO_API_KEY

      if (!apiKey) {
        res.json({ success: false, error: 'API Key 未配置' })
        return
      }

      const result = await checkVideoTaskStatus(taskId, apiKey)

      if (result.success && result.videoUrl) {
        const pendingTasks = getPendingTasks()
        const taskInfo = pendingTasks.tasks.find(t => t.taskId === taskId)
        if (taskInfo) {
          addToVideoHistory({
            prompt: taskInfo.prompt,
            style: taskInfo.style,
            duration: taskInfo.duration,
            videoUrl: result.videoUrl,
          })
          removePendingTask(taskId)
        }
      }

      res.json(result)
      return
    }

    // split_/merge_ 任务在持久化记录中没有，说明已过期或服务器重启后无法恢复
    // 提供更友好的错误信息，区分"从未存在"和"已过期"
    if (taskCheck.expired) {
      const taskDesc = taskId.startsWith('split_') ? '长视频拆分' : '视频拼接'
      res.json({
        success: false,
        status: 'failed',
        error: `${taskDesc}任务记录已过期（超过2小时未更新）。由于复合任务无法从第三方API恢复，请重新生成视频。`,
      })
    } else {
      const taskDesc = taskId.startsWith('split_') ? '长视频拆分' : '视频拼接'
      res.json({
        success: false,
        status: 'failed',
        error: `${taskDesc}任务记录不存在，可能是服务器重启导致。请重新生成视频。`,
      })
    }
  } catch (error) {
    console.error(`[Agnes Video] Status route error: ${error}`)
    res.json({ success: false, status: 'failed', error: `查询任务状态异常: ${(error as Error).message}` })
  }
})

// ========================
// 限流控制：滑动窗口 + 并发槽位
// 解决问题：原来的互斥锁会串行化所有请求，N个并发请求需要等待 (N-1)*35秒
// 现在改为：每35秒一个窗口，窗口内最多3个并发请求，超出则排队等待下一个窗口
// ========================
const RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WAIT_SECONDS * 1000 // 35秒窗口
const RATE_LIMIT_MAX_CONCURRENT = 3 // 窗口内最大并发数

interface RateLimitSlot {
  windowStart: number
  count: number
  waiters: Array<{ resolve: () => void; rejected?: boolean }>
}

const rateLimitSlot: RateLimitSlot = {
  windowStart: 0,
  count: 0,
  waiters: [],
}

async function waitForRateLimit(): Promise<{ slotId: number }> {
  const now = Date.now()

  // 检查是否进入新窗口
  if (now - rateLimitSlot.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitSlot.windowStart = now
    rateLimitSlot.count = 0
    // 通知等待者
    const waiters = rateLimitSlot.waiters.splice(0, RATE_LIMIT_MAX_CONCURRENT)
    waiters.forEach(w => {
      if (!w.rejected) w.resolve()
    })
  }

  // 如果当前窗口还有槽位，直接使用
  if (rateLimitSlot.count < RATE_LIMIT_MAX_CONCURRENT) {
    rateLimitSlot.count++
    const slotId = rateLimitSlot.count
    return { slotId }
  }

  // 需要等待到下一个窗口
  const waitMs = RATE_LIMIT_WINDOW_MS - (now - rateLimitSlot.windowStart) + 100
  console.log(`[Video Rate Limit] Window full (${rateLimitSlot.count}/${RATE_LIMIT_MAX_CONCURRENT}), waiting ${Math.round(waitMs / 1000)}s for next window...`)

  return new Promise<{ slotId: number }>((resolve) => {
    const waiter = {
      resolve: () => {
        rateLimitSlot.count++
        resolve({ slotId: rateLimitSlot.count })
      },
      rejected: false,
    }
    rateLimitSlot.waiters.push(waiter)

    // 安全超时：最多等 2 个窗口周期
    setTimeout(() => {
      const idx = rateLimitSlot.waiters.indexOf(waiter)
      if (idx >= 0) {
        waiter.rejected = true
        rateLimitSlot.waiters.splice(idx, 1)
        rateLimitSlot.count++
        resolve({ slotId: rateLimitSlot.count })
      }
    }, waitMs + RATE_LIMIT_WINDOW_MS)
  })
}

/** 释放限流槽位（任务完成后调用，让等待中的请求提前进入） */
function releaseRateLimitSlot(slotId: number): void {
  rateLimitSlot.count = Math.max(0, rateLimitSlot.count - 1)
  if (rateLimitSlot.waiters.length > 0) {
    const waiter = rateLimitSlot.waiters.shift()!
    if (!waiter.rejected) waiter.resolve()
  }
}

interface VideoTaskResult {
  success: boolean
  taskId?: string
  error?: string
  message?: string
  newPrompt?: string
}

// 可复用的异步视频任务创建逻辑：立即返回 taskId，后台轮询生成结果
// 供 POST /、POST /modify、POST /upload/image/video 共用，避免同步等待导致 HTTP 请求超时返回空响应
export async function createVideoTaskAsync(
  prompt: string,
  style: string,
  duration: string,
  split: boolean = true,
  userId?: string,
  resolution?: string,
): Promise<VideoTaskResult> {
  const apiKey = process.env.AGNES_VIDEO_API_KEY

  if (!apiKey) {
    // Agnes Key 未配置，自动降级到免费引擎
    console.log('[Agnes Video] API Key not configured, auto-fallback to free engines')
    return await tryFreeVideoFallback(prompt, style, duration)
  }

  // 快速检测 Agnes API 是否可达（5秒超时，60秒缓存）
  const reachable = await checkAgnesReachable();
  if (!reachable) {
    // Agnes 不可达，自动降级到免费引擎
    console.log('[Agnes Video] API unreachable, auto-fallback to free engines')
    return await tryFreeVideoFallback(prompt, style, duration)
  }

  const targetDuration = parseInt(duration || '10')

  if (split && targetDuration > 18) {
    console.log(`[Video Split] Long video detected (${duration}s), splitting into segments...`)

    const taskId = `split_${Date.now()}`
    addPendingTask({
      taskId,
      userId,
      prompt,
      style: style || '',
      duration: duration || '10',
    })

    setTaskProgress(taskId, { progress: 0, status: 'processing', taskType: 'split', prompt, style: style || '', duration: duration || '10' })

    setTimeout(async () => {
      try {
        // 检查任务是否已被取消
        if (getTaskProgress(taskId)?.status === 'cancelled') {
          console.log(`[Video Split] Task ${taskId} was cancelled before starting`)
          removePendingTask(taskId)
          return
        }

        const result = await generateSplitVideo(prompt, style || '', duration || '10', (progress, status) => {
          // 每个进度回调都检查取消状态
          if (getTaskProgress(taskId)?.status === 'cancelled') return
          console.log(`[Video Split] Progress: ${progress}% - ${status}`)
          updateTaskProgress(taskId, { progress, status: status as 'processing' | 'completed' | 'failed' })
        })

        if (result.success && result.videoUrl) {
          setTaskProgress(taskId, {
            progress: 100,
            status: 'completed',
            videoUrl: result.videoUrl,
            taskType: 'split',
          })
          addToVideoHistory({
            prompt,
            style: style || '',
            duration: `${Math.ceil(targetDuration / 18)}段 × 18秒${result.reviewPassed !== undefined ? (result.reviewPassed ? ' ✅' : ' ⚠️') : ''}`,
            videoUrl: result.videoUrl,
          })
        } else {
          setTaskProgress(taskId, {
            progress: 0,
            status: 'failed',
            error: result.error,
            taskType: 'split',
          })
        }

        removePendingTask(taskId)
      } catch (error) {
        console.error(`[Video Split] Background execution error: ${error}`)
        setTaskProgress(taskId, {
          progress: 0,
          status: 'failed',
          error: (error as Error).message,
          taskType: 'split',
        })
        removePendingTask(taskId)
      }
    }, 100)

    return {
      success: true,
      taskId,
      message: `视频将拆分为 ${Math.ceil(targetDuration / 18)} 个片段生成，完成后自动拼接`,
    }
  }

  const rateLimit = await waitForRateLimit()

  const fullPrompt = style ? `${prompt}，${style}` : prompt
  const frameConfig = DURATION_TO_FRAMES[duration || '10'] || DURATION_TO_FRAMES['10']

  // 用户指定的分辨率覆盖基于时长的默认分辨率
  const effectiveResolution = resolution || frameConfig.resolution

  console.log(`[Agnes Video] Creating video: prompt="${fullPrompt}", duration="${duration}s", num_frames=${frameConfig.num_frames}, frame_rate=${frameConfig.frame_rate}, resolution=${effectiveResolution}`)

  let taskData: any
  let videoId: string | undefined
  let attempts = 0

  do {
    attempts++

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Agnes Video API timeout')), 60000)
      })

      const createResponse = await Promise.race([
        fetch(
          'https://apihub.agnes-ai.cn/v1/videos',
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
              resolution: effectiveResolution,
            }),
          },
        ),
        timeoutPromise,
      ])

      if (!createResponse.ok) {
        const errorText = await createResponse.text().catch(() => '')
        let errorData: Record<string, any> = {}
        try { errorData = errorText ? JSON.parse(errorText) : {} } catch { errorData = { rawResponse: errorText.substring(0, 200) } }
        console.error(`[Agnes Video] Create failed (attempt ${attempts}): HTTP ${createResponse.status} - ${JSON.stringify(errorData)}`)

        const errorMsg = errorData.message || errorData.error?.message || `Agnes Video创建任务失败: ${createResponse.status}`

        if (errorMsg.toLowerCase().includes('rate limit') && attempts < RATE_LIMIT_RETRY_MAX) {
          console.log(`[Agnes Video] Rate limit exceeded, waiting 60 seconds (attempt ${attempts}/${RATE_LIMIT_RETRY_MAX})`)
          await new Promise(resolve => setTimeout(resolve, 60000))
          continue
        }

        releaseRateLimitSlot(rateLimit.slotId)
        return { success: false, error: errorMsg }
      }

      taskData = await createResponse.json()
      console.log(`[Agnes Video] Task response: ${JSON.stringify(taskData)}`)

      videoId = taskData.video_id || taskData.data?.video_id || taskData.task_id

      if (!videoId) {
        if (attempts < RATE_LIMIT_RETRY_MAX) {
          console.log(`[Agnes Video] No video ID returned, retrying...`)
          await new Promise(resolve => setTimeout(resolve, 5000))
          continue
        }
        releaseRateLimitSlot(rateLimit.slotId)
        return { success: false, error: 'Agnes Video未返回任务ID' }
      }

      break

    } catch (error) {
      const errorMsg = (error as Error).message

      if (errorMsg.includes('timeout') && attempts < RATE_LIMIT_RETRY_MAX) {
        console.log(`[Agnes Video] Timeout, retrying (attempt ${attempts}/${RATE_LIMIT_RETRY_MAX})`)
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }

      console.error(`[Agnes Video] Exception (attempt ${attempts}): ${error}`)

      if (attempts >= RATE_LIMIT_RETRY_MAX) {
        releaseRateLimitSlot(rateLimit.slotId)
        return { success: false, error: errorMsg }
      }
    }
  } while (attempts < RATE_LIMIT_RETRY_MAX)

  if (!videoId) {
    releaseRateLimitSlot(rateLimit.slotId)
    return { success: false, error: '视频队列繁忙，请稍后重试' }
  }

  // 任务已创建，释放限流槽位，让后续请求可以进入
  releaseRateLimitSlot(rateLimit.slotId)

  addPendingTask({
    taskId: videoId,
    userId,
    prompt,
    style: style || '',
    duration: duration || '10',
  })

  // 初始化持久化任务进度，供状态查询路由读取
  setTaskProgress(videoId, { progress: 0, status: 'processing', taskType: 'normal', prompt, style: style || '', duration: duration || '10' })

  setTimeout(async () => {
    try {
      // 自适应轮询：前 20 次每 2 秒，之后每 5 秒
      for (let i = 0; i < 150; i++) {
        // 检查任务是否已被取消
        const currentProgress = getTaskProgress(videoId)
        if (currentProgress?.status === 'cancelled') {
          console.log(`[Agnes Video] Task ${videoId} was cancelled, stopping background poll`)
          removePendingTask(videoId)
          return
        }

        const pollInterval = i < 20 ? 2000 : 5000
        await new Promise(r => setTimeout(r, pollInterval))

        const statusResponse = await fetch(`https://apihub.agnes-ai.cn/agnesapi?video_id=${videoId}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        })

        const statusData = (await statusResponse.json()) as Record<string, any>
        console.log(`[Agnes Video] Poll ${i + 1}: status=${statusData.status}, progress=${statusData.progress || 0}%`)

        // 更新进度
        updateTaskProgress(videoId, { progress: statusData.progress !== undefined ? statusData.progress : Math.min(10 + i * 0.8, 90) })

        // 统一成功状态检查（与 checkVideoTaskStatus 保持一致）
        if (statusData.status === 'completed' || statusData.status === 'SUCCEEDED' || statusData.status === 'SUCCESS') {
          const videoUrl = statusData.url || statusData.metadata?.url || statusData.video_url || statusData.data?.video_url || statusData.output?.video_url
          if (videoUrl) {
            const response = await fetch(videoUrl, { redirect: 'follow' })
            if (!response.ok) {
              throw new Error(`下载视频失败: HTTP ${response.status}`)
            }
            const arrayBuffer = await response.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)
            const imagesDir = path.join(__dirname, '../public/images')
            await fs.promises.mkdir(imagesDir, { recursive: true })
            const videoFileName = `${Date.now()}.mp4`
            const videoPath = path.join(imagesDir, videoFileName)
            await fs.promises.writeFile(videoPath, buffer)
            const savedUrl = `/images/${videoFileName}`

            addToVideoHistory({
              prompt,
              style: style || '',
              duration: duration || '10',
              videoUrl: savedUrl,
            })

            // 记录成功状态，供前端轮询直接获取
            setTaskProgress(videoId, {
              progress: 100,
              status: 'completed',
              videoUrl: savedUrl,
              taskType: 'normal',
            })
            console.log(`[Agnes Video] Background poll completed: ${savedUrl}`)
          } else {
            console.error(`[Agnes Video] Completed but no video URL: ${JSON.stringify(statusData)}`)
            setTaskProgress(videoId, {
              progress: 0,
              status: 'failed',
              error: '任务已完成但未返回视频URL',
              taskType: 'normal',
            })
          }
          break
        }

        // 统一失败状态检查
        if (statusData.status === 'failed' || statusData.status === 'FAILED' || statusData.status === 'FAILURE') {
          const errorMsg = statusData.error?.message || statusData.message || '视频生成失败'
          console.error(`[Agnes Video] Task failed: ${errorMsg}`)
          setTaskProgress(videoId, {
            progress: 0,
            status: 'failed',
            error: errorMsg,
            taskType: 'normal',
          })
          break
        }
      }

      // 轮询超时：设置失败状态，避免任务卡在 processing
      const currentTask = getTaskProgress(videoId)
      if (currentTask && currentTask.status === 'processing') {
        console.error(`[Agnes Video] Task ${videoId} timed out after 120 polls (10 minutes)`)
        setTaskProgress(videoId, {
          progress: 0,
          status: 'failed',
          error: '视频生成超时（超过10分钟），请稍后重试',
          taskType: 'normal',
        })
      }

      removePendingTask(videoId)
    } catch (error) {
      console.error(`[Agnes Video] Background poll error: ${error}`)
      setTaskProgress(videoId, {
        progress: 0,
        status: 'failed',
        error: `后台轮询异常: ${(error as Error).message}`,
        taskType: 'normal',
      })
      removePendingTask(videoId)
    }
  }, 100)

  return {
    success: true,
    taskId: videoId,
    message: '视频生成任务已创建，请等待生成完成',
  }
}

/**
 * 自动降级：Agnes 不可用时，依次尝试免费视频引擎
 * 优先级：智谱 CogVideoX-Flash → 通义万相视频 → 返回失败
 * 长视频（>18秒）：使用免费引擎进行拆分生成
 */
async function tryFreeVideoFallback(
  prompt: string,
  style: string,
  duration: string,
): Promise<VideoTaskResult> {
  const targetDuration = parseInt(duration || '10')

  // ===== 第一优先级：智谱 CogVideoX-Flash（完全免费）=====
  const zhipuKey = process.env.ZHIPU_API_KEY
  if (zhipuKey) {
    const { segmentCount, segDuration } = calculateSplit(targetDuration, 'cogvideox-flash')

    if (segmentCount === 1) {
      // 短视频：直接调用智谱
      console.log('[Video Fallback] Trying Zhipu CogVideoX-Flash...')
      try {
        const zhipuResult = await generateZhipuVideo({
          prompt: style ? `${prompt}，${style}` : prompt,
          duration: segDuration,
        })
        if (zhipuResult.success && zhipuResult.taskId) {
          const taskId = `zhipu-fallback-${zhipuResult.taskId}`
          addPendingTask({ taskId, prompt, style: style || '', duration: String(segDuration) })
          setTaskProgress(taskId, { progress: 0, status: 'processing', taskType: 'normal', prompt, style: style || '', duration: String(segDuration) })
          setTimeout(async () => {
            await pollFreeVideoFallback(taskId, zhipuResult.taskId!, 'cogvideox', prompt, style, String(segDuration))
          }, 100)
          return {
            success: true,
            taskId,
            message: `Agnes 不可用，已自动切换到智谱 CogVideoX-Flash（免费）`,
          }
        }
        console.log(`[Video Fallback] Zhipu failed: ${zhipuResult.error}`)
      } catch (e) {
        console.log(`[Video Fallback] Zhipu error: ${e}`)
      }
    } else {
      // 长视频：智谱拆分
      console.log(`[Video Fallback] Long video (${targetDuration}s), Zhipu split: ${segmentCount}段×${segDuration}秒`)
      const taskId = `zhipu-split-${Date.now()}`
      addPendingTask({ taskId, prompt, style: style || '', duration })
      setTaskProgress(taskId, { progress: 0, status: 'processing', taskType: 'normal', prompt, style: style || '', duration })

      setTimeout(async () => {
        await tryZhipuSplitFallback(taskId, prompt, style || '', segmentCount, segDuration)
      }, 100)

      return {
        success: true,
        taskId,
        message: `Agnes 不可用，已自动切换到智谱 CogVideoX-Flash 拆分模式（${segmentCount}段×${segDuration}秒，完全免费）`,
      }
    }
  }

  // ===== 第二优先级：Seedance（火山方舟付费模型）=====
  const seedanceKey = process.env.SEEDANCE_API_KEY
  if (seedanceKey) {
    const { segmentCount: sdCount, segDuration: sdDuration } = calculateSplit(targetDuration, 'seedance')
    console.log(`[Video Fallback] Trying Seedance (${sdCount}段×${sdDuration}秒)...`)
    try {
      const seedanceResult = await generateSeedanceVideo({
        prompt: style ? `${prompt}，${style}` : prompt,
        duration: sdDuration,
      })
      if (seedanceResult.success && seedanceResult.taskId) {
        const taskId = `seedance-fallback-${seedanceResult.taskId}`
        addPendingTask({ taskId, prompt, style: style || '', duration: String(sdDuration) })
        setTaskProgress(taskId, { progress: 0, status: 'processing', taskType: 'normal', prompt, style: style || '', duration: String(sdDuration) })
        setTimeout(async () => {
          await pollFreeVideoFallback(taskId, seedanceResult.taskId!, 'seedance', prompt, style, String(sdDuration))
        }, 100)
        return {
          success: true,
          taskId,
          message: `Agnes 不可用，已自动切换到 Seedance 2.0（火山方舟）`,
        }
      }
      console.log(`[Video Fallback] Seedance failed: ${seedanceResult.error}`)
    } catch (e) {
      console.log(`[Video Fallback] Seedance error: ${e}`)
    }
  }

  return {
    success: false,
    error: 'Agnes Video API 不可用，且智谱/Seedance 视频引擎均不可用。请检查 .env 中的 ZHIPU_API_KEY 或 SEEDANCE_API_KEY 配置。',
  }
}

/**
 * 用 LLM 生成剧情分镜：将用户 prompt 拆分为 N 个不同场景描述
 * 每个场景有独立的画面描述，拼接后形成完整故事线
 * 如果 LLM 不可用，回退到原始 prompt + 片段后缀
 */
async function generateStorylineScenes(
  prompt: string,
  style: string,
  segmentCount: number,
): Promise<string[]> {
  const fallback = Array.from({ length: segmentCount }, (_, i) =>
    segmentCount > 1 ? `${prompt}${style ? `，${style}` : ''} (片段${i + 1}/${segmentCount})` : prompt,
  )

  const zhipuApiKey = process.env.ZHIPU_API_KEY
  if (!zhipuApiKey) return fallback

  try {
    const systemPrompt = `你是一位专业的视频分镜师。将用户的视频描述拆分为${segmentCount}个连续的场景，每个场景6秒。
要求：
1. 每个场景有独立的画面描述，但组合起来是一个完整的故事
2. 场景之间有逻辑连贯性（时间推移、视角变化、情节推进）
3. 每个场景描述要具体、有画面感，适合AI视频生成
4. 只返回JSON数组格式，不要其他文字
5. 示例格式：["场景1描述","场景2描述","场景3描述"]`

    const userPrompt = `视频描述：${prompt}${style ? `\n风格要求：${style}` : ''}\n请拆分为${segmentCount}个场景。`

    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${zhipuApiKey}`,
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 800,
      }),
    })

    if (!response.ok) return fallback

    const data = await response.json() as Record<string, any>
    const content = data.choices?.[0]?.message?.content?.trim() || ''

    const jsonMatch = content.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return fallback

    const scenes = JSON.parse(jsonMatch[0]) as string[]
    if (!Array.isArray(scenes) || scenes.length < segmentCount) return fallback

    return scenes.slice(0, segmentCount).map(s => typeof s === 'string' ? s : String(s))
  } catch (error) {
    console.error('[Storyline] LLM generation failed:', error)
    return fallback
  }
}

/**
 * 智谱拆分降级：长视频用智谱 CogVideoX-Flash 并行生成多段，然后拼接
 * 智谱完全免费，优先于万相
 */
async function tryZhipuSplitFallback(
  taskId: string,
  prompt: string,
  style: string,
  segmentCount: number,
  segDuration: number,
  targetDuration?: number,
) {
  updateTaskProgress(taskId, { progress: 3, status: 'processing', message: '正在生成剧情分镜...' })

  const scenePrompts = await generateStorylineScenes(prompt, style, segmentCount)

  const segments: { prompt: string; duration: number }[] = []
  for (let i = 0; i < segmentCount; i++) {
    segments.push({ prompt: scenePrompts[i] || prompt, duration: segDuration })
  }

  updateTaskProgress(taskId, { progress: 5, status: 'processing', message: `剧情分镜完成，开始生成 ${segmentCount} 个片段...` })
  console.log(`[ZhipuSplit] Generating ${segmentCount} segments with storyline...`)

  const segmentResults: Array<{ success: boolean; taskId?: string; error?: string }> = []
  // 智谱 CogVideoX-Flash 免费 API 限流严格，改为串行生成每段间隔 8 秒
  const MAX_PARALLEL = 1

  for (let batch = 0; batch < segmentCount; batch += MAX_PARALLEL) {
    const batchEnd = Math.min(batch + MAX_PARALLEL, segmentCount)
    const batchSegments = segments.slice(batch, batchEnd)
    const batchProgress = 10 + Math.round((batch / segmentCount) * 40)
    updateTaskProgress(taskId, { progress: batchProgress, status: 'processing', message: `生成片段 ${batch + 1}/${segmentCount}...` })

    const batchResults = await Promise.all(
      batchSegments.map(async (seg) => {
        try {
          const result = await generateZhipuVideo({
            prompt: seg.prompt,
            duration: seg.duration,
          })
          return { success: result.success, taskId: result.taskId, error: result.error }
        } catch (e) {
          return { success: false, error: (e as Error).message }
        }
      }),
    )
    segmentResults.push(...batchResults)
    // 每段之间间隔 8 秒，避免触发智谱免费 API 限流
    if (batch + MAX_PARALLEL < segmentCount) {
      updateTaskProgress(taskId, { progress: batchProgress + 5, status: 'processing', message: `等待限流冷却...` })
      await new Promise(r => setTimeout(r, 8000))
    }
  }

  const videoPaths: string[] = []
  updateTaskProgress(taskId, { progress: 50, status: 'processing', message: '等待片段完成...' })

  for (let i = 0; i < segmentResults.length; i++) {
    const segResult = segmentResults[i]
    if (!segResult.success || !segResult.taskId) continue

    let segVideoUrl = ''
    for (let poll = 0; poll < 60; poll++) {
      if (getTaskProgress(taskId)?.status === 'cancelled') {
        removePendingTask(taskId)
        return
      }
      await new Promise(r => setTimeout(r, 4000))
      try {
        const status = await checkZhipuVideoStatus(segResult.taskId)
        if (status.status === 'completed' && status.videoUrl) {
          segVideoUrl = status.videoUrl
          break
        }
        if (status.status === 'failed') break
      } catch {}
    }

    if (segVideoUrl) {
      try {
        const resp = await fetch(segVideoUrl, { redirect: 'follow' })
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer())
          const segPath = path.join(__dirname, `../data/temp_videos/zhipusplit_seg_${taskId}_${i}.mp4`)
          const dir = path.dirname(segPath)
          await fs.promises.mkdir(dir, { recursive: true })
          await fs.promises.writeFile(segPath, buf)
          videoPaths.push(segPath)
        }
      } catch (e) {
        console.error(`[ZhipuSplit] Segment ${i + 1} download failed:`, e)
      }
    }

    updateTaskProgress(taskId, { progress: 50 + Math.round(((i + 1) / segmentResults.length) * 30), status: 'processing', message: `片段 ${i + 1}/${segmentResults.length} 完成` })
  }

  if (videoPaths.length === 0) {
    setTaskProgress(taskId, { progress: 0, status: 'failed', error: '所有片段生成失败', taskType: 'normal' })
    removePendingTask(taskId)
    return
  }

  updateTaskProgress(taskId, { progress: 85, status: 'processing', message: '正在拼接视频片段...' })

  try {
    const finalUrl = await mergeZhipuSegments(videoPaths, taskId, targetDuration)
    if (finalUrl) {
      addToVideoHistory({ prompt, style, duration: targetDuration ? String(targetDuration) : String(segmentCount * segDuration), videoUrl: finalUrl })
      setTaskProgress(taskId, { progress: 100, status: 'completed', videoUrl: finalUrl, taskType: 'normal' })
      removePendingTask(taskId)
    } else {
      setTaskProgress(taskId, { progress: 0, status: 'failed', error: '视频拼接失败', taskType: 'normal' })
      removePendingTask(taskId)
    }
  } catch (e) {
    setTaskProgress(taskId, { progress: 0, status: 'failed', error: `拼接失败: ${(e as Error).message}`, taskType: 'normal' })
    removePendingTask(taskId)
  }

  videoPaths.forEach(p => fs.promises.unlink(p).catch(() => {}))
}

/**
 * 获取 ffmpeg 路径（优先使用项目内置的 @ffmpeg-installer/win32-x64）
 * pnpm 下 @ffmpeg-installer/ffmpeg 的路径解析有问题，直接查找平台包
 */
function getFfmpegPath(): string {
  // 方式 1：直接查找平台包（pnpm 兼容）
  try {
    const platform = `${process.platform}-${process.arch}`
    const pkgPath = path.join(__dirname, `../../node_modules/@ffmpeg-installer/${platform}`)
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const exePath = path.join(pkgPath, exeName)
    if (fs.existsSync(exePath)) {
      console.log('[ffmpeg] Using bundled ffmpeg:', exePath)
      return exePath
    }
  } catch {}

  // 方式 2：通过 @ffmpeg-installer/ffmpeg 包
  try {
    const installer = require('@ffmpeg-installer/ffmpeg')
    if (installer.path && fs.existsSync(installer.path)) {
      console.log('[ffmpeg] Using installer path:', installer.path)
      return installer.path
    }
  } catch {}

  // 方式 3：递归搜索 node_modules
  try {
    const searchDir = path.join(__dirname, '../../node_modules/@ffmpeg-installer')
    if (fs.existsSync(searchDir)) {
      const dirs = fs.readdirSync(searchDir, { withFileTypes: true })
      for (const d of dirs) {
        if (d.isDirectory() && d.name.startsWith('win')) {
          const exe = path.join(searchDir, d.name, 'ffmpeg.exe')
          if (fs.existsSync(exe)) {
            console.log('[ffmpeg] Found via search:', exe)
            return exe
          }
        }
      }
    }
  } catch {}

  console.warn('[ffmpeg] Not found, falling back to system PATH')
  return 'ffmpeg'
}

/** ffmpeg 拼接智谱视频片段，可选裁剪到目标时长 */
async function mergeZhipuSegments(segmentPaths: string[], taskId: string, targetDuration?: number): Promise<string | null> {
  const outputPath = path.join(__dirname, `../public/videos/zhipusplit_${taskId}.mp4`)
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })

  if (segmentPaths.length === 1) {
    if (targetDuration) {
      return trimVideo(segmentPaths[0], outputPath, targetDuration, taskId)
    }
    await fs.promises.copyFile(segmentPaths[0], outputPath)
    return `/videos/zhipusplit_${taskId}.mp4`
  }

  const ffmpegPath = getFfmpegPath()
  const { spawn } = await import('child_process')

  const tempDir = path.join(__dirname, '../data/temp_videos')
  await fs.promises.mkdir(tempDir, { recursive: true })

  const listPath = path.join(tempDir, `zhipusplit_list_${taskId}.txt`)
  const listContent = segmentPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n')
  await fs.promises.writeFile(listPath, listContent)

  const concatOutput = targetDuration
    ? path.join(tempDir, `zhipusplit_concat_${taskId}.mp4`)
    : outputPath

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-y', concatOutput])
    proc.stderr?.on('data', (d: Buffer) => console.log(`[ffmpeg] ${d.toString().substring(0, 200)}`))
    proc.on('close', async (code: number) => {
      fs.promises.unlink(listPath).catch(() => {})
      console.log(`[ffmpeg] concat exit code ${code}`)

      if (code !== 0) {
        resolve(null)
        return
      }

      if (!targetDuration) {
        resolve(`/videos/zhipusplit_${taskId}.mp4`)
        return
      }

      const trimmedUrl = await trimVideo(concatOutput, outputPath, targetDuration, taskId)
      fs.promises.unlink(concatOutput).catch(() => {})
      resolve(trimmedUrl)
    })
    proc.on('error', (e) => {
      console.error(`[ffmpeg] spawn error:`, e.message)
      fs.promises.unlink(listPath).catch(() => {})
      fs.promises.copyFile(segmentPaths[0], outputPath).then(() => {
        resolve(`/videos/zhipusplit_${taskId}.mp4`)
      }).catch(() => resolve(null))
    })
    setTimeout(() => { proc.kill(); resolve(null) }, 60000)
  })
}

/** ffmpeg 裁剪视频到指定时长 */
async function trimVideo(inputPath: string, outputPath: string, targetDuration: number, taskId: string): Promise<string | null> {
  const ffmpegPath = getFfmpegPath()
  const { spawn } = await import('child_process')

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', inputPath, '-t', String(targetDuration), '-c', 'copy', '-y', outputPath])
    proc.stderr?.on('data', (d: Buffer) => console.log(`[ffmpeg trim] ${d.toString().substring(0, 200)}`))
    proc.on('close', (code: number) => {
      console.log(`[ffmpeg trim] exit code ${code}`)
      resolve(code === 0 ? `/videos/zhipusplit_${taskId}.mp4` : null)
    })
    proc.on('error', (e) => {
      console.error(`[ffmpeg trim] spawn error:`, e.message)
      resolve(null)
    })
    setTimeout(() => { proc.kill(); resolve(null) }, 30000)
  })
}

/**
 * 万相拆分降级：并行生成多段视频，然后 ffmpeg 拼接
 * 相比 Agnes 拆分（串行逐段生成），万相免费 API 支持更高并发
 */
async function tryWanxSplitFallback(
  taskId: string,
  prompt: string,
  style: string,
  segmentCount: number,
  segDuration: number,
  targetDuration?: number,
) {
  updateTaskProgress(taskId, { progress: 3, status: 'processing', message: '正在生成剧情分镜...' })

  const scenePrompts = await generateStorylineScenes(prompt, style, segmentCount)

  const segments: { prompt: string; duration: number }[] = []
  for (let i = 0; i < segmentCount; i++) {
    segments.push({ prompt: scenePrompts[i] || prompt, duration: segDuration })
  }

  updateTaskProgress(taskId, { progress: 5, status: 'processing', message: `剧情分镜完成，开始生成 ${segmentCount} 个片段...` })
  console.log(`[WanxSplit] Generating ${segmentCount} segments with storyline...`)

  // 并行生成所有片段
  const segmentResults: Array<{ success: boolean; taskId?: string; error?: string }> = []
  const MAX_PARALLEL = 2 // 万相 API 并发限制

  for (let batch = 0; batch < segmentCount; batch += MAX_PARALLEL) {
    const batchEnd = Math.min(batch + MAX_PARALLEL, segmentCount)
    const batchSegments = segments.slice(batch, batchEnd)
    const batchProgress = 10 + Math.round((batch / segmentCount) * 40)

    updateTaskProgress(taskId, { progress: batchProgress, status: 'processing', message: `生成片段 ${batch + 1}-${batchEnd}/${segmentCount}...` })

    const batchResults = await Promise.all(
      batchSegments.map(async (seg, idx) => {
        const segIdx = batch + idx
        try {
          const result = await generateWanxVideo({
            prompt: seg.prompt,
            duration: seg.duration,
          })
          return { success: result.success, taskId: result.taskId, error: result.error }
        } catch (e) {
          return { success: false, error: (e as Error).message }
        }
      }),
    )

    segmentResults.push(...batchResults)

    // 批次间短暂间隔避免限流
    if (batch + MAX_PARALLEL < segmentCount) {
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  // 等待所有片段完成
  const videoPaths: string[] = []
  const failedCount = segmentResults.filter(r => !r.success).length

  updateTaskProgress(taskId, { progress: 50, status: 'processing', message: `等待 ${segmentResults.length - failedCount} 个片段完成...` })

  for (let i = 0; i < segmentResults.length; i++) {
    const segResult = segmentResults[i]
    if (!segResult.success || !segResult.taskId) continue

    // 轮询该片段状态
    let segVideoUrl = ''
    for (let poll = 0; poll < 60; poll++) {
      if (getTaskProgress(taskId)?.status === 'cancelled') {
        console.log(`[WanxSplit] Cancelled during segment polling`)
        removePendingTask(taskId)
        return
      }
      await new Promise(r => setTimeout(r, 4000))
      try {
        const status = await checkWanxVideoStatus(segResult.taskId)
        if (status.status === 'completed' && status.videoUrl) {
          segVideoUrl = status.videoUrl
          break
        }
        if (status.status === 'failed') break
      } catch {}
    }

    if (segVideoUrl) {
      // 下载并保存片段
      try {
        const resp = await fetch(segVideoUrl, { redirect: 'follow' })
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer())
          const segPath = path.join(__dirname, `../data/temp_videos/wanxsplit_seg_${taskId}_${i}.mp4`)
          const dir = path.dirname(segPath)
          await fs.promises.mkdir(dir, { recursive: true })
          await fs.promises.writeFile(segPath, buf)
          videoPaths.push(segPath)
        }
      } catch (e) {
        console.error(`[WanxSplit] Segment ${i + 1} download failed:`, e)
      }
    }

    const segProgress = 50 + Math.round(((i + 1) / segmentResults.length) * 30)
    updateTaskProgress(taskId, { progress: segProgress, status: 'processing', message: `片段 ${i + 1}/${segmentResults.length} 完成` })
  }

  if (videoPaths.length === 0) {
    setTaskProgress(taskId, { progress: 0, status: 'failed', error: '所有片段生成失败', taskType: 'normal' })
    removePendingTask(taskId)
    return
  }

  // 拼接片段
  updateTaskProgress(taskId, { progress: 85, status: 'processing', message: '正在拼接视频片段...' })

  try {
    const finalUrl = await mergeWanxSegments(videoPaths, taskId, targetDuration)
    if (finalUrl) {
      addToVideoHistory({ prompt, style, duration: targetDuration ? String(targetDuration) : String(segmentCount * segDuration), videoUrl: finalUrl })
      setTaskProgress(taskId, { progress: 100, status: 'completed', videoUrl: finalUrl, taskType: 'normal' })
      removePendingTask(taskId)
      console.log(`[WanxSplit] Complete: ${finalUrl} (${videoPaths.length}/${segmentCount} segments)`)
    } else {
      setTaskProgress(taskId, { progress: 0, status: 'failed', error: '视频拼接失败', taskType: 'normal' })
      removePendingTask(taskId)
    }
  } catch (e) {
    setTaskProgress(taskId, { progress: 0, status: 'failed', error: `拼接失败: ${(e as Error).message}`, taskType: 'normal' })
    removePendingTask(taskId)
  }

  // 清理临时文件
  videoPaths.forEach(p => fs.promises.unlink(p).catch(() => {}))
}

/**
 * 使用 ffmpeg concat 拼接万相视频片段
 */
async function mergeWanxSegments(segmentPaths: string[], taskId: string, targetDuration?: number): Promise<string | null> {
  const outputPath = path.join(__dirname, `../public/videos/wanxsplit_${taskId}.mp4`)
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })

  if (segmentPaths.length === 1) {
    if (targetDuration) {
      return trimVideo(segmentPaths[0], outputPath, targetDuration, taskId)
    }
    await fs.promises.copyFile(segmentPaths[0], outputPath)
    return `/videos/wanxsplit_${taskId}.mp4`
  }

  const ffmpegPath = getFfmpegPath()
  const { spawn } = await import('child_process')

  const tempDir = path.join(__dirname, '../data/temp_videos')
  await fs.promises.mkdir(tempDir, { recursive: true })

  const listPath = path.join(tempDir, `wanxsplit_list_${taskId}.txt`)
  const listContent = segmentPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n')
  await fs.promises.writeFile(listPath, listContent)

  const concatOutput = targetDuration
    ? path.join(tempDir, `wanxsplit_concat_${taskId}.mp4`)
    : outputPath

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, [
      '-f', 'concat', '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      '-y',
      concatOutput,
    ])

    proc.on('close', async (code: number) => {
      fs.promises.unlink(listPath).catch(() => {})
      if (code !== 0) {
        resolve(null)
        return
      }

      if (!targetDuration) {
        resolve(`/videos/wanxsplit_${taskId}.mp4`)
        return
      }

      const trimmedUrl = await trimVideo(concatOutput, outputPath, targetDuration, taskId)
      fs.promises.unlink(concatOutput).catch(() => {})
      resolve(trimmedUrl)
    })

    proc.on('error', () => {
      fs.promises.unlink(listPath).catch(() => {})
      resolve(null)
    })

    // 30 秒超时
    setTimeout(() => {
      proc.kill()
      resolve(null)
    }, 30000)
  })
}

/** 后台轮询免费视频降级任务 */
async function pollFreeVideoFallback(
  taskId: string,
  providerTaskId: string,
  model: 'cogvideox' | 'wanx-video' | 'seedance',
  prompt: string,
  style: string,
  duration: string,
) {
  const maxPolls = 180 // 最多 180 次，4秒间隔 ≈ 12 分钟
  for (let i = 0; i < maxPolls; i++) {
    // 检查取消
    if (getTaskProgress(taskId)?.status === 'cancelled') {
      console.log(`[Fallback Poll] Task ${taskId} cancelled`)
      removePendingTask(taskId)
      return
    }

    await new Promise(r => setTimeout(r, 4000))

    try {
      const status = model === 'cogvideox'
        ? await checkZhipuVideoStatus(providerTaskId)
        : model === 'seedance'
          ? await checkSeedanceStatus(providerTaskId)
          : await checkWanxVideoStatus(providerTaskId)

      if (status.status === 'completed' && status.videoUrl) {
        // 下载视频
        const videoResp = await fetch(status.videoUrl, { redirect: 'follow' })
        if (!videoResp.ok) throw new Error(`下载失败: HTTP ${videoResp.status}`)
        const arrayBuffer = await videoResp.arrayBuffer()
        const buffer = Buffer.from(arrayBuffer)
        const imagesDir = path.join(__dirname, '../public/images')
        await fs.promises.mkdir(imagesDir, { recursive: true })
        const videoFileName = `${Date.now()}.mp4`
        const videoPath = path.join(imagesDir, videoFileName)
        await fs.promises.writeFile(videoPath, buffer)
        const savedUrl = `/images/${videoFileName}`

        addToVideoHistory({ prompt, style, duration, videoUrl: savedUrl })
        setTaskProgress(taskId, { progress: 100, status: 'completed', videoUrl: savedUrl, taskType: 'normal' })
        removePendingTask(taskId)
        console.log(`[Fallback Poll] ${model} completed: ${savedUrl}`)
        return
      }

      if (status.status === 'failed') {
        setTaskProgress(taskId, { progress: 0, status: 'failed', error: status.error || `${model} 视频生成失败`, taskType: 'normal' })
        removePendingTask(taskId)
        return
      }

      // 更新进度
      updateTaskProgress(taskId, { progress: Math.min(10 + i * 0.5, 90) })
    } catch (error) {
      console.error(`[Fallback Poll] Error: ${error}`)
    }
  }

  // 超时
  setTaskProgress(taskId, { progress: 0, status: 'failed', error: `${model} 视频生成超时`, taskType: 'normal' })
  removePendingTask(taskId)
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, style, duration, split = true, resolution } = req.body

    if (!prompt) {
      res.status(400).json({
        success: false,
        error: 'Prompt is required',
      })
      return
    }

    console.log(`Video generate request: prompt=${prompt}, style=${style}, duration=${duration}, split=${split}, resolution=${resolution || 'auto'}`)

    const result = await createVideoTaskAsync(prompt, style || '', duration || '10', split, (req as any).user?.userId, resolution)
    res.json(result)
  } catch (error) {
    console.error('Video route error:', error)
    res.status(500).json({
      success: false,
      error: `Server internal error: ${(error as Error).message}`,
    })
  }
})

router.post('/modify', async (req: Request, res: Response): Promise<void> => {
  try {
    const { originalVideoUrl, originalPrompt, modifyInstruction, style, duration } = req.body

    if (!originalPrompt || !modifyInstruction) {
      res.status(400).json({
        success: false,
        error: 'originalPrompt and modifyInstruction are required',
      })
      return
    }

    console.log(`Video modify request: original=${originalPrompt.substring(0, 30)}..., modify=${modifyInstruction}`)

    const systemPrompt = '你是一位专业的视频修改助手。根据用户的原始视频描述和修改需求，生成新的视频描述。要求：1. 保留原始描述的核心内容和场景；2. 根据修改需求调整相应的部分；3. 生成的描述要完整、详细、自然，适合视频生成；4. 只返回新的视频描述，不要加引号或其他修饰。'
    const userPrompt = `原始视频描述：${originalPrompt}\n修改需求：${modifyInstruction}\n请生成新的视频描述。`

    let newPrompt = ''
    const zhipuApiKey = process.env.ZHIPU_API_KEY

    if (zhipuApiKey) {
      try {
        const llmResponse = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${zhipuApiKey}`,
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
        })

        if (llmResponse.ok) {
          const data = await llmResponse.json() as Record<string, any>
          newPrompt = data.choices?.[0]?.message?.content?.trim() || ''
        }
      } catch (error) {
        console.error('[Video Modify] LLM call failed:', error)
      }
    }

    if (!newPrompt) {
      newPrompt = `${originalPrompt}，${modifyInstruction}`
    }

    console.log(`[Video Modify] New prompt: ${newPrompt.substring(0, 50)}...`)

    // 异步创建视频任务（与 /api/video/ 一致），立即返回 taskId 供前端轮询
    // 避免同步等待视频生成导致 HTTP 请求超时返回空响应
    const result = await createVideoTaskAsync(newPrompt, style || '', duration || '10', true, (req as any).user?.userId)
    res.json({ ...result, newPrompt })
  } catch (error) {
    console.error('Video modify route error:', error)
    res.status(500).json({
      success: false,
      error: `Server internal error: ${(error as Error).message}`,
    })
  }
})

// 视频拼接：用户选择多个已生成视频进行手动拼接
router.post('/merge', async (req: Request, res: Response): Promise<void> => {
  try {
    const { videoUrls } = req.body as { videoUrls: string[] }

    if (!Array.isArray(videoUrls) || videoUrls.length < 2) {
      res.status(400).json({
        success: false,
        error: '请至少选择两个视频进行拼接',
      })
      return
    }

    console.log(`[Video Merge] Merging ${videoUrls.length} videos: ${JSON.stringify(videoUrls)}`)

    const taskId = `merge_${Date.now()}`
    setTaskProgress(taskId, { progress: 0, status: 'processing', taskType: 'merge' })

    res.json({
      success: true,
      taskId,
      message: `正在拼接 ${videoUrls.length} 个视频`,
    })

    // 后台执行拼接
    setTimeout(async () => {
      try {
        updateTaskProgress(taskId, { status: 'processing', progress: 10 })

        const tempDir = path.join(__dirname, '../data/temp_videos')
        await fs.promises.mkdir(tempDir, { recursive: true })

        const segmentPaths: string[] = []
        for (let i = 0; i < videoUrls.length; i++) {
          const videoUrl = videoUrls[i]
          const localPath = path.join(__dirname, '..', 'public', videoUrl.replace(/^\//, ''))

          // 优先使用本地文件，否则下载
          if (fs.existsSync(localPath)) {
            const tempPath = path.join(tempDir, `merge_segment_${i + 1}.mp4`)
            await fs.promises.copyFile(localPath, tempPath)
            segmentPaths.push(tempPath)
          } else {
            const tempPath = path.join(tempDir, `merge_segment_${i + 1}.mp4`)
            const serverPort = process.env.PORT || '3001'
            const downloadResp = await fetch(`http://localhost:${serverPort}${videoUrl}`)
            if (!downloadResp.ok) {
              throw new Error(`下载视频失败: HTTP ${downloadResp.status}`)
            }
            const arrayBuffer = await downloadResp.arrayBuffer()
            await fs.promises.writeFile(tempPath, Buffer.from(arrayBuffer))
            segmentPaths.push(tempPath)
          }

          updateTaskProgress(taskId, { progress: 10 + Math.round(((i + 1) / videoUrls.length) * 40) })
        }

        updateTaskProgress(taskId, { progress: 60 })

        // 使用 ffmpeg 拼接
        const { default: ffmpegLib } = await import('fluent-ffmpeg')
        const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg')
        const ffprobeInstaller = await import('@ffprobe-installer/ffprobe')
        ffmpegLib.setFfmpegPath(ffmpegInstaller.path)
        ffmpegLib.setFfprobePath(ffprobeInstaller.path)

        const outputFilename = `merged_video_${Date.now()}.mp4`
        const outputPath = path.join(__dirname, '../public/images', outputFilename)

        await new Promise<void>((resolve, reject) => {
          const command = ffmpegLib()
          segmentPaths.forEach(p => command.input(p))
          command
            .on('end', () => resolve())
            .on('error', (err: Error) => reject(err))
            .mergeToFile(outputPath, tempDir)
        })

        // 清理临时文件
        segmentPaths.forEach(p => {
          try { fs.unlinkSync(p) } catch { }
        })

        setTaskProgress(taskId, {
          progress: 100,
          status: 'completed',
          videoUrl: `/images/${outputFilename}`,
          taskType: 'merge',
        })

        addToVideoHistory({
          prompt: `手动拼接 ${videoUrls.length} 个视频`,
          style: '',
          duration: `${videoUrls.length}段拼接`,
          videoUrl: `/images/${outputFilename}`,
        })

        console.log(`[Video Merge] Complete: /images/${outputFilename}`)
      } catch (error) {
        console.error(`[Video Merge] Error: ${error}`)
        setTaskProgress(taskId, {
          progress: 0,
          status: 'failed',
          error: (error as Error).message,
          taskType: 'merge',
        })
      }
    }, 100)
  } catch (error) {
    console.error('Video merge route error:', error)
    res.status(500).json({
      success: false,
      error: `Server internal error: ${(error as Error).message}`,
    })
  }
})

// ========== 免费视频生成 (智谱 CogVideoX-Flash + 通义万相) ==========

router.post('/free', async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, model, imageUrl, imageUrls, duration, style, resolution } = req.body as {
      prompt: string
      model: string
      imageUrl?: string
      imageUrls?: string[]
      duration?: number
      style?: string
      resolution?: string
    }

    if (!prompt || !model) {
      res.status(400).json({ success: false, error: 'prompt and model are required' })
      return
    }

    const validModels = ['cogvideox', 'wanx-video', 'seedance']
    if (!validModels.includes(model)) {
      res.status(400).json({ success: false, error: `model must be one of: ${validModels.join(', ')}` })
      return
    }

    const totalDuration = parseInt(duration?.toString() || '10')

    // 统一拆分计算
    const { segmentCount, segDuration } = calculateSplit(totalDuration, model)

    // 需要拆分的任务
    if (segmentCount > 1) {
      const masterTaskId = `${model}-split-${Date.now()}`
      setTaskProgress(masterTaskId, { status: 'processing', progress: 3, message: `自动拆分为${segmentCount}段×${segDuration}秒...` })

      res.json({
        success: true,
        taskId: masterTaskId,
        message: `${model} 任务已拆分为 ${segmentCount} 段（每段${segDuration}秒），正在后台生成并拼接...`,
      })

      // 后台执行：逐段生成 → 拼接
      if (model === 'seedance') {
        const lastSegDuration = totalDuration % segDuration || segDuration
        pollSeedanceSplitTask(masterTaskId, prompt, style || '', totalDuration, segmentCount, segDuration, lastSegDuration, imageUrl || imageUrls?.[0], resolution)
      } else if (model === 'cogvideox') {
        tryZhipuSplitFallback(masterTaskId, prompt, style || '', segmentCount, segDuration, totalDuration)
      } else if (model === 'wanx-video') {
        tryWanxSplitFallback(masterTaskId, prompt, style || '', segmentCount, segDuration, totalDuration)
      }
      return
    }

    // 单段任务
    const result = await createFreeVideoTask({
      model: model as 'cogvideox' | 'wanx-video' | 'seedance',
      prompt, imageUrl, imageUrls, duration, style, resolution,
    });

    if (!result.success || !result.taskId) {
      res.status(500).json({ success: false, error: result.error || '任务创建失败' })
      return
    }

    // 注册到进度管理
    const taskId = result.taskId
    setTaskProgress(taskId, { status: 'processing', progress: 5, message: '任务已提交' })

    // 后台轮询
    pollFreeVideoTask(taskId, model as 'cogvideox' | 'wanx-video' | 'seedance', prompt, style || '', duration?.toString() || '10')

    res.json({
      success: true,
      taskId,
      message: `免费视频任务已创建 (${model})，正在后台生成...`,
    })
  } catch (error) {
    console.error('[FreeVideo] Route error:', error)
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// 查询免费视频任务状态
router.get('/free/status/:taskId', async (req: Request, res: Response): Promise<void> => {
  const { taskId } = req.params
  const model = req.query.model as string || 'cogvideox'

  // 优先查后端缓存
  const progress = getTaskProgress(taskId)
  if (progress && progress.status !== 'processing') {
    res.json({
      success: progress.status !== 'failed',
      status: progress.status,
      progress: progress.progress || 0,
      videoUrl: progress.resultUrl,
      error: progress.error,
    })
    return
  }

  // 缓存中还是 processing，实际查询 API
  try {
    const result = model === 'wanx-video'
      ? await checkWanxVideoStatus(taskId)
      : await checkZhipuVideoStatus(taskId)

    // 更新缓存
    if (result.status === 'completed') {
      updateTaskProgress(taskId, { progress: 100, status: 'completed', resultUrl: result.videoUrl })
    } else if (result.status === 'failed') {
      updateTaskProgress(taskId, { progress: 0, status: 'failed', error: result.error })
    }

    res.json({
      success: result.status !== 'failed',
      status: result.status,
      progress: progress?.progress || 10,
      videoUrl: result.videoUrl,
      error: result.error,
    })
  } catch (error) {
    res.json({
      success: true,
      status: 'processing',
      progress: progress?.progress || 10,
    })
  }
})

/**
 * Seedance 分段生成 + 拼接
 * 场景: 用户请求 30s 视频 → 自动拆为 2×15s → 生成 → 拼接 → 交付
 */
async function pollSeedanceSplitTask(
  masterTaskId: string,
  prompt: string,
  style: string,
  totalDuration: number,
  segCount: number,
  segMax: number,
  lastSegDuration: number,
  imageUrl?: string,
  resolution?: string,
) {
  const segmentTaskIds: string[] = [];
  const segmentVideoPaths: string[] = [];

  try {
    // 逐段提交生成任务（prompt 增强连续性）
    for (let i = 0; i < segCount; i++) {
      const segDuration = (i === segCount - 1) ? lastSegDuration : segMax;
      let segPrompt: string;
      
      if (segCount === 1) {
        segPrompt = prompt;
      } else if (i === 0) {
        segPrompt = `${prompt} - opening scene, establishing the setting and mood, smooth camera movement, cinematic`;
      } else if (i === segCount - 1) {
        segPrompt = `${prompt} - final closing scene, resolution and completion, smooth fade out, natural ending`;
      } else {
        segPrompt = `${prompt} - continuing scene ${i + 1} of ${segCount}, naturally progressing from previous, consistent lighting and color`;
      }

      console.log(`[SeedanceSplit] Segment ${i + 1}/${segCount} (${segDuration}s)`, segPrompt.substring(0, 60));
      updateTaskProgress(masterTaskId, {
        progress: Math.round(5 + (i / segCount) * 20),
        status: 'processing',
        message: `生成第 ${i + 1}/${segCount} 段 (${segDuration}秒)...`,
      });

      const result = await createFreeVideoTask({
        model: 'seedance',
        prompt: segPrompt,
        duration: segDuration,
        style,
        resolution,
        ...(imageUrl && i === 0 ? { imageUrl } : {}), // 仅首段带参考图
      });

      if (!result.success || !result.taskId) {
        updateTaskProgress(masterTaskId, {
          progress: 0, status: 'failed',
          error: `第 ${i + 1} 段创建失败: ${result.error}`,
        });
        return;
      }
      segmentTaskIds.push(result.taskId);
    }

    // 等待所有段完成
    for (let i = 0; i < segmentTaskIds.length; i++) {
      const tid = segmentTaskIds[i];
      console.log(`[SeedanceSplit] Polling segment ${i + 1}: ${tid}`);

      let segmentDone = false;
      for (let p = 0; p < 300; p++) { // 每段最多等 15 分钟
        await new Promise(r => setTimeout(r, 4000));
        try {
          const status = await checkFreeVideoStatus('seedance', tid);
          if (status.status === 'completed' && status.videoUrl) {
            const buffer = await downloadFreeVideo(status.videoUrl);
            const segPath = path.join(__dirname, `../data/temp_videos/seedance_seg_${masterTaskId}_${i}.mp4`);
            const dir = path.dirname(segPath);
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(segPath, buffer);
            segmentVideoPaths.push(segPath);
            segmentDone = true;

            const overallProgress = 25 + Math.round(((i + 1) / segCount) * 50);
            updateTaskProgress(masterTaskId, {
              progress: overallProgress,
              message: `第 ${i + 1}/${segCount} 段完成`,
            });
            break;
          }
          if (status.status === 'failed') {
            updateTaskProgress(masterTaskId, { status: 'failed', error: `第 ${i + 1} 段失败: ${status.error}` });
            return;
          }
        } catch (e) {
          console.error(`[SeedanceSplit] Poll error seg ${i + 1}:`, e);
        }
      }
      if (!segmentDone) {
        updateTaskProgress(masterTaskId, { status: 'failed', error: `第 ${i + 1} 段超时` });
        return;
      }
    }

    // 拼接所有段
    updateTaskProgress(masterTaskId, { progress: 80, message: '拼接视频片段...' });
    const mergedPath = path.join(__dirname, `../public/videos/seedance_merged_${masterTaskId}.mp4`);
    const mergedDir = path.dirname(mergedPath);
    await fs.promises.mkdir(mergedDir, { recursive: true });

    const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).default.path;
    const { spawnSync } = await import('child_process');

    // 单段直接复制，多段用 xfade 交叉淡入淡出转场
    if (segmentVideoPaths.length === 1) {
      await fs.promises.copyFile(segmentVideoPaths[0], mergedPath);
    } else {
      const inputs: string[] = [];
      const filters: string[] = [];
      const XFD = 1; // 1 秒交叉淡化
      let prev = '';

      for (let i = 0; i < segmentVideoPaths.length; i++) {
        inputs.push('-i', segmentVideoPaths[i]);
      }

      for (let i = 0; i < segmentVideoPaths.length - 1; i++) {
        const a = i === 0 ? `[${i}:v]` : prev;
        const b = `[${i + 1}:v]`;
        const off = segMax * (i + 1) - XFD;
        prev = `[t${i}]`;
        filters.push(`${a}${b}xfade=transition=fade:duration=${XFD}:offset=${off}${prev}`);
      }

      const ffmpeg = spawnSync(ffmpegPath, [
        ...inputs,
        '-filter_complex', filters.join(';'),
        '-map', `${prev}`,
        '-c:v', 'libx264', '-c:a', 'aac',
        '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '23', '-r', '30',
        '-movflags', '+faststart', '-y', mergedPath
      ], { timeout: 300000 });

      if (ffmpeg.status !== 0) {
        console.error('[SeedanceSplit] FFmpeg xfade failed:', ffmpeg.stderr?.toString().substring(0, 300));
        updateTaskProgress(masterTaskId, { status: 'failed', error: '视频拼接失败' });
        return;
      }
    }

    // 清理临时文件
    segmentVideoPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });

    const finalUrl = `/videos/seedance_merged_${masterTaskId}.mp4`;
    const durLabel = `${segCount}段×${segMax}秒=${totalDuration}秒 (Seedance)`;

    addToVideoHistory({ prompt, style, duration: durLabel, videoUrl: finalUrl });
    updateTaskProgress(masterTaskId, { progress: 100, status: 'completed', resultUrl: finalUrl });
    console.log(`[SeedanceSplit] Complete: ${finalUrl} (${segCount} segments)`);

  } catch (error) {
    console.error('[SeedanceSplit] Exception:', error);
    updateTaskProgress(masterTaskId, { status: 'failed', error: (error as Error).message });
    segmentVideoPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
  }
}

/** 后台轮询免费视频任务 */
async function pollFreeVideoTask(taskId: string, model: 'cogvideox' | 'wanx-video' | 'seedance', prompt: string, style: string, duration: string) {
  await new Promise(r => setTimeout(r, 5000)) // 等待 5 秒后再开始轮询

  for (let i = 0; i < 200; i++) {
    await new Promise(r => setTimeout(r, 3000))

    try {
      const status = await checkFreeVideoStatus(model, taskId)

      updateTaskProgress(taskId, {
        progress: Math.min(10 + i, 95),
        status: status.status === 'processing' ? 'processing' : status.status === 'completed' ? 'completed' : 'failed',
      })

      if (status.status === 'completed' && status.videoUrl) {
        // 下载视频
        const videoBuffer = await downloadFreeVideo(status.videoUrl)
        const fileName = `free-video-${taskId}.mp4`
        const savePath = path.join(__dirname, '../public/videos', fileName)
        const dir = path.dirname(savePath)
        await fs.promises.mkdir(dir, { recursive: true })
        await fs.promises.writeFile(savePath, videoBuffer)

        const videoUrl = `/videos/${fileName}`
        updateTaskProgress(taskId, { progress: 100, status: 'completed', resultUrl: videoUrl })

        addToVideoHistory({ prompt, style, duration: `${duration}秒 (${model})`, videoUrl })
        console.log(`[FreeVideo] Completed: ${taskId} -> ${videoUrl}`)
        return
      }

      if (status.status === 'failed') {
        updateTaskProgress(taskId, { status: 'failed', error: status.error || '视频生成失败' })
        console.log(`[FreeVideo] Failed: ${taskId} - ${status.error}`)
        return
      }
    } catch (e) {
      console.error(`[FreeVideo] Poll error for ${taskId}:`, e)
    }
  }
}

async function downloadFreeVideo(url: string): Promise<Buffer> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120000)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' } as any)
    if (!response.ok) throw new Error(`下载失败: ${response.status}`)
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } finally {
    clearTimeout(timeoutId)
  }
}

// ========== 分镜头脚本生成视频 ==========

router.post('/storyboard', async (req: Request, res: Response): Promise<void> => {
  try {
    const { scenes, style, imageUrl, resolution } = req.body as {
      scenes: Array<{ prompt: string; duration?: number; description?: string }>
      style?: string
      imageUrl?: string
      resolution?: string
    }

    if (!scenes || scenes.length === 0) {
      res.status(400).json({ success: false, error: 'scenes array is required' })
      return
    }

    const masterTaskId = `storyboard-${Date.now()}`;
    const totalScenes = scenes.length;
    const DEFAULT_DUR = 10;

    setTaskProgress(masterTaskId, {
      status: 'processing',
      progress: 3,
      message: `分镜头模式：共 ${totalScenes} 个场景，正在生成...`,
    });

    res.json({
      success: true,
      taskId: masterTaskId,
      message: `分镜头任务已创建（${totalScenes} 个场景），正在逐场景生成并拼接...`,
    });

    // 后台执行
    pollStoryboardTask(masterTaskId, scenes, style || 'cinematic', DEFAULT_DUR, imageUrl, resolution);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

async function pollStoryboardTask(
  masterTaskId: string,
  scenes: Array<{ prompt: string; duration?: number; description?: string }>,
  style: string,
  defaultDur: number,
  imageUrl?: string,
  resolution?: string,
) {
  const segTaskIds: string[] = [];
  const segPaths: string[] = [];

  try {
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const segDur = Math.min(parseInt(String(scene.duration || defaultDur)), 15);

      updateTaskProgress(masterTaskId, {
        progress: Math.round(5 + (i / scenes.length) * 20),
        status: 'processing',
        message: scene.description
          ? `场景 ${i + 1}/${scenes.length}: ${scene.description}`
          : `生成场景 ${i + 1}/${scenes.length}...`,
      });

      const result = await createFreeVideoTask({
        model: 'seedance',
        prompt: `${scene.prompt}, ${style} style, cinematic quality`,
        duration: segDur,
        style,
        ...(resolution ? { resolution } : {}),
        ...(imageUrl && i === 0 ? { imageUrl } : {}),
      });

      if (!result.success || !result.taskId) {
        updateTaskProgress(masterTaskId, { status: 'failed', error: `场景 ${i + 1} 创建失败` });
        return;
      }
      segTaskIds.push(result.taskId);
    }

    // 等待所有场景完成
    for (let i = 0; i < segTaskIds.length; i++) {
      let done = false;
      for (let p = 0; p < 300; p++) {
        await new Promise(r => setTimeout(r, 4000));
        try {
          const status = await checkFreeVideoStatus('seedance', segTaskIds[i]);
          if (status.status === 'completed' && status.videoUrl) {
            const buffer = await downloadFreeVideo(status.videoUrl);
            const sp = path.join(__dirname, `../data/temp_videos/story_seg_${masterTaskId}_${i}.mp4`);
            const dir = path.dirname(sp);
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(sp, buffer);
            segPaths.push(sp);
            done = true;

            updateTaskProgress(masterTaskId, {
              progress: 25 + Math.round(((i + 1) / scenes.length) * 55),
              message: `场景 ${i + 1}/${scenes.length} 完成`,
            });
            break;
          }
          if (status.status === 'failed') {
            updateTaskProgress(masterTaskId, { status: 'failed', error: `场景 ${i + 1} 失败` });
            return;
          }
        } catch {}
      }
      if (!done) {
        updateTaskProgress(masterTaskId, { status: 'failed', error: `场景 ${i + 1} 超时` });
        return;
      }
    }

    // 交叉淡入淡出拼接
    updateTaskProgress(masterTaskId, { progress: 85, message: '拼接分镜头（交叉淡入淡出）...' });
    const mergedPath = path.join(__dirname, `../public/videos/storyboard_${masterTaskId}.mp4`);
    const mergedDir = path.dirname(mergedPath);
    await fs.promises.mkdir(mergedDir, { recursive: true });

    const ffmpegPath = (await import('@ffmpeg-installer/ffmpeg')).default.path;
    const { spawnSync } = await import('child_process');

    if (segPaths.length === 1) {
      fs.copyFileSync(segPaths[0], mergedPath);
    } else {
      const inputs: string[] = [];
      const filters: string[] = [];
      const XFD = 1; let prev = '';

      for (let i = 0; i < segPaths.length; i++) {
        inputs.push('-i', segPaths[i]);
      }

      for (let i = 0; i < segPaths.length - 1; i++) {
        const a = i === 0 ? `[${i}:v]` : prev;
        const b = `[${i + 1}:v]`;
        const off = defaultDur * (i + 1) - XFD;
        prev = `[t${i}]`;
        filters.push(`${a}${b}xfade=transition=fade:duration=${XFD}:offset=${off}${prev}`);
      }

      const ffmpeg = spawnSync(ffmpegPath, [
        ...inputs,
        '-filter_complex', filters.join(';'),
        '-map', `${prev}`,
        '-c:v', 'libx264', '-c:a', 'aac',
        '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '23', '-r', '30',
        '-movflags', '+faststart', '-y', mergedPath
      ], { timeout: 300000 });

      if (ffmpeg.status !== 0) {
        updateTaskProgress(masterTaskId, { status: 'failed', error: '拼接失败' });
        return;
      }
    }

    segPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });

    const finalUrl = `/videos/storyboard_${masterTaskId}.mp4`;
    const durLabel = `${scenes.length}场景 (Storyboard)`;

    addToVideoHistory({ prompt: scenes.map((s, i) => `${i + 1}. ${s.description || s.prompt}`).join('; '), style, duration: durLabel, videoUrl: finalUrl });
    updateTaskProgress(masterTaskId, { progress: 100, status: 'completed', resultUrl: finalUrl });
    console.log(`[Storyboard] Complete: ${finalUrl}`);

  } catch (error) {
    console.error('[Storyboard] Error:', error);
    updateTaskProgress(masterTaskId, { status: 'failed', error: (error as Error).message });
    segPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
  }
}

// ========================
// 引擎能力矩阵与智能推荐
// ========================

/** 列出所有可用引擎及其能力标签 */
router.get('/engines', (_req: Request, res: Response) => {
  const engines = listAvailableEngines('video');
  res.json({
    success: true,
    engines: engines.map((e) => ({
      id: e.id,
      displayName: e.displayName,
      maxDurationSec: e.maxDurationSec,
      resolutions: e.resolutions,
      frameRate: e.frameRate,
      nativeAudio: e.nativeAudio,
      imageToVideo: e.imageToVideo,
      firstLastFrame: e.firstLastFrame,
      free: e.free,
      styleStrengths: e.styleStrengths,
      speedScore: e.speedScore,
      qualityScore: e.qualityScore,
      description: e.description,
    })),
  });
});

/** 根据 prompt 语义智能推荐最优引擎 */
router.post('/recommend', (req: Request, res: Response) => {
  try {
    const { prompt, duration, preferQuality, preferSpeed, preferFree, requireAudio, requireImageToVideo } = req.body;

    if (!prompt) {
      res.status(400).json({ success: false, error: 'prompt is required' });
      return;
    }

    const recommendations = recommendEngine(prompt, {
      duration: typeof duration === 'number' ? duration : parseInt(String(duration)) || 10,
      preferQuality: preferQuality === true,
      preferSpeed: preferSpeed === true,
      preferFree: preferFree === true,
      requireAudio: requireAudio === true,
      requireImageToVideo: requireImageToVideo === true,
    });

    res.json({
      success: true,
      recommendations,
      topPick: recommendations[0] || null,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ========================
// A/B 对比生成：同一 prompt 用不同引擎生成
// ========================

router.post('/compare', async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, style, duration, engines } = req.body as {
      prompt: string;
      style?: string;
      duration?: string;
      engines?: string[];
    };

    if (!prompt) {
      res.status(400).json({ success: false, error: 'prompt is required' });
      return;
    }

    const targetDuration = duration || '10';
    const targetEngines = engines && engines.length > 0
      ? engines.slice(0, 3)
      : recommendEngine(prompt, { duration: parseInt(targetDuration) })
          .slice(0, 2)
          .map((r) => r.engine);

    if (targetEngines.length === 0) {
      res.status(400).json({ success: false, error: '没有可用的引擎进行对比生成' });
      return;
    }

    const compareId = `compare-${Date.now()}`;
    const tasks: Array<{ engine: string; taskId: string; status: string }> = [];

    setTaskProgress(compareId, {
      progress: 0,
      status: 'processing',
      taskType: 'compare',
      prompt,
      style: style || '',
      duration: targetDuration,
    });

    for (const engine of targetEngines) {
      const engineTaskId = `${compareId}-${engine}`;
      tasks.push({ engine, taskId: engineTaskId, status: 'pending' });

      setTaskProgress(engineTaskId, {
        progress: 0,
        status: 'processing',
        taskType: 'compare-segment',
        prompt,
        style: style || '',
        duration: targetDuration,
      });

      const fullPrompt = style ? `${prompt}，${style}` : prompt;

      setTimeout(async () => {
        try {
          if (engine === 'agnes') {
            const result = await createVideoTaskAsync(prompt, style || '', targetDuration, false);
            if (result.success && result.taskId) {
              const agnesTaskId = result.taskId;
              let pollCount = 0;
              const MAX_POLL = 400; // 400 * 3s = 20分钟超时
              const pollInterval = setInterval(() => {
                pollCount++;
                if (pollCount >= MAX_POLL) {
                  clearInterval(pollInterval);
                  setTaskProgress(engineTaskId, { progress: 0, status: 'failed', error: '轮询超时', taskType: 'compare-segment' });
                  return;
                }
                const progress = getTaskProgress(agnesTaskId);
                if (progress?.status === 'completed' && progress.videoUrl) {
                  clearInterval(pollInterval);
                  setTaskProgress(engineTaskId, { progress: 100, status: 'completed', videoUrl: progress.videoUrl, taskType: 'compare-segment' });
                } else if (progress?.status === 'failed') {
                  clearInterval(pollInterval);
                  setTaskProgress(engineTaskId, { progress: 0, status: 'failed', error: progress.error, taskType: 'compare-segment' });
                } else if (progress) {
                  updateTaskProgress(engineTaskId, { progress: progress.progress || 0 });
                }
              }, 3000);
            } else {
              setTaskProgress(engineTaskId, { progress: 0, status: 'failed', error: result.error || '引擎启动失败', taskType: 'compare-segment' });
            }
          } else {
            const result = await createFreeVideoTask({
              model: engine as 'cogvideox' | 'wanx-video' | 'seedance',
              prompt: fullPrompt,
              duration: parseInt(targetDuration),
              style: style || '',
            });

            if (result.success && result.taskId) {
              for (let poll = 0; poll < 120; poll++) {
                await new Promise((r) => setTimeout(r, 3000));
                const status = await checkFreeVideoStatus(engine as 'cogvideox' | 'wanx-video' | 'seedance', result.taskId);
                if (status.status === 'completed' && status.videoUrl) {
                  const resp = await fetch(status.videoUrl, { redirect: 'follow' });
                  if (resp.ok) {
                    const buf = Buffer.from(await resp.arrayBuffer());
                    const videoDir = path.join(__dirname, '../public/videos');
                    await fs.promises.mkdir(videoDir, { recursive: true });
                    const fileName = `${engineTaskId}.mp4`;
                    await fs.promises.writeFile(path.join(videoDir, fileName), buf);
                    setTaskProgress(engineTaskId, {
                      progress: 100,
                      status: 'completed',
                      videoUrl: `/videos/${fileName}`,
                      taskType: 'compare-segment',
                    });
                  }
                  break;
                }
                if (status.status === 'failed') {
                  setTaskProgress(engineTaskId, { progress: 0, status: 'failed', error: status.error || '生成失败', taskType: 'compare-segment' });
                  break;
                }
                updateTaskProgress(engineTaskId, { progress: Math.min(10 + poll * 2, 90) });
              }
            } else {
              setTaskProgress(engineTaskId, { progress: 0, status: 'failed', error: result.error || '引擎启动失败', taskType: 'compare-segment' });
            }
          }
        } catch (e) {
          setTaskProgress(engineTaskId, { progress: 0, status: 'failed', error: (e as Error).message, taskType: 'compare-segment' });
        }
      }, 100 * targetEngines.indexOf(engine));
    }

    setTaskProgress(compareId, {
      progress: 5,
      status: 'processing',
      taskType: 'compare',
      prompt,
      style: style || '',
      duration: targetDuration,
    });

    res.json({
      success: true,
      compareId,
      engines: tasks,
      message: `正在使用 ${targetEngines.length} 个引擎并行生成，请通过各 taskId 轮询结果`,
    });
  } catch (error) {
    console.error('[Video Compare] Error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ========================
// 低分辨率快速预览模式
// ========================

router.post('/preview', async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, style, duration } = req.body;

    if (!prompt) {
      res.status(400).json({ success: false, error: 'prompt is required' });
      return;
    }

    const previewDuration = '5';
    const zhipuKey = process.env.ZHIPU_API_KEY;

    if (!zhipuKey) {
      res.status(400).json({ success: false, error: '预览模式需要配置 ZHIPU_API_KEY' });
      return;
    }

    const previewTaskId = `preview-${Date.now()}`;
    setTaskProgress(previewTaskId, { progress: 0, status: 'processing', taskType: 'preview', prompt, style: style || '', duration: previewDuration });

    const fullPrompt = style ? `${prompt}，${style}` : prompt;

    setTimeout(async () => {
      try {
        const result = await generateZhipuVideo({
          prompt: fullPrompt,
          duration: 5,
        });

        if (result.success && result.taskId) {
          for (let poll = 0; poll < 60; poll++) {
            if (getTaskProgress(previewTaskId)?.status === 'cancelled') {
              removePendingTask(previewTaskId);
              return;
            }
            await new Promise((r) => setTimeout(r, 3000));
            try {
              const status = await checkZhipuVideoStatus(result.taskId);
              if (status.status === 'completed' && status.videoUrl) {
                const resp = await fetch(status.videoUrl, { redirect: 'follow' });
                if (resp.ok) {
                  const buf = Buffer.from(await resp.arrayBuffer());
                  const videoDir = path.join(__dirname, '../public/videos');
                  await fs.promises.mkdir(videoDir, { recursive: true });
                  const fileName = `${previewTaskId}.mp4`;
                  await fs.promises.writeFile(path.join(videoDir, fileName), buf);

                  const ffmpegPath = getFfmpegPath();
                  const { spawnSync } = await import('child_process');
                  const lowResPath = path.join(videoDir, `${previewTaskId}_480p.mp4`);
                  spawnSync(ffmpegPath, [
                    '-i', path.join(videoDir, fileName),
                    '-vf', 'scale=854:480',
                    '-c:v', 'libx264', '-preset', 'fast', '-crf', '28',
                    '-c:a', 'aac', '-y', lowResPath,
                  ], { timeout: 30000 });

                  setTaskProgress(previewTaskId, {
                    progress: 100,
                    status: 'completed',
                    videoUrl: fs.existsSync(lowResPath) ? `/videos/${previewTaskId}_480p.mp4` : `/videos/${fileName}`,
                    taskType: 'preview',
                  });
                }
                break;
              }
              if (status.status === 'failed') {
                setTaskProgress(previewTaskId, { progress: 0, status: 'failed', error: '预览生成失败', taskType: 'preview' });
                break;
              }
              updateTaskProgress(previewTaskId, { progress: Math.min(10 + poll * 3, 90) });
            } catch {}
          }
        } else {
          setTaskProgress(previewTaskId, { progress: 0, status: 'failed', error: result.error || '预览引擎启动失败', taskType: 'preview' });
        }
      } catch (e) {
        setTaskProgress(previewTaskId, { progress: 0, status: 'failed', error: (e as Error).message, taskType: 'preview' });
      }
    }, 100);

    res.json({
      success: true,
      taskId: previewTaskId,
      message: '低分辨率预览生成中（5秒/480p），完成后可确认效果再正式生成',
    });
  } catch (error) {
    console.error('[Video Preview] Error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ========================
// SSE 进度帧预览：实时推送生成进度和缩略图
// ========================

router.get('/pending/:taskId/preview-stream', async (req: Request, res: Response): Promise<void> => {
  const { taskId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`event: connected\ndata: ${JSON.stringify({ taskId })}\n\n`);

  let lastProgress = -1;
  let lastStatus = '';
  const interval = setInterval(() => {
    const progress = getTaskProgress(taskId);
    if (!progress) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: '任务不存在或已过期' })}\n\n`);
      clearInterval(interval);
      res.end();
      return;
    }

    const currentProgress = progress.progress || 0;
    const currentStatus = progress.status || 'processing';

    if (currentProgress !== lastProgress || currentStatus !== lastStatus) {
      lastProgress = currentProgress;
      lastStatus = currentStatus;

      res.write(`event: progress\ndata: ${JSON.stringify({
        progress: currentProgress,
        status: currentStatus,
        message: (progress as any).message || '',
        videoUrl: progress.videoUrl || null,
      })}\n\n`);
    }

    if (currentStatus === 'completed' || currentStatus === 'failed') {
      clearInterval(interval);
      res.write(`event: done\ndata: ${JSON.stringify({ status: currentStatus, videoUrl: progress.videoUrl || null, error: progress.error || null })}\n\n`);
      res.end();
    }
  }, 2000);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// ========================
// 区域重绘：对已生成视频的指定时间区间重新生成
// ========================

router.post('/redraw', async (req: Request, res: Response): Promise<void> => {
  try {
    const { videoUrl, prompt, style, startTime, endTime, modifyPrompt } = req.body as {
      videoUrl: string;
      prompt: string;
      style?: string;
      startTime: number;
      endTime: number;
      modifyPrompt?: string;
    };

    if (!videoUrl || !prompt) {
      res.status(400).json({ success: false, error: 'videoUrl and prompt are required' });
      return;
    }

    if (startTime === undefined || endTime === undefined || startTime >= endTime) {
      res.status(400).json({ success: false, error: '需要有效的 startTime 和 endTime（秒），且 startTime < endTime' });
      return;
    }

    const redrawTaskId = `redraw-${Date.now()}`;
    const segDuration = Math.min(Math.ceil(endTime - startTime), 10);

    setTaskProgress(redrawTaskId, {
      progress: 0,
      status: 'processing',
      taskType: 'redraw',
      prompt: modifyPrompt || prompt,
      style: style || '',
      duration: String(segDuration),
    });

    const fullPrompt = modifyPrompt
      ? `${prompt}，${modifyPrompt}`
      : style
        ? `${prompt}，${style}`
        : prompt;

    setTimeout(async () => {
      try {
        const zhipuKey = process.env.ZHIPU_API_KEY;
        if (!zhipuKey) {
          setTaskProgress(redrawTaskId, { progress: 0, status: 'failed', error: '区域重绘需要 ZHIPU_API_KEY', taskType: 'redraw' });
          return;
        }

        const result = await generateZhipuVideo({
          prompt: fullPrompt,
          duration: segDuration,
        });

        if (result.success && result.taskId) {
          for (let poll = 0; poll < 60; poll++) {
            if (getTaskProgress(redrawTaskId)?.status === 'cancelled') {
              removePendingTask(redrawTaskId);
              return;
            }
            await new Promise((r) => setTimeout(r, 3000));
            try {
              const status = await checkZhipuVideoStatus(result.taskId);
              if (status.status === 'completed' && status.videoUrl) {
                const newSegResp = await fetch(status.videoUrl, { redirect: 'follow' });
                if (!newSegResp.ok) {
                  setTaskProgress(redrawTaskId, { progress: 0, status: 'failed', error: '下载新片段失败', taskType: 'redraw' });
                  break;
                }
                const newSegBuf = Buffer.from(await newSegResp.arrayBuffer());

                const origVideoPath = path.join(__dirname, '..', 'public', videoUrl.replace(/^\//, ''));
                if (!fs.existsSync(origVideoPath)) {
                  setTaskProgress(redrawTaskId, { progress: 0, status: 'failed', error: `原始视频不存在: ${origVideoPath}`, taskType: 'redraw' });
                  break;
                }

                const tempDir = path.join(__dirname, '../data/temp_videos');
                await fs.promises.mkdir(tempDir, { recursive: true });

                const newSegPath = path.join(tempDir, `${redrawTaskId}_new.mp4`);
                await fs.promises.writeFile(newSegPath, newSegBuf);

                const beforePath = path.join(tempDir, `${redrawTaskId}_before.mp4`);
                const afterPath = path.join(tempDir, `${redrawTaskId}_after.mp4`);
                const outputPath = path.join(__dirname, `../public/videos/${redrawTaskId}.mp4`);

                const ffmpegPath = getFfmpegPath();
                const { spawnSync } = await import('child_process');

                const probe = spawnSync(ffmpegPath, ['-i', origVideoPath], { timeout: 10000 });
                const probeOutput = probe.stderr?.toString() || '';
                const durMatch = probeOutput.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
                const totalDuration = durMatch
                  ? parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3])
                  : endTime + 5;

                const beforeCmd = spawnSync(ffmpegPath, [
                  '-i', origVideoPath,
                  '-t', String(startTime),
                  '-c', 'copy', '-y', beforePath,
                ], { timeout: 30000 });

                let afterCmd = null;
                if (endTime < totalDuration) {
                  afterCmd = spawnSync(ffmpegPath, [
                    '-i', origVideoPath,
                    '-ss', String(endTime),
                    '-c', 'copy', '-y', afterPath,
                  ], { timeout: 30000 });
                }

                const parts: string[] = [];
                if (fs.existsSync(beforePath)) parts.push(beforePath);
                parts.push(newSegPath);
                if (afterCmd === null || (afterCmd && fs.existsSync(afterPath))) {
                  if (afterCmd && fs.existsSync(afterPath)) parts.push(afterPath);
                }

                const listPath = path.join(tempDir, `${redrawTaskId}_list.txt`);
                const listContent = parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n');
                await fs.promises.writeFile(listPath, listContent);

                const mergeCmd = spawnSync(ffmpegPath, [
                  '-f', 'concat', '-safe', '0', '-i', listPath,
                  '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
                  '-c:a', 'aac', '-pix_fmt', 'yuv420p',
                  '-movflags', '+faststart', '-y', outputPath,
                ], { timeout: 120000 });

                parts.forEach((p) => { try { fs.unlinkSync(p); } catch {} });
                try { fs.unlinkSync(listPath); } catch {}

                if (mergeCmd.status === 0) {
                  const finalUrl = `/videos/${redrawTaskId}.mp4`;
                  addToVideoHistory({
                    prompt: `${prompt} (区域重绘: ${startTime}s-${endTime}s)`,
                    style: style || '',
                    duration: `${segDuration}s (redraw)`,
                    videoUrl: finalUrl,
                  });
                  setTaskProgress(redrawTaskId, {
                    progress: 100,
                    status: 'completed',
                    videoUrl: finalUrl,
                    taskType: 'redraw',
                  });
                } else {
                  setTaskProgress(redrawTaskId, {
                    progress: 0,
                    status: 'failed',
                    error: `视频拼接失败 (exit code: ${mergeCmd.status})`,
                    taskType: 'redraw',
                  });
                }
                break;
              }
              if (status.status === 'failed') {
                setTaskProgress(redrawTaskId, { progress: 0, status: 'failed', error: '区域重绘生成失败', taskType: 'redraw' });
                break;
              }
              updateTaskProgress(redrawTaskId, { progress: Math.min(10 + poll * 3, 90) });
            } catch {}
          }
        } else {
          setTaskProgress(redrawTaskId, { progress: 0, status: 'failed', error: result.error || '引擎启动失败', taskType: 'redraw' });
        }
      } catch (e) {
        setTaskProgress(redrawTaskId, { progress: 0, status: 'failed', error: (e as Error).message, taskType: 'redraw' });
      }
    }, 100);

    res.json({
      success: true,
      taskId: redrawTaskId,
      message: `正在重新生成 ${startTime}s-${endTime}s 区间，完成后自动拼接回原视频`,
    });
  } catch (error) {
    console.error('[Video Redraw] Error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router
