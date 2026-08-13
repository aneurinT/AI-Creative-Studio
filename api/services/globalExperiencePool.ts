/**
 * 全局 Agent 经验池 (Global Experience Pool)
 *
 * 基于历史执行数据，自动总结规律，优化 Agent 调度策略。
 *
 * 核心能力：
 * 1. 经验收集：自动记录每个 Agent 任务的执行结果（成功/失败/耗时/重试）
 * 2. 经验查询：根据当前任务上下文，查询历史最佳实践
 * 3. 智能优化：基于经验池数据，优化 Agent 选择和参数配置
 * 4. 定期总结：调用 LLM 分析失败经验，生成优化建议
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== 类型定义 =====

export interface ExperienceEntry {
  id: string;
  /** 用户原始消息摘要（用于模式匹配） */
  messagePattern: string;
  /** Agent 名称 */
  agentName: string;
  /** Action 类型 */
  action: string;
  /** 使用的参数（JSON 摘要） */
  paramsSummary: string;
  /** 执行状态 */
  status: 'success' | 'failed';
  /** 耗时（ms） */
  durationMs: number;
  /** 重试次数 */
  retryCount: number;
  /** 错误信息（如果失败） */
  errorMessage?: string;
  /** 结果摘要（成功时） */
  resultSummary?: string;
  /** 时间戳 */
  timestamp: number;
  /** 使用/命中次数 */
  hitCount: number;
  /** 成功率（聚合更新） */
  successRate: number;
}

export interface ExperienceStats {
  totalEntries: number;
  successEntries: number;
  failedEntries: number;
  topAgents: Array<{ agentName: string; successRate: number; avgDuration: number }>;
  topActions: Array<{ action: string; count: number; successRate: number }>;
  recentFailures: ExperienceEntry[];
}

// ===== 存储层 =====

const EXPERIENCE_FILE = path.join(__dirname, '../data/agent_experiences.json');
let experienceCache: ExperienceEntry[] = [];
let cacheLoaded = false;
let lastCleanTime = 0;

/** 从文件加载经验池 */
function loadExperience(): ExperienceEntry[] {
  if (cacheLoaded) return experienceCache;
  try {
    if (fs.existsSync(EXPERIENCE_FILE)) {
      const raw = fs.readFileSync(EXPERIENCE_FILE, 'utf-8');
      experienceCache = JSON.parse(raw);
      
      // 清理 30 天前的旧记录
      const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const before = experienceCache.length;
      experienceCache = experienceCache.filter(e => e.timestamp > monthAgo);
      if (experienceCache.length < before) {
        console.log(`[ExperiencePool] 清理了 ${before - experienceCache.length} 条过期经验`);
      }
    }
    cacheLoaded = true;
  } catch (e) {
    console.error('[ExperiencePool] Load failed:', e);
    experienceCache = [];
  }
  return experienceCache;
}

/** 保存经验池到文件 */
function saveExperience(): void {
  try {
    const dir = path.dirname(EXPERIENCE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(EXPERIENCE_FILE, JSON.stringify(experienceCache, null, 2));
  } catch (e) {
    console.error('[ExperiencePool] Save failed:', e);
  }
}

/** 节流保存（避免频繁 IO） */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveExperience();
  }, 2000);
}

// ===== 经验收集 =====

/** 提取消息模式（用于相似性匹配） */
function extractMessagePattern(message: string): string {
  const lower = message.toLowerCase();
  // 提取关键意图词
  const intentKeywords = ['生成', '制作', '创建', '画', '视频', '图片', '图像', '修改', '抠图', '去背景', '合成', '风格', '动漫', '写实', '3D', '插画', '海报', '宣传片', '广告'];
  const found = intentKeywords.filter(k => lower.includes(k));
  return found.sort().join('|') || lower.substring(0, 50);
}

/** 记录一次 Agent 执行经验 */
export function recordExperience(params: {
  message: string;
  agentName: string;
  action: string;
  params: Record<string, any>;
  status: 'success' | 'failed';
  durationMs: number;
  retryCount: number;
  errorMessage?: string;
  resultSummary?: string;
}): void {
  const exp = loadExperience();
  const pattern = extractMessagePattern(params.message);
  
  // 查找是否已有相似经验（同 agentName + action + pattern）
  const existing = exp.find(e => 
    e.agentName === params.agentName && 
    e.action === params.action && 
    e.messagePattern === pattern
  );

  if (existing) {
    // 更新已有经验（聚合统计）
    existing.hitCount++;
    existing.timestamp = Date.now();
    existing.paramsSummary = JSON.stringify(params.params).substring(0, 500);
    existing.durationMs = Math.round((existing.durationMs * (existing.hitCount - 1) + params.durationMs) / existing.hitCount);
    existing.retryCount = Math.max(existing.retryCount, params.retryCount);
    existing.status = params.status;
    if (params.errorMessage) existing.errorMessage = params.errorMessage.substring(0, 200);
    if (params.resultSummary) existing.resultSummary = params.resultSummary.substring(0, 200);
    // 更新成功率
    const successCount = (existing.successRate * existing.hitCount) + (params.status === 'success' ? 1 : 0);
    existing.successRate = successCount / existing.hitCount;
  } else {
    // 新增经验
    exp.push({
      id: `exp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      messagePattern: pattern,
      agentName: params.agentName,
      action: params.action,
      paramsSummary: JSON.stringify(params.params).substring(0, 500),
      status: params.status,
      durationMs: params.durationMs,
      retryCount: params.retryCount,
      errorMessage: params.errorMessage?.substring(0, 200),
      resultSummary: params.resultSummary?.substring(0, 200),
      timestamp: Date.now(),
      hitCount: 1,
      successRate: params.status === 'success' ? 1.0 : 0.0,
    });
  }

  // 限制最大数量（保留 2000 条最相关的）
  if (exp.length > 2000) {
    // 按命中率 * 成功率排序，保留最有价值的
    exp.sort((a, b) => (b.hitCount * b.successRate) - (a.hitCount * a.successRate));
    experienceCache = exp.slice(0, 2000);
  } else {
    experienceCache = exp;
  }

  scheduleSave();
}

// ===== 经验查询 =====

/** 根据当前任务上下文查询最佳经验 */
export function queryExperience(params: {
  message: string;
  agentName?: string;
  action?: string;
}): ExperienceEntry[] {
  const exp = loadExperience();
  const pattern = extractMessagePattern(params.message);
  
  // 打分排序
  return exp
    .map(entry => {
      let score = 0;
      
      // 精确匹配模式
      if (entry.messagePattern === pattern) score += 100;
      // 部分匹配
      else if (pattern && entry.messagePattern) {
        const tokens1 = new Set(pattern.split('|'));
        const tokens2 = new Set(entry.messagePattern.split('|'));
        const overlap = [...tokens1].filter(t => tokens2.has(t)).length;
        score += overlap * 20;
      }
      
      // 匹配 agentName
      if (params.agentName && entry.agentName === params.agentName) score += 30;
      
      // 匹配 action
      if (params.action && entry.action === params.action) score += 20;
      
      // 历史成功率和权重
      score += entry.successRate * 50;
      score += Math.min(entry.hitCount, 10) * 2; // 最多加 20 分
      
      return { entry, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.entry)
    .slice(0, 5); // 最多返回 5 条相关经验
}

/** 获取经验池统计信息 */
export function getExperienceStats(): ExperienceStats {
  const exp = loadExperience();
  
  const successEntries = exp.filter(e => e.status === 'success');
  const failedEntries = exp.filter(e => e.status === 'failed');
  
  // Top Agents
  const agentMap = new Map<string, { total: number; success: number; durationSum: number }>();
  exp.forEach(e => {
    const agent = agentMap.get(e.agentName) || { total: 0, success: 0, durationSum: 0 };
    agent.total += e.hitCount;
    if (e.status === 'success') agent.success += e.hitCount;
    agent.durationSum += e.durationMs * e.hitCount;
    agentMap.set(e.agentName, agent);
  });
  
  const topAgents = Array.from(agentMap.entries())
    .map(([agentName, data]) => ({
      agentName,
      successRate: data.total > 0 ? data.success / data.total : 0,
      avgDuration: data.total > 0 ? Math.round(data.durationSum / data.total) : 0,
    }))
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, 10);
  
  // Top Actions
  const actionMap = new Map<string, { count: number; success: number }>();
  exp.forEach(e => {
    const action = actionMap.get(e.action) || { count: 0, success: 0 };
    action.count += e.hitCount;
    if (e.status === 'success') action.success += e.hitCount;
    actionMap.set(e.action, action);
  });
  
  const topActions = Array.from(actionMap.entries())
    .map(([action, data]) => ({
      action,
      count: data.count,
      successRate: data.count > 0 ? data.success / data.count : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  // Recent Failures
  const recentFailures = failedEntries
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10);
  
  return {
    totalEntries: exp.length,
    successEntries: successEntries.length,
    failedEntries: failedEntries.length,
    topAgents,
    topActions,
    recentFailures,
  };
}

// ===== 智能优化 =====

/** 基于经验池优化 Agent 选择 */
export function suggestOptimalAgent(message: string, availableAgents: string[]): string | null {
  const exp = loadExperience();
  
  // 查询相关经验
  const related = queryExperience({ message });
  if (related.length === 0) return null;
  
  // 统计各 agent 的成功率
  const agentScores: Record<string, number> = {};
  for (const agent of availableAgents) {
    const agentExp = related.filter(e => e.agentName === agent);
    if (agentExp.length > 0) {
      const avgSuccessRate = agentExp.reduce((sum, e) => sum + e.successRate, 0) / agentExp.length;
      const avgHitCount = agentExp.reduce((sum, e) => sum + e.hitCount, 0) / agentExp.length;
      agentScores[agent] = avgSuccessRate * 100 + Math.log(avgHitCount + 1) * 10;
    }
  }
  
  // 返回得分最高的 agent
  const bestAgent = Object.entries(agentScores)
    .sort((a, b) => b[1] - a[1])[0];
  
  if (bestAgent && bestAgent[1] > 30) { // 最低阈值
    console.log(`[ExperiencePool] 建议使用 Agent: ${bestAgent[0]} (得分: ${bestAgent[1].toFixed(1)})`);
    return bestAgent[0];
  }
  
  return null;
}

/** 基于经验池优化任务参数 */
export function suggestOptimalParams(params: {
  message: string;
  agentName: string;
  action: string;
  currentParams: Record<string, any>;
}): Record<string, any> {
  const related = queryExperience({ 
    message: params.message, 
    agentName: params.agentName,
    action: params.action,
  });
  
  if (related.length === 0) return params.currentParams;
  
  // 选择命中率最高且成功的经验
  const bestMatch = related
    .filter(e => e.status === 'success')
    .sort((a, b) => b.hitCount - a.hitCount)[0];
  
  if (!bestMatch) return params.currentParams;
  
  try {
    const suggestedParams = JSON.parse(bestMatch.paramsSummary);
    console.log(`[ExperiencePool] 使用经验参数 (命中率: ${bestMatch.hitCount}, 成功率: ${(bestMatch.successRate * 100).toFixed(0)}%)`);
    // 合并参数（经验参数为基础，当前参数的特殊字段覆盖）
    return { ...suggestedParams, ...params.currentParams };
  } catch {
    return params.currentParams;
  }
}

// ===== 定期总结 =====

/** 生成经验总结（供前端展示或 Agent 使用） */
export function generateExperienceSummary(): string {
  const stats = getExperienceStats();
  const parts: string[] = [];
  
  parts.push(`📊 **Agent 经验池统计**`);
  parts.push(`- 总经验条目: ${stats.totalEntries}`);
  parts.push(`- 成功经验: ${stats.successEntries}`);
  parts.push(`- 失败经验: ${stats.failedEntries}`);
  
  if (stats.topAgents.length > 0) {
    parts.push(`\n🏆 **最佳 Agents**:`);
    stats.topAgents.slice(0, 3).forEach((a, i) => {
      parts.push(`  ${i + 1}. ${a.agentName} - 成功率 ${(a.successRate * 100).toFixed(0)}%, 平均耗时 ${a.avgDuration}ms`);
    });
  }
  
  if (stats.topActions.length > 0) {
    parts.push(`\n📈 **热门 Actions**:`);
    stats.topActions.slice(0, 3).forEach((a, i) => {
      parts.push(`  ${i + 1}. ${a.action} - 使用 ${a.count} 次, 成功率 ${(a.successRate * 100).toFixed(0)}%`);
    });
  }
  
  if (stats.recentFailures.length > 0) {
    parts.push(`\n⚠️ **最近失败**:`);
    stats.recentFailures.slice(0, 3).forEach(f => {
      parts.push(`  - ${f.agentName}/${f.action}: ${f.errorMessage?.substring(0, 50) || '未知错误'}`);
    });
  }
  
  return parts.join('\n');
}

// ===== 初始化 =====

/** 初始化经验池（启动时调用） */
export function initializeExperiencePool(): void {
  loadExperience();
  const stats = getExperienceStats();
  console.log(`[ExperiencePool] 初始化完成: ${stats.totalEntries} 条经验, ${stats.successEntries} 成功, ${stats.failedEntries} 失败`);
}

/** 强制保存（供服务器关闭时调用） */
export function flushExperiencePool(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveExperience();
  console.log('[ExperiencePool] 经验池已保存');
}
