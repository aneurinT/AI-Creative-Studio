import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 日志目录
const LOGS_DIR = path.join(__dirname, '../logs');
const MAX_LOG_FILES = 30; // 最多保留 30 个日志文件
const MAX_LOG_SIZE_MB = 50; // 单个日志文件最大 50MB

// ===== 日志级别 =====
type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS' | 'DEBUG';

// ===== 日志条目结构 =====
interface LogEntry {
  timestamp: string;       // ISO 时间
  level: LogLevel;
  category: string;        // 分类：user-action | agent-operation | api-request | system
  userId?: string;         // 操作用户
  sessionId?: string;      // 会话 ID
  operation: string;       // 操作名称
  detail: string;          // 操作详情（可包含 JSON）
  duration?: number;       // 耗时（ms）
  result?: 'success' | 'failure' | 'pending';
  error?: string;          // 错误信息
  metadata?: Record<string, any>; // 额外元数据
}

// 当前日期的日志文件路径
function getTodayLogPath(): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return path.join(LOGS_DIR, `operations-${dateStr}.log`);
}

// 确保日志目录存在
function ensureLogDir(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

// 清理过期日志文件
function cleanOldLogs(): void {
  try {
    const files = fs.readdirSync(LOGS_DIR)
      .filter(f => f.startsWith('operations-') && f.endsWith('.log'))
      .map(f => ({ name: f, path: path.join(LOGS_DIR, f), mtime: fs.statSync(path.join(LOGS_DIR, f)).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // 超过数量限制的删除
    if (files.length > MAX_LOG_FILES) {
      files.slice(MAX_LOG_FILES).forEach(f => {
        fs.unlinkSync(f.path);
      });
    }

    // 检查当前日志文件大小
    const todayPath = getTodayLogPath();
    if (fs.existsSync(todayPath)) {
      const stats = fs.statSync(todayPath);
      if (stats.size > MAX_LOG_SIZE_MB * 1024 * 1024) {
        // 重命名旧文件
        const backupPath = todayPath.replace('.log', `-${Date.now()}.log`);
        fs.renameSync(todayPath, backupPath);
      }
    }
  } catch {
    // 清理失败不影响主流程
  }
}

// 格式化日志行
function formatLogEntry(entry: LogEntry): string {
  const parts: string[] = [
    `[${entry.timestamp}]`,
    `[${entry.level}]`,
    `[${entry.category}]`,
  ];

  if (entry.userId) parts.push(`[user:${entry.userId}]`);
  if (entry.sessionId) parts.push(`[session:${entry.sessionId}]`);
  parts.push(`[${entry.operation}]`);

  let line = parts.join(' ') + ' | ';

  // 详情（限制长度，防止日志过大）
  const detailStr = typeof entry.detail === 'string'
    ? entry.detail.substring(0, 2000)
    : JSON.stringify(entry.detail).substring(0, 2000);
  line += detailStr;

  if (entry.duration !== undefined) line += ` | duration=${entry.duration}ms`;
  if (entry.result) line += ` | result=${entry.result}`;
  if (entry.error) line += ` | error=${entry.error.substring(0, 500)}`;
  if (entry.metadata) {
    const metaStr = JSON.stringify(entry.metadata).substring(0, 1000);
    line += ` | metadata=${metaStr}`;
  }

  return line + '\n';
}

// 写入日志
function writeLog(entry: LogEntry): void {
  try {
    ensureLogDir();
    cleanOldLogs();

    const logPath = getTodayLogPath();
    const line = formatLogEntry(entry);
    fs.appendFileSync(logPath, line, 'utf-8');

    // 同时输出到控制台（生产环境可通过 LOG_LEVEL 控制）
    const consoleMethod = entry.level === 'ERROR' ? console.error
      : entry.level === 'WARN' ? console.warn
        : console.log;
    consoleMethod(`[Logger] ${entry.operation} | ${entry.result || ''} | ${entry.detail?.substring(0, 80) || ''}`);
  } catch (err) {
    // 日志写入失败不能阻塞主流程
    console.error('[Logger] Failed to write log:', (err as Error).message);
  }
}

// ===== 公开 API =====

/** 记录用户操作 */
export function logUserAction(params: {
  userId?: string;
  sessionId?: string;
  operation: string;
  detail: string;
  result?: 'success' | 'failure';
  duration?: number;
  error?: string;
  metadata?: Record<string, any>;
}): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: params.result === 'failure' ? 'ERROR' : 'INFO',
    category: 'user-action',
    userId: params.userId || 'anonymous',
    sessionId: params.sessionId,
    operation: params.operation,
    detail: params.detail,
    duration: params.duration,
    result: params.result || 'success',
    error: params.error,
    metadata: params.metadata,
  });
}

/** 记录 Agent 操作 */
export function logAgentOperation(params: {
  agentName: string;
  agentRole: string;
  userId?: string;
  sessionId?: string;
  operation: string;
  detail: string;
  result?: 'success' | 'failure' | 'pending';
  duration?: number;
  error?: string;
  input?: string;
  output?: string;
}): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: params.result === 'failure' ? 'ERROR' : params.result === 'pending' ? 'WARN' : 'INFO',
    category: 'agent-operation',
    userId: params.userId || 'anonymous',
    sessionId: params.sessionId,
    operation: `[${params.agentName}] ${params.operation}`,
    detail: params.detail,
    duration: params.duration,
    result: params.result || 'success',
    error: params.error,
    metadata: {
      agentName: params.agentName,
      agentRole: params.agentRole,
      input: params.input?.substring(0, 500),
      output: params.output?.substring(0, 500),
    },
  });
}

/** 记录 API 请求 */
export function logApiRequest(params: {
  method: string;
  path: string;
  userId?: string;
  sessionId?: string;
  detail: string;
  result?: 'success' | 'failure';
  duration?: number;
  error?: string;
  requestBody?: string;
  responseSummary?: string;
}): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: params.result === 'failure' ? 'ERROR' : 'INFO',
    category: 'api-request',
    userId: params.userId || 'anonymous',
    sessionId: params.sessionId,
    operation: `${params.method} ${params.path}`,
    detail: params.detail,
    duration: params.duration,
    result: params.result || 'success',
    error: params.error,
    metadata: {
      requestBody: params.requestBody?.substring(0, 500),
      response: params.responseSummary?.substring(0, 500),
    },
  });
}

/** 记录系统事件 */
export function logSystemEvent(params: {
  operation: string;
  detail: string;
  level?: LogLevel;
  error?: string;
}): void {
  writeLog({
    timestamp: new Date().toISOString(),
    level: params.level || 'INFO',
    category: 'system',
    operation: params.operation,
    detail: params.detail,
    error: params.error,
  });
}

/** 导出日志查看（调试用） */
export function getRecentLogs(lines: number = 100): string {
  try {
    const logPath = getTodayLogPath();
    if (!fs.existsSync(logPath)) return '';
    const content = fs.readFileSync(logPath, 'utf-8');
    const allLines = content.split('\n').filter(l => l.trim());
    return allLines.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

// 启动时记录
logSystemEvent({
  operation: 'LoggerService',
  detail: '日志服务初始化完成',
  level: 'INFO',
});
