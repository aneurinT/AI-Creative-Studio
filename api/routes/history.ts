import { Router, type Request, type Response } from 'express'
import { getHistory, deleteFromHistory, clearHistory } from '../services/historyService.js'

const router = Router()

/**
 * GET /api/history - 获取历史记录
 */
router.get('/', (req: Request, res: Response) => {
  const result = getHistory()
  res.json(result)
})

/**
 * DELETE /api/history/:id - 删除单条历史记录
 */
router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const result = deleteFromHistory(id)
  res.json(result)
})

/**
 * DELETE /api/history - 清空历史记录
 */
router.delete('/', (req: Request, res: Response) => {
  const result = clearHistory()
  res.json(result)
})

export default router
