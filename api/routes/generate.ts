import { Router, type Request, type Response } from 'express'
import { generateImage, generateCaption, availableModels, modifyImage, analyzeImageWithText } from '../services/imageService.js'
import { imageToImage, understandVideo } from '../services/multimodalService.js'
import { addToHistory } from '../services/historyService.js'

const router = Router()

/**
 * GET /api/generate/models - 获取可用模型列表
 */
router.get('/models', (req: Request, res: Response) => {
  res.json({
    success: true,
    models: availableModels,
  })
})

/**
 * POST /api/generate - 生成图片
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, style, model, size } = req.body

    if (!prompt) {
      res.status(400).json({
        success: false,
        error: 'Prompt is required',
      })
      return
    }

    console.log(`Generate request: prompt=${prompt}, style=${style}, model=${model}, size=${size}`)

    const requestModel = model || 'trae'
    const requestSize = size || 'landscape_16_9'

    const result = await generateImage({
      prompt,
      style: style || 'realistic',
      model: requestModel,
      size: requestSize,
    })

    console.log(`Generate result: success=${result.success}, error=${result.error}`)

    if (result.success && result.imageUrl) {
      addToHistory({ prompt, style: style || '', imageUrl: result.imageUrl })
    }

    res.json(result)
  } catch (error) {
    console.error('Generate route error:', error)
    res.status(500).json({
      success: false,
      error: `Server internal error: ${(error as Error).message}`,
    })
  }
})

/**
 * POST /api/generate/modify - 修改图片
 */
router.post('/modify', async (req: Request, res: Response): Promise<void> => {
  try {
    const { originalImageUrl, originalPrompt, modifyInstruction, style, model, size } = req.body

    if (!originalPrompt || !modifyInstruction) {
      res.status(400).json({
        success: false,
        error: 'originalPrompt and modifyInstruction are required',
      })
      return
    }

    console.log(`Modify image request: original=${originalPrompt.substring(0, 30)}..., modify=${modifyInstruction}`)

    const result = await modifyImage({
      originalImageUrl,
      originalPrompt,
      modifyInstruction,
      style: style || 'realistic',
      model: model || 'trae',
      size: size || 'landscape_16_9',
    })

    console.log(`Modify image result: success=${result.success}, error=${result.error}`)

    res.json(result)
  } catch (error) {
    console.error('Modify image route error:', error)
    res.status(500).json({
      success: false,
      error: `Server internal error: ${(error as Error).message}`,
    })
  }
})

/**
 * POST /api/generate/caption - 生成配图文案
 */
router.post('/caption', async (req: Request, res: Response): Promise<void> => {
  try {
    const { prompt, style } = req.body

    if (!prompt) {
      res.status(400).json({
        success: false,
        error: 'Prompt is required',
      })
      return
    }

    console.log(`Caption request: prompt=${prompt}, style=${style}`)

    const result = await generateCaption({ prompt, style: style || '' })

    console.log(`Caption result: success=${result.success}, caption=${result.caption}`)

    res.json(result)
  } catch (error) {
    console.error('Caption route error:', error)
    res.status(500).json({
      success: false,
      error: `Server internal error: ${(error as Error).message}`,
    })
  }
})

/**
 * POST /api/generate/analyze - 视觉+指令分析（图生图前置）
 */
router.post('/analyze', async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageUrl, message } = req.body

    if (!imageUrl || !message) {
      res.status(400).json({ success: false, error: 'imageUrl 和 message 是必填项' })
      return
    }

    const result = await analyzeImageWithText({ imageUrl, message })
    res.json(result)
  } catch (error) {
    console.error('Analyze route error:', error)
    res.status(500).json({
      success: false,
      error: `Server internal error: ${(error as Error).message}`,
    })
  }
})

/**
 * POST /api/generate/img2img - 图生图（以图为基础修改风格/内容）
 */
router.post('/img2img', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceImage, instruction, style, model, size } = req.body

    if (!sourceImage || !instruction) {
      res.status(400).json({ success: false, error: 'sourceImage 和 instruction 是必填项' })
      return
    }

    const result = await imageToImage({ sourceImage, instruction, style, model, size })
    if (result.success && result.imageUrl) {
      addToHistory({
        prompt: result.finalPrompt || instruction,
        style: style || 'img2img',
        imageUrl: result.imageUrl,
      })
    }
    res.json(result)
  } catch (error) {
    console.error('Img2Img route error:', error)
    res.status(500).json({
      success: false,
      error: `Server internal error: ${(error as Error).message}`,
    })
  }
})

/**
 * POST /api/generate/video-understand - 视频理解（输入视频 → 描述/分镜脚本）
 */
router.post('/video-understand', async (req: Request, res: Response): Promise<void> => {
  try {
    const { videoUrl, mode, frameCount, focus } = req.body

    if (!videoUrl) {
      res.status(400).json({ success: false, error: 'videoUrl 是必填项' })
      return
    }

    const result = await understandVideo({ videoUrl, mode, frameCount, focus })
    res.json(result)
  } catch (error) {
    console.error('Video understand route error:', error)
    res.status(500).json({
      success: false,
      error: `Server internal error: ${(error as Error).message}`,
    })
  }
})

export default router
