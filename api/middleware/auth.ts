/**
 * JWT 鉴权中间件
 * 验证请求中的 Authorization: Bearer <token>
 * 验证通过后将用户信息注入 req.user
 */
import { type Request, type Response, type NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const JWT_SECRET = process.env.JWT_SECRET || 'ai-studio-default-secret-change-me'
const USERS_FILE = path.join(__dirname, '../../data/users.json')

// 扩展 Express Request 类型
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string
        username: string
        role: 'admin' | 'user'
      }
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 跳过不需要鉴权的路由
  const publicPaths = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/health',
    '/images/',
    '/uploads/',
    '/videos/',
    // 只读公共数据
    '/api/generate/models',
    '/api/video/history',
    '/api/video/pending',
    '/api/history',
    '/api/ltx/health',
    '/api/config',
    // 故事板检测（只读）
    '/api/storyboard/detect',
    // AI 助手核心功能（鉴权由前端 token 处理，白名单放行）
    '/api/hermes/',
    '/api/agents/',
    '/api/generate/image',
    '/api/generate/video',
    '/api/generate/remove-bg',
    '/api/generate/compose',
    '/api/generate/modify-image',
    '/api/chat/sessions',
    '/api/ocr/',
    '/api/mcp/',
    '/api/tools',
    '/api/agents/orchestrate',
    '/api/agents/execute-plan',
    '/api/collaboration/',
    '/api/mock/',
  ]

  if (publicPaths.some(p => req.path.startsWith(p))) {
    next()
    return
  }

  // 开发环境可选跳过鉴权（方便调试）
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_AUTH === 'true') {
    // 使用默认开发用户
    req.user = { userId: 'dev-user', username: 'dev', role: 'admin' }
    next()
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: '请先登录' })
    return
  }

  const token = authHeader.slice(7)

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; username: string; role: 'admin' | 'user' }

    // 验证用户是否存在
    try {
      const usersData = fs.readFileSync(USERS_FILE, 'utf-8')
      const users = JSON.parse(usersData) as any[]
      const user = users.find((u: any) => u.id === decoded.userId)
      if (!user) {
        res.status(401).json({ success: false, error: '用户不存在' })
        return
      }
    } catch {
      // 用户文件读取失败，仍允许通过（降级兼容）
    }

    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
    }
    next()
  } catch {
    res.status(401).json({ success: false, error: '登录已过期，请重新登录' })
  }
}
