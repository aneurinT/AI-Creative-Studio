/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'

// 日志级别控制：生产环境设置 LOG_LEVEL=warn 减少日志输出
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase()
const LOG_LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 }
const currentLogLevel = LOG_LEVELS[LOG_LEVEL] ?? 1

// 全局替换 console.log，在生产环境减少输出
const originalLog = console.log
const originalWarn = console.warn
const originalError = console.error

console.log = (...args: any[]) => {
  if (currentLogLevel <= LOG_LEVELS.info) originalLog(...args)
}
console.debug = (...args: any[]) => {
  if (currentLogLevel <= LOG_LEVELS.debug) originalLog('[DEBUG]', ...args)
}
console.warn = (...args: any[]) => {
  if (currentLogLevel <= LOG_LEVELS.warn) originalWarn(...args)
}
console.error = (...args: any[]) => {
  if (currentLogLevel <= LOG_LEVELS.error) originalError(...args)
}
import { authMiddleware } from './middleware/auth.js'
import { rateLimitMiddleware, timeoutMiddleware, trackConnection, untrackConnection } from './services/concurrencyService.js'
import authRoutes from './routes/auth.js'
import generateRoutes from './routes/generate.js'
import historyRoutes from './routes/history.js'
import removeBgRoutes from './routes/removeBg.js'
import configRoutes from './routes/config.js'
import testRoutes from './routes/test.js'
import videoRoutes from './routes/video.js'
import quotaRoutes from './routes/quota.js'
import storyboardRoutes from './routes/storyboard.js'
import hermesRoutes from './routes/hermes.js'
import mockRoutes from './routes/mock.js'
import agentsRoutes from './routes/agents.js'
import uploadRoutes from './routes/upload.js'
import chatRoutes from './routes/chat.js'
import ltxRoutes from './routes/ltx.js'
import knowledgeRoutes from './routes/knowledge.js'
import ocrRoutes from './routes/ocr.js'
import collaborationRoutes from './routes/collaboration.js'
import a2aRoutes from './routes/a2a.js'
import socialMediaRoutes from './routes/socialMedia.js'
import officeRoutes from './routes/office.js'
import videoEditRoutes from './routes/videoEdit.js'
import { registerMCPRoutes } from './services/toolRegistry.js'
import { seedKnowledgeBase } from './services/ragKnowledge.js'
import { getConcurrencyStats } from './services/concurrencyService.js'
import { cleanupExpiredCheckpoints } from './services/checkpointService.js'

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use('/images', express.static(path.join(__dirname, 'public/images')))
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')))
app.use('/videos', express.static(path.join(__dirname, 'public/videos')))
app.use('/edits', express.static(path.join(__dirname, 'public/edits')))

/** 高并发保护中间件 — 限流 + 超时 + 连接追踪 */
app.use(rateLimitMiddleware);
app.use(timeoutMiddleware(60000));
app.use((req: Request, res: Response, next: NextFunction) => {
  trackConnection();
  res.on('finish', () => untrackConnection());
  next();
});

/**
 * JWT 鉴权中间件
 * auth 路由和静态资源不经过鉴权
 */
app.use(authMiddleware)

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/generate', generateRoutes)
app.use('/api/history', historyRoutes)
app.use('/api/remove-bg', removeBgRoutes)
app.use('/api/config', configRoutes)
app.use('/api/test', testRoutes)
app.use('/api/video', videoRoutes)
app.use('/api/quota', quotaRoutes)
app.use('/api/storyboard', storyboardRoutes)
app.use('/api/hermes', hermesRoutes)
app.use('/api/mock', mockRoutes)
app.use('/api/agents', agentsRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/ltx', ltxRoutes)
app.use('/api/knowledge', knowledgeRoutes)
app.use('/api/ocr', ocrRoutes)
app.use('/api/collaboration', collaborationRoutes)
app.use('/api/a2a', a2aRoutes)
app.use('/api/social', socialMediaRoutes)
app.use('/api/office', officeRoutes)
app.use('/api/video-edit', videoEditRoutes)

// A2A Agent Card 发现端点（无需 /api 前缀，符合 A2A 规范）
app.use(a2aRoutes)

// MCP 协议 + Tool Registry 路由
const mcpRouter = express.Router();
registerMCPRoutes(mcpRouter);
app.use('/api', mcpRouter);

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
      concurrency: getConcurrencyStats(),
    })
  },
)

// 服务启动后异步初始化向量知识库 & 清理过期检查点
setTimeout(() => {
  seedKnowledgeBase().catch(err => console.warn('[Startup] 知识库种子导入失败:', err.message));
  cleanupExpiredCheckpoints();
}, 3000);

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[ErrorHandler] URL:', req.method, req.url);
  console.error('[ErrorHandler] Body:', JSON.stringify(req.body).substring(0, 200));
  console.error('[ErrorHandler] Message:', error.message);
  console.error('[ErrorHandler] Stack:', error.stack?.split('\n').slice(0, 5).join(' | '));
  res.status(500).json({
    success: false,
    error: `Server internal error: ${error.message}`,
  })
})

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
