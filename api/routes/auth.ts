/**
 * 用户认证 API
 * 使用 bcryptjs 加密密码 + jsonwebtoken 签发 Token
 * 用户数据存储在 data/users.json
 */
import { Router, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const JWT_SECRET = process.env.JWT_SECRET || 'ai-studio-default-secret-change-me'
const TOKEN_EXPIRES_IN = process.env.TOKEN_EXPIRES_IN || '7d'
const USERS_FILE = path.join(__dirname, '../../data/users.json')

interface StoredUser {
  id: string
  username: string
  passwordHash: string
  displayName: string
  avatar?: string
  role: 'admin' | 'user'
  createdAt: number
}

function readUsers(): StoredUser[] {
  try {
    if (!fs.existsSync(USERS_FILE)) return []
    const data = fs.readFileSync(USERS_FILE, 'utf-8')
    return JSON.parse(data) as StoredUser[]
  } catch {
    return []
  }
}

function writeUsers(users: StoredUser[]): void {
  const dir = path.dirname(USERS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2))
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

function generateToken(user: StoredUser): string {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRES_IN },
  )
}

const router = Router()

// ========================
// 首次启动：自动创建默认管理员账号
// ========================
function ensureDefaultAdmin(): void {
  const users = readUsers()
  if (users.length > 0) return // 已有用户，不重复创建

  const defaultAdmin: StoredUser = {
    id: 'admin-default',
    username: 'admin',
    passwordHash: bcrypt.hashSync('admin123', 10),
    displayName: '管理员',
    role: 'admin',
    createdAt: Date.now(),
  }

  users.push(defaultAdmin)
  writeUsers(users)
  console.log('[Auth] 默认管理员账号已创建: admin / admin123')
}

// 模块加载时执行
ensureDefaultAdmin()

/**
 * 用户注册
 * POST /api/auth/register
 * Body: { username, password, displayName? }
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password, displayName } = req.body as Record<string, string>

    if (!username || !password) {
      res.status(400).json({ success: false, error: '用户名和密码不能为空' })
      return
    }

    if (username.length < 2 || username.length > 20) {
      res.status(400).json({ success: false, error: '用户名长度需在 2-20 个字符之间' })
      return
    }

    if (password.length < 4) {
      res.status(400).json({ success: false, error: '密码长度至少 4 个字符' })
      return
    }

    const users = readUsers()
    if (users.find(u => u.username === username)) {
      res.status(409).json({ success: false, error: '用户名已存在' })
      return
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user: StoredUser = {
      id: generateId(),
      username,
      passwordHash,
      displayName: displayName || username,
      role: users.length === 0 ? 'admin' : 'user',
      createdAt: Date.now(),
    }

    users.push(user)
    writeUsers(users)

    const token = generateToken(user)

    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
      token,
    })
  } catch (error) {
    console.error('[Auth] Register error:', error)
    res.status(500).json({ success: false, error: '注册失败' })
  }
})

/**
 * 用户登录
 * POST /api/auth/login
 * Body: { username, password }
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body as Record<string, string>

    if (!username || !password) {
      res.status(400).json({ success: false, error: '用户名和密码不能为空' })
      return
    }

    const users = readUsers()
    const user = users.find(u => u.username === username)
    if (!user) {
      res.status(401).json({ success: false, error: '用户名或密码错误' })
      return
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      res.status(401).json({ success: false, error: '用户名或密码错误' })
      return
    }

    const token = generateToken(user)

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
      token,
    })
  } catch (error) {
    console.error('[Auth] Login error:', error)
    res.status(500).json({ success: false, error: '登录失败' })
  }
})

/**
 * 退出登录
 * POST /api/auth/logout
 * (前端清除 token 即可，后端无状态)
 */
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, message: '已退出登录' })
})

/**
 * 获取当前用户信息
 * GET /api/auth/me
 * Header: Authorization: Bearer <token>
 */
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: '未登录' })
      return
    }

    const token = authHeader.slice(7)
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; username: string }
    const users = readUsers()
    const user = users.find(u => u.id === decoded.userId)
    if (!user) {
      res.status(401).json({ success: false, error: '用户不存在' })
      return
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    })
  } catch {
    res.status(401).json({ success: false, error: '登录已过期' })
  }
})

export default router
