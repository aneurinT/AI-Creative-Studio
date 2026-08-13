/**
 * 轻量级 Tracing 工具
 *
 * 提供 startSpan / endSpan / createTrace / finishTrace 工具函数，
 * 供 orchestrator.ts 埋点使用。span 数据通过 DatabaseAdapter 持久化
 * （JsonAdapter 用 traces.json/trace_spans.json，SqliteAdapter 用 traces/trace_spans 表）。
 *
 * 与 addOperationLog 并行存在：tracing 是结构化 span 树，operationLog 是兼容旧运维的文本日志。
 */
import { randomUUID } from 'crypto';
import { getDb } from './db/index.js';
import type { Trace, TraceSpan } from './db/types.js';

const MAX_JSON_LEN = 2000;

function truncate(s: string, max = MAX_JSON_LEN): string {
  return s.length > max ? s.substring(0, max) + '...[truncated]' : s;
}

function safeStringify(obj: any): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return '{}';
  }
}

/** 活跃 span 句柄（埋点期间持有，结束时用于更新） */
export interface ActiveSpan {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  agentName: string;
  action: string;
  startTime: number;
  retryCount: number;
}

/** 创建 trace 根记录 */
export function createTrace(traceId: string, sessionId: string, userMessage: string): void {
  try {
    const trace: Trace = {
      traceId,
      rootSessionId: sessionId,
      userMessage: userMessage.substring(0, 500),
      createdAt: new Date().toISOString(),
      status: 'running',
      totalDurationMs: null,
      spanCount: null,
    };
    getDb().addTrace(trace);
  } catch (e) {
    console.warn('[Tracing] createTrace failed:', (e as Error).message);
  }
}

/** 完成 trace（汇总耗时和 span 数） */
export function finishTrace(
  traceId: string,
  status: 'success' | 'failed',
  totalDurationMs: number,
  spanCount: number,
): void {
  try {
    getDb().updateTrace(traceId, { status, totalDurationMs, spanCount });
  } catch (e) {
    console.warn('[Tracing] finishTrace failed:', (e as Error).message);
  }
}

/** 开始一个 span（立即落库 status=running） */
export function startSpan(
  traceId: string,
  parentSpanId: string | null,
  agentName: string,
  action: string,
  input?: any,
  attributes?: Record<string, any>,
): ActiveSpan {
  const spanId = randomUUID();
  const startTime = Date.now();
  const span: TraceSpan = {
    spanId,
    traceId,
    parentSpanId,
    agentName,
    action,
    inputJson: input ? truncate(safeStringify(input)) : null,
    outputJson: null,
    startTime,
    endTime: null,
    durationMs: null,
    status: 'running',
    retryCount: 0,
    errorMessage: null,
    attributes: attributes ? truncate(safeStringify(attributes)) : null,
  };
  try {
    getDb().addTraceSpan(span);
  } catch (e) {
    console.warn('[Tracing] startSpan failed:', (e as Error).message);
  }
  return { spanId, traceId, parentSpanId, agentName, action, startTime, retryCount: 0 };
}

/** 结束一个 span（更新 endTime/duration/status/output/error） */
export function endSpan(
  span: ActiveSpan,
  status: 'success' | 'failed' | 'skipped',
  output?: any,
  error?: string,
): void {
  const endTime = Date.now();
  try {
    getDb().updateTraceSpan(span.spanId, {
      endTime,
      durationMs: endTime - span.startTime,
      status,
      outputJson: output ? truncate(safeStringify(output)) : null,
      errorMessage: error ? error.substring(0, 500) : null,
      retryCount: span.retryCount,
    });
  } catch (e) {
    console.warn('[Tracing] endSpan failed:', (e as Error).message);
  }
}

/** 更新 span 的重试次数 */
export function setSpanRetryCount(span: ActiveSpan, retryCount: number): void {
  span.retryCount = retryCount;
}
