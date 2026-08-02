import { Router, type Request, type Response } from 'express'
import { checkLtxHealth, createLtxVideoTask, getLtxModels } from '../services/ltxVideoService.js'
import { getTaskProgress, removeTaskProgress } from '../services/videoTaskProgressService.js'

const router = Router()

/**
 * LTX-Video 本地视频生成路由
 *
 * 端点：
 *   GET  /api/ltx/health   - 检查 LTX 服务状态
 *   GET  /api/ltx/models   - 列出可用模型
 *   POST /api/ltx/generate - 提交视频生成任务
 *   GET  /api/ltx/status/:taskId - 查询任务状态（复用 videoTaskProgress）
 */

// 健康检查
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    const health = await checkLtxHealth()
    res.json(health)
  } catch (error) {
    res.json({
      available: false,
      error: `健康检查异常: ${(error as Error).message}`,
    })
  }
})

// 获取可用模型列表
router.get('/models', (req: Request, res: Response) => {
  const models = getLtxModels()
  res.json({ success: true, models })
})

// 提交视频生成任务
router.post('/generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, style, duration, model, seed } = req.body

    if (!prompt) {
      res.status(400).json({
        success: false,
        error: 'prompt is required',
      })
      return
    }

    console.log(`[LTX Route] Generate request: prompt="${prompt.substring(0, 50)}", duration=${duration}, model=${model}`)

    const result = await createLtxVideoTask({
      prompt,
      style: style || '',
      duration: duration || '5',
      model: model || 'ltxv-2b-distilled',
      seed,
    })

    res.json(result)
  } catch (error) {
    console.error('[LTX Route] Generate error:', error)
    res.status(500).json({
      success: false,
      error: `Server error: ${(error as Error).message}`,
    })
  }
})

// 查询任务状态（复用 videoTaskProgress 持久化服务）
router.get('/status/:taskId', (req: Request, res: Response): void => {
  try {
    const { taskId } = req.params
    const progressInfo = getTaskProgress(taskId)

    if (progressInfo) {
      const isCompleted = progressInfo.status === 'completed' && progressInfo.videoUrl
      const isFailed = progressInfo.status === 'failed'

      if (isCompleted) {
        // 任务完成后延迟清理进度记录（5分钟后），避免持续占用内存
        setTimeout(() => removeTaskProgress(taskId), 5 * 60 * 1000)
        res.json({
          success: true,
          status: 'completed',
          progress: 100,
          videoUrl: progressInfo.videoUrl,
        })
      } else if (isFailed) {
        // 失败任务也延迟清理
        setTimeout(() => removeTaskProgress(taskId), 5 * 60 * 1000)
        res.json({
          success: false,
          status: 'failed',
          progress: 0,
          error: progressInfo.error || '视频生成失败',
        })
      } else {
        res.json({
          success: true,
          status: 'processing',
          progress: progressInfo.progress || 0,
        })
      }
    } else {
      res.json({
        success: false,
        status: 'failed',
        error: 'LTX 任务记录不存在或已过期，请重新生成',
      })
    }
  } catch (error) {
    res.json({
      success: false,
      status: 'failed',
      error: `查询状态异常: ${(error as Error).message}`,
    })
  }
})

export default router
