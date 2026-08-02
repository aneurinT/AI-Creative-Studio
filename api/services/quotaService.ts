/**
 * 配额管理服务
 * 跟踪各 AI 模型的调用次数和余额，免费额度用完后阻止调用
 *
 * 配额数据存储在 data/quotas.json
 * 每次 API 调用后更新计数，调用前检查是否超限
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const QUOTAS_FILE = path.join(__dirname, '../../data/quotas.json')

// ========================
// 类型定义
// ========================

export interface ModelQuota {
  /** 模型标识 */
  model: string
  /** 显示名称 */
  displayName: string
  /** 免费/付费 */
  type: 'free' | 'limited_free' | 'paid'
  /** 每日限额（0 = 无限制） */
  dailyLimit: number
  /** 总限额（0 = 无限制） */
  totalLimit: number
  /** 今日已用次数 */
  dailyUsed: number
  /** 累计已用次数 */
  totalUsed: number
  /** 今日日期（用于重置） */
  todayDate: string
  /** 是否已被禁用 */
  disabled: boolean
  /** 禁用原因 */
  disabledReason?: string
  /** 备注 */
  note?: string
}

interface QuotaStore {
  version: 1
  models: Record<string, ModelQuota>
  lastUpdated: number
}

// ========================
// 默认配额配置
// ========================

const DEFAULT_QUOTAS: Record<string, Omit<ModelQuota, 'dailyUsed' | 'totalUsed' | 'todayDate' | 'disabled' | 'disabledReason'>> = {
  // ===== 完全免费模型 =====
  trae: {
    model: 'trae',
    displayName: 'Trae AI 图片生成',
    type: 'free',
    dailyLimit: 500,   // 防止滥用
    totalLimit: 0,     // 不限制
    note: '完全免费，通过 trae-api-cn.mchost.guru 调用',
  },
  'cogvideox-flash': {
    model: 'cogvideox-flash',
    displayName: '智谱 CogVideoX-Flash 视频生成',
    type: 'free',
    dailyLimit: 50,    // 智谱免费模型有每日限额
    totalLimit: 0,
    note: '智谱官方免费视频模型，有每日调用次数限制',
  },
  'glm-4-flash': {
    model: 'glm-4-flash',
    displayName: '智谱 GLM-4-Flash LLM',
    type: 'free',
    dailyLimit: 1000,  // 审核、故事板等高频调用
    totalLimit: 0,
    note: '智谱官方免费 LLM，用于审核Agent、故事板生成等',
  },

  // ===== 有限免费额度模型 =====
  'wanx-image': {
    model: 'wanx-image',
    displayName: '通义万相 图片生成',
    type: 'limited_free',
    dailyLimit: 0,
    totalLimit: 100,   // 新用户 100 次免费
    note: '新用户 100 次免费，用完后需付费',
  },
  'wanx-video': {
    model: 'wanx-video',
    displayName: '通义万相 视频生成',
    type: 'limited_free',
    dailyLimit: 0,
    totalLimit: 5,     // 新用户 50 秒 ≈ 5 段视频
    note: '新用户 50 秒免费额度，90 天有效',
  },
  'cogview-4': {
    model: 'cogview-4',
    displayName: '智谱 CogView-4 图片生成',
    type: 'limited_free',
    dailyLimit: 0,
    totalLimit: 100,   // 新用户约 100 次
    note: '新用户 2000 万 Tokens 免费额度',
  },

  // ===== 付费模型（默认不限制，由用户自行管理）=====
  'volcengine-seedream': {
    model: 'volcengine-seedream',
    displayName: '火山方舟 Seedream 图片生成',
    type: 'paid',
    dailyLimit: 0,
    totalLimit: 0,
    note: '按需付费，由火山引擎账号余额决定',
  },
  'seedance': {
    model: 'seedance',
    displayName: 'Seedance 2.0 视频生成',
    type: 'paid',
    dailyLimit: 0,
    totalLimit: 0,
    note: '按需付费，由火山引擎账号余额决定',
  },
  'deepseek': {
    model: 'deepseek',
    displayName: 'DeepSeek LLM',
    type: 'paid',
    dailyLimit: 0,
    totalLimit: 0,
    note: '按需付费，由 DeepSeek 账号余额决定',
  },
  'glm-4v-flash': {
    model: 'glm-4v-flash',
    displayName: '智谱 GLM-4V-Flash 视觉分析',
    type: 'paid',
    dailyLimit: 0,
    totalLimit: 0,
    note: '按量计费',
  },
}

// ========================
// 存储读写
// ========================

let quotaCache: QuotaStore | null = null

function readQuotas(): QuotaStore {
  if (quotaCache) return quotaCache

  try {
    const dir = path.dirname(QUOTAS_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    if (fs.existsSync(QUOTAS_FILE)) {
      const data = fs.readFileSync(QUOTAS_FILE, 'utf-8')
      quotaCache = JSON.parse(data) as QuotaStore

      // 检查是否需要重置每日计数
      const today = getToday()
      let modified = false
      for (const key of Object.keys(quotaCache.models)) {
        const m = quotaCache.models[key]
        if (m.todayDate !== today) {
          m.dailyUsed = 0
          m.todayDate = today
          modified = true
        }
      }
      if (modified) saveQuotas(quotaCache)

      return quotaCache
    }
  } catch (e) {
    console.error('[Quota] Read error:', e)
  }

  // 初始化默认配额
  const store: QuotaStore = {
    version: 1,
    models: {},
    lastUpdated: Date.now(),
  }

  const today = getToday()
  for (const [key, config] of Object.entries(DEFAULT_QUOTAS)) {
    store.models[key] = {
      ...config,
      dailyUsed: 0,
      totalUsed: 0,
      todayDate: today,
      disabled: false,
    }
  }

  quotaCache = store
  saveQuotas(store)
  console.log('[Quota] Initialized default quotas')
  return store
}

function saveQuotas(store: QuotaStore): void {
  try {
    store.lastUpdated = Date.now()
    const dir = path.dirname(QUOTAS_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(QUOTAS_FILE, JSON.stringify(store, null, 2))
    quotaCache = store
  } catch (e) {
    console.error('[Quota] Save error:', e)
  }
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10)
}

// ========================
// 公共 API
// ========================

/**
 * 检查模型是否还有可用配额
 * @returns { allowed, reason } — allowed=false 时 reason 说明原因
 */
export function checkQuota(model: string): { allowed: boolean; reason?: string; remaining?: number } {
  const store = readQuotas()
  const quota = store.models[model]

  if (!quota) {
    // 未配置的模型默认允许
    return { allowed: true }
  }

  if (quota.disabled) {
    return { allowed: false, reason: quota.disabledReason || '该模型已被禁用' }
  }

  // 检查每日限额
  if (quota.dailyLimit > 0 && quota.dailyUsed >= quota.dailyLimit) {
    return {
      allowed: false,
      reason: `${quota.displayName} 今日免费额度已用完（${quota.dailyLimit} 次/天），请明天再试`,
      remaining: 0,
    }
  }

  // 检查总限额
  if (quota.totalLimit > 0 && quota.totalUsed >= quota.totalLimit) {
    // 自动禁用
    quota.disabled = true
    quota.disabledReason = `${quota.displayName} 免费额度已用完（${quota.totalLimit} 次），请联系管理员`
    saveQuotas(store)
    return {
      allowed: false,
      reason: quota.disabledReason,
      remaining: 0,
    }
  }

  const remaining = quota.totalLimit > 0
    ? quota.totalLimit - quota.totalUsed
    : quota.dailyLimit > 0
      ? quota.dailyLimit - quota.dailyUsed
      : undefined

  return { allowed: true, remaining }
}

/**
 * 记录一次模型调用
 * 应在 API 调用成功后调用
 */
export function recordUsage(model: string): void {
  const store = readQuotas()
  const quota = store.models[model]

  if (!quota) return

  const today = getToday()
  if (quota.todayDate !== today) {
    quota.dailyUsed = 0
    quota.todayDate = today
  }

  quota.dailyUsed++
  quota.totalUsed++

  // 达到限额时自动标记
  if (quota.dailyLimit > 0 && quota.dailyUsed >= quota.dailyLimit) {
    console.log(`[Quota] ${quota.displayName} 今日额度用完 (${quota.dailyUsed}/${quota.dailyLimit})`)
  }
  if (quota.totalLimit > 0 && quota.totalUsed >= quota.totalLimit) {
    quota.disabled = true
    quota.disabledReason = `${quota.displayName} 免费额度已用完（${quota.totalLimit} 次）`
    console.log(`[Quota] ${quota.displayName} 总额度用完，已自动禁用`)
  }

  saveQuotas(store)
}

/**
 * 获取所有模型的配额状态
 */
export function getAllQuotas(): ModelQuota[] {
  const store = readQuotas()
  return Object.values(store.models)
}

/**
 * 获取单个模型的配额状态
 */
export function getQuota(model: string): ModelQuota | null {
  const store = readQuotas()
  return store.models[model] || null
}

/**
 * 重置模型配额（管理员操作）
 */
export function resetQuota(model: string): boolean {
  const store = readQuotas()
  const quota = store.models[model]
  if (!quota) return false

  quota.dailyUsed = 0
  quota.totalUsed = 0
  quota.disabled = false
  quota.disabledReason = undefined
  quota.todayDate = getToday()
  saveQuotas(store)
  return true
}

/**
 * 手动设置模型为禁用/启用
 */
export function setQuotaEnabled(model: string, enabled: boolean, reason?: string): boolean {
  const store = readQuotas()
  const quota = store.models[model]
  if (!quota) return false

  quota.disabled = !enabled
  quota.disabledReason = enabled ? undefined : (reason || '管理员手动禁用')
  saveQuotas(store)
  return true
}
