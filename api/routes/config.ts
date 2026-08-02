import { Router, type Request, type Response } from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const router = Router()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const configPath = path.join(__dirname, '../config.json')

interface ModelConfig {
  apiKey: string
  modelId?: string
}

interface Config {
  models: {
    // 图片模型
    wanx?: ModelConfig
    cogview?: ModelConfig
    volcengine?: ModelConfig
    // 视频模型
    'cogvideox-flash'?: ModelConfig
    'wanx-video'?: ModelConfig
    seedance?: ModelConfig
    agnes?: ModelConfig
    // LLM 模型
    deepseek?: ModelConfig
  }
}

function loadConfig(): Config {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8')
      return JSON.parse(content)
    }
  } catch (error) {
    console.error('Error loading config:', error)
  }
  return { models: {} }
}

function saveConfig(config: Config): void {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('Error saving config:', error)
  }
}

/** 获取所有已配置模型列表（用于前端展示，隐藏真实 Key） */
router.get('/', (req: Request, res: Response) => {
  const config = loadConfig()
  const safe: Record<string, any> = {}

  for (const [key, val] of Object.entries(config.models)) {
    if (val) {
      safe[key] = {
        apiKey: val.apiKey ? '***' : '',
        modelId: val.modelId || undefined,
      }
    }
  }

  res.json({ success: true, config: { models: safe } })
})

/** 保存模型配置 */
router.post('/', (req: Request, res: Response) => {
  const { models } = req.body
  const config = loadConfig()

  if (!models) {
    res.status(400).json({ success: false, error: '缺少 models 参数' })
    return
  }

  // 图片模型
  if (models.wanx) config.models.wanx = { apiKey: models.wanx.apiKey }
  if (models.cogview) config.models.cogview = { apiKey: models.cogview.apiKey }
  if (models.volcengine) config.models.volcengine = { apiKey: models.volcengine.apiKey, modelId: models.volcengine.modelId }

  // 视频模型
  if (models['cogvideox-flash']) config.models['cogvideox-flash'] = { apiKey: models['cogvideox-flash'].apiKey }
  if (models['wanx-video']) config.models['wanx-video'] = { apiKey: models['wanx-video'].apiKey }
  if (models.seedance) config.models.seedance = { apiKey: models.seedance.apiKey }
  if (models.agnes) config.models.agnes = { apiKey: models.agnes.apiKey }

  // LLM
  if (models.deepseek) config.models.deepseek = { apiKey: models.deepseek.apiKey }

  saveConfig(config)

  res.json({ success: true, message: '配置保存成功' })
})

export default router
