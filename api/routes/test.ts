import { Router, type Request, type Response } from 'express'

const router = Router()

router.post('/model', async (req: Request, res: Response) => {
  const { model, apiKey, modelId } = req.body

  if (!apiKey) {
    res.json({ success: false, message: '请先输入 API Key' })
    return
  }

  try {
    let success = false
    let message = ''

    switch (model) {
      // ===== 图片模型 =====
      case 'wanx': {
        const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/generation', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'wanx2.1-turbo',
            input: { prompt: '测试连接' },
            parameters: { n: 1, size: '512*512' },
          }),
        })

        if (response.ok) {
          const data = await response.json() as any
          if (data.output?.images?.[0]) {
            success = true
            message = '通义万相 API Key 验证成功'
          } else {
            message = `通义万相 API Key 无效或余额不足: ${JSON.stringify(data)}`
          }
        } else {
          const errText = await response.text().catch(() => '')
          message = `通义万相验证失败 (HTTP ${response.status}): ${errText.substring(0, 100)}`
        }
        break
      }

      case 'cogview': {
        const response = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'cogview-4-250304',
            prompt: '测试连接',
            size: '512x512',
          }),
        })

        if (response.ok) {
          const data = await response.json() as any
          if (data.data?.[0]?.url) {
            success = true
            message = '智谱 CogView-4 API Key 验证成功'
          } else {
            message = `智谱 CogView-4 API Key 无效或余额不足: ${JSON.stringify(data)}`
          }
        } else {
          const errText = await response.text().catch(() => '')
          message = `智谱验证失败 (HTTP ${response.status}): ${errText.substring(0, 100)}`
        }
        break
      }

      case 'volcengine': {
        const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelId || 'doubao-seedream-4-0-250828',
            prompt: '测试连接',
            size: '512x512',
          }),
        })

        if (response.ok) {
          const data = await response.json() as any
          if (data.data?.[0]?.url) {
            success = true
            message = '火山方舟 API Key 验证成功'
          } else {
            message = `火山方舟 API Key 无效或模型不存在: ${JSON.stringify(data)}`
          }
        } else {
          const errText = await response.text().catch(() => '')
          message = `火山方舟验证失败 (HTTP ${response.status}): ${errText.substring(0, 100)}`
        }
        break
      }

      // ===== 视频模型 =====
      case 'cogvideox-flash': {
        // 测试智谱 CogVideoX-Flash 视频模型
        const response = await fetch('https://open.bigmodel.cn/api/paas/v4/videos/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'cogvideox-flash',
            prompt: '一只可爱的小猫',
          }),
        })

        if (response.ok) {
          const data = await response.json() as any
          if (data.id) {
            success = true
            message = '智谱 CogVideoX-Flash API Key 验证成功'
          } else {
            message = `智谱 CogVideoX-Flash API Key 无效: ${JSON.stringify(data)}`
          }
        } else {
          const errText = await response.text().catch(() => '')
          message = `智谱视频验证失败 (HTTP ${response.status}): ${errText.substring(0, 100)}`
        }
        break
      }

      case 'wanx-video': {
        // 测试通义万相视频模型
        const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify({
            model: 'wan2.6-t2v',
            input: { prompt: '一只可爱的小猫' },
            parameters: { duration: 5 },
          }),
        })

        if (response.ok) {
          const data = await response.json() as any
          if (data.output?.task_id) {
            success = true
            message = '通义万相视频 API Key 验证成功'
          } else {
            message = `通义万相视频 API Key 无效: ${JSON.stringify(data)}`
          }
        } else {
          const errText = await response.text().catch(() => '')
          message = `万相视频验证失败 (HTTP ${response.status}): ${errText.substring(0, 100)}`
        }
        break
      }

      case 'seedance': {
        // 测试 Seedance 2.0 视频模型（火山引擎 ARK）
        const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/videos/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelId || 'seedance-2-0-l-t2v-250828',
            prompt: '一只可爱的小猫在草地上奔跑',
            duration: 5,
          }),
        })

        if (response.ok) {
          const data = await response.json() as any
          if (data.id) {
            success = true
            message = 'Seedance 2.0 API Key 验证成功'
          } else {
            message = `Seedance 2.0 API Key 无效: ${JSON.stringify(data)}`
          }
        } else {
          const errText = await response.text().catch(() => '')
          message = `Seedance 验证失败 (HTTP ${response.status}): ${errText.substring(0, 100)}`
        }
        break
      }

      case 'agnes': {
        // 测试 Agnes Video API
        const response = await fetch('https://apihub.agnes-ai.cn/v1/videos', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'agnes-video-v2.0',
            prompt: '一只可爱的小猫',
            num_frames: 81,
            frame_rate: 24,
          }),
        })

        if (response.ok) {
          const data = await response.json() as any
          if (data.video_id || data.task_id) {
            success = true
            message = 'Agnes Video V2.0 API Key 验证成功'
          } else {
            message = `Agnes Video API Key 无效: ${JSON.stringify(data)}`
          }
        } else {
          const errText = await response.text().catch(() => '')
          if (errText.includes('timed out') || errText.includes('fetch failed')) {
            message = 'Agnes API 无法连接（国内可能需要代理）'
          } else {
            message = `Agnes 验证失败 (HTTP ${response.status}): ${errText.substring(0, 100)}`
          }
        }
        break
      }

      case 'deepseek': {
        // 测试 DeepSeek API
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'deepseek-v4-flash',
            messages: [{ role: 'user', content: '你好，请回复"连接成功"' }],
            max_tokens: 10,
          }),
        })

        if (response.ok) {
          const data = await response.json() as any
          if (data.choices?.[0]?.message?.content) {
            success = true
            message = 'DeepSeek API Key 验证成功'
          } else {
            message = `DeepSeek API Key 无效: ${JSON.stringify(data)}`
          }
        } else {
          const errText = await response.text().catch(() => '')
          message = `DeepSeek 验证失败 (HTTP ${response.status}): ${errText.substring(0, 100)}`
        }
        break
      }

      default:
        message = `未知模型: ${model}`
    }

    res.json({ success, message })
  } catch (error) {
    res.json({
      success: false,
      message: `验证异常: ${(error as Error).message}`,
    })
  }
})

export default router
