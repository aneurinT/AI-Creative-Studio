import { Router, type Request, type Response } from 'express'
import { inferenceRegistry } from '../services/inference/index.js'
import type { InferenceTaskParams } from '../services/inference/types.js'

const router = Router()

/**
 * LTX-Video 本地视频生成路由
 *
 * 端点（保持不变）：
 *   GET  /api/ltx/health   - 检查 LTX 服务状态
 *   GET  /api/ltx/models   - 列出可用模型
 *   POST /api/ltx/generate - 提交视频生成任务（通过默认推理后端）
 *   GET  /api/ltx/status/:taskId - 查询任务状态
 *
 * health/models 查询 LTX 后端特有信息；generate/status 走默认后端（可插拔切换）。
 */

// 健康检查
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await inferenceRegistry.get('ltx').healthCheck()
    res.json({
      available: result.available,
      error: result.error,
      cudaAvailable: result.details?.cudaAvailable,
      gpuName: result.details?.gpuName,
      gpuMemoryGb: result.details?.gpuMemoryGb,
      ltxVideoInstalled: result.details?.ltxVideoInstalled,
    })
  } catch (error) {
    res.json({
      available: false,
      error: `LTX 后端未注册或健康检查异常: ${(error as Error).message}`,
    })
  }
})

// 获取可用模型列表
router.get('/models', async (req: Request, res: Response): Promise<void> => {
  try {
    const models = await inferenceRegistry.get('ltx').getModels()
    res.json({ success: true, models })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `获取模型列表失败: ${(error as Error).message}`,
    })
  }
})

// 提交视频生成任务（走默认推理后端，便于未来切换为 SVD 等）
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

    console.log(`[LTX Route] Generate request: prompt="${String(prompt).substring(0, 50)}", duration=${duration}, model=${model}`)

    const params: InferenceTaskParams = {
      prompt,
      style: style || '',
      duration: duration || '5',
      model: model || 'ltxv-2b-distilled',
      seed,
    }

    const result = await inferenceRegistry.getDefault().startTask(params)
    res.json(result)
  } catch (error) {
    console.error('[LTX Route] Generate error:', error)
    res.status(500).json({
      success: false,
      error: `Server error: ${(error as Error).message}`,
    })
  }
})

// 查询任务状态
router.get('/status/:taskId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { taskId } = req.params
    const { success, status, error } = await inferenceRegistry.getDefault().queryStatus(taskId)

    if (!success || !status) {
      res.json({
        success: false,
        status: 'failed',
        error: error || 'LTX 任务记录不存在或已过期，请重新生成',
      })
      return
    }

    // 保持原响应结构
    if (status.status === 'completed') {
      res.json({
        success: true,
        status: 'completed',
        progress: 100,
        videoUrl: status.videoUrl,
      })
    } else if (status.status === 'failed') {
      res.json({
        success: false,
        status: 'failed',
        progress: 0,
        error: status.error || '视频生成失败',
      })
    } else {
      res.json({
        success: true,
        status: 'processing',
        progress: status.progress || 0,
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
