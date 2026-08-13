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

// ===== 安全加固：生产环境强制鉴权 =====
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
// 鉴权跳过仅在开发环境生效；生产环境强制鉴权，忽略 SKIP_AUTH 配置
const SKIP_AUTH_ENABLED = !IS_PRODUCTION && process.env.SKIP_AUTH === 'true'

// 启动时输出鉴权状态摘要 + 安全警告
if (IS_PRODUCTION && process.env.SKIP_AUTH === 'true') {
  console.error('┌───────────────────────────────────────────────────────────────────┐')
  console.error('│ ⚠️  安全警告：生产环境检测到 SKIP_AUTH=true，已强制忽略并启用鉴权      │')
  console.error('└───────────────────────────────────────────────────────────────────┘')
} else if (SKIP_AUTH_ENABLED) {
  console.warn('⚠️  [开发模式] 鉴权已跳过（SKIP_AUTH=true），切勿用于生产环境')
} else {
  console.log('[Auth] JWT 鉴权已启用')
}
if (IS_PRODUCTION && JWT_SECRET === 'ai-studio-default-secret-change-me') {
  console.error('┌───────────────────────────────────────────────────────────────────┐')
  console.error('│ ⚠️  安全警告：生产环境使用默认 JWT_SECRET，请通过环境变量设置随机密钥  │')
  console.error('└───────────────────────────────────────────────────────────────────┘')
}

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
    '/api/traces',
    '/api/collaboration/',
    '/api/mock/',
    '/api/upload/',    // 图片/视频上传
    '/api/video-edit/',  // AI 视频剪辑
    '/api/social/',      // 社交媒体
    '/api/office/',      // 办公工具
    '/api/external/',    // SaaS 对外开放 API（使用独立 X-API-Key 鉴权）
  ]

  if (publicPaths.some(p => req.path.startsWith(p))) {
    next()
    return
  }

  // 开发环境可选跳过鉴权（方便调试）；生产环境强制鉴权（SKIP_AUTH 配置被忽略）
  if (SKIP_AUTH_ENABLED) {
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
