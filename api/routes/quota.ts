/**
 * 配额管理 API（仅管理员可操作）
 * GET  /api/quota          — 获取所有模型配额状态
 * GET  /api/quota/:model   — 获取单个模型配额状态
 * POST /api/quota/:model/reset — 重置配额
 * POST /api/quota/:model/toggle — 启用/禁用模型
 */
import { Router, type Request, type Response } from 'express'
import { getAllQuotas, getQuota, resetQuota, setQuotaEnabled } from '../services/quotaService.js'

const router = Router()

/** 验证管理员权限 */
function requireAdmin(req: Request, res: Response): boolean {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, error: '仅管理员可操作配额' })
    return false
  }
  return true
}

/** 获取所有配额状态 */
router.get('/', (req: Request, res: Response) => {
  const quotas = getAllQuotas()
  // 不暴露内部字段
  const safe = quotas.map(q => ({
    model: q.model,
    displayName: q.displayName,
    type: q.type,
    dailyLimit: q.dailyLimit,
    totalLimit: q.totalLimit,
    dailyUsed: q.dailyUsed,
    totalUsed: q.totalUsed,
    disabled: q.disabled,
    disabledReason: q.disabledReason,
    note: q.note,
    // 计算剩余
    dailyRemaining: q.dailyLimit > 0 ? Math.max(0, q.dailyLimit - q.dailyUsed) : null,
    totalRemaining: q.totalLimit > 0 ? Math.max(0, q.totalLimit - q.totalUsed) : null,
  }))
  res.json({ success: true, quotas: safe })
})

/** 获取单个模型配额 */
router.get('/:model', (req: Request, res: Response) => {
  const quota = getQuota(req.params.model)
  if (!quota) {
    res.status(404).json({ success: false, error: '模型不存在' })
    return
  }
  res.json({
    success: true,
    quota: {
      ...quota,
      dailyRemaining: quota.dailyLimit > 0 ? Math.max(0, quota.dailyLimit - quota.dailyUsed) : null,
      totalRemaining: quota.totalLimit > 0 ? Math.max(0, quota.totalLimit - quota.totalUsed) : null,
    },
  })
})

/** 重置配额（管理员） */
router.post('/:model/reset', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return

  const ok = resetQuota(req.params.model)
  if (!ok) {
    res.status(404).json({ success: false, error: '模型不存在' })
    return
  }
  res.json({ success: true, message: '配额已重置' })
})

/** 启用/禁用模型（管理员） */
router.post('/:model/toggle', (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return

  const { enabled } = req.body as Record<string, any>
  const reason = req.body.reason as string | undefined

  const ok = setQuotaEnabled(req.params.model, enabled !== false, reason)
  if (!ok) {
    res.status(404).json({ success: false, error: '模型不存在' })
    return
  }
  res.json({ success: true, message: `模型已${enabled !== false ? '启用' : '禁用'}` })
})

export default router
