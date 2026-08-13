import { useState, useEffect, useCallback } from 'react';
import { Activity, RefreshCw, ArrowLeft, ChevronRight, CheckCircle, XCircle, Loader, Clock, Filter } from 'lucide-react';
import Navbar from '@/components/Navbar';

// ===== 类型定义（与后端 db/types.ts 对齐）=====

interface Trace {
  traceId: string;
  rootSessionId: string;
  userMessage: string;
  createdAt: string;
  status: string;
  totalDurationMs: number | null;
  spanCount: number | null;
}

interface TraceSpan {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  agentName: string;
  action: string;
  inputJson: string | null;
  outputJson: string | null;
  startTime: number;
  endTime: number | null;
  durationMs: number | null;
  status: string;
  retryCount: number;
  errorMessage: string | null;
  attributes: string | null;
}

interface TraceDetail {
  trace: Trace;
  spans: TraceSpan[];
}

// ===== 工具函数 =====

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem('auth_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(ts: number | string): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function statusBadge(status: string) {
  const map: Record<string, { color: string; icon: typeof CheckCircle }> = {
    success: { color: 'bg-green-100 text-green-700', icon: CheckCircle },
    failed: { color: 'bg-red-100 text-red-700', icon: XCircle },
    running: { color: 'bg-blue-100 text-blue-700', icon: Loader },
    skipped: { color: 'bg-gray-100 text-gray-500', icon: ChevronRight },
  };
  const cfg = map[status] || { color: 'bg-gray-100 text-gray-600', icon: ChevronRight };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
      <Icon className={`w-3 h-3 ${status === 'running' ? 'animate-spin' : ''}`} />
      {status}
    </span>
  );
}

// 构建 span 树：返回按 startTime 排序的扁平列表 + 缩进层级
function buildSpanTree(spans: TraceSpan[]): Array<TraceSpan & { level: number }> {
  const sorted = [...spans].sort((a, b) => a.startTime - b.startTime);
  const byId = new Map(sorted.map(s => [s.spanId, s]));
  const childrenOf = new Map<string | null, TraceSpan[]>();
  for (const s of sorted) {
    const parent = s.parentSpanId && byId.has(s.parentSpanId) ? s.parentSpanId : null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent)!.push(s);
  }
  const result: Array<TraceSpan & { level: number }> = [];
  const walk = (parentId: string | null, level: number) => {
    const kids = childrenOf.get(parentId) || [];
    for (const k of kids) {
      result.push({ ...k, level });
      walk(k.spanId, level + 1);
    }
  };
  walk(null, 0);
  return result;
}

// ===== 主组件 =====

export default function Traces() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedTrace, setSelectedTrace] = useState<TraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedSpans, setExpandedSpans] = useState<Set<string>>(new Set());

  const fetchTraces = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '100');
      const res = await fetch(`/api/traces?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTraces(data.traces || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces]);

  const fetchTraceDetail = async (traceId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/traces/${traceId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSelectedTrace(data);
      // 默认展开根 span
      const rootSpans = (data.spans as TraceSpan[]).filter(s => !s.parentSpanId);
      setExpandedSpans(new Set(rootSpans.map(s => s.spanId)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleSpan = (spanId: string) => {
    setExpandedSpans(prev => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  };

  // ===== 详情视图：Span 调用树时间线 =====
  function renderDetail() {
    if (detailLoading) {
      return <div className="p-8 text-center text-gray-400"><Loader className="w-5 h-5 animate-spin inline mr-2" />加载调用链...</div>;
    }
    if (!selectedTrace) return null;

    const { trace, spans } = selectedTrace;
    const tree = buildSpanTree(spans);
    const traceStart = Math.min(...spans.map(s => s.startTime));
    const traceEnd = Math.max(...spans.map(s => s.endTime || s.startTime));
    const traceTotal = traceEnd - traceStart || 1;

    return (
      <div>
        {/* 返回按钮 + Trace 概览 */}
        <button
          onClick={() => setSelectedTrace(null)}
          className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-purple-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> 返回列表
        </button>

        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            {statusBadge(trace.status)}
            <span className="text-xs text-gray-400 font-mono">{trace.traceId}</span>
          </div>
          <div className="text-sm text-gray-700 mb-3 line-clamp-2">{trace.userMessage || '(无消息)'}</div>
          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />总耗时 {formatDuration(trace.totalDurationMs)}</span>
            <span>Span 数 {trace.spanCount ?? spans.length}</span>
            <span>会话 {trace.rootSessionId.substring(0, 20)}...</span>
            <span>{new Date(trace.createdAt).toLocaleString('zh-CN')}</span>
          </div>
        </div>

        {/* Span 时间线 */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 font-medium text-gray-700 text-sm flex items-center gap-2">
            <Activity className="w-4 h-4 text-purple-500" />
            调用链路（{spans.length} 个 span）
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Agent / 操作</th>
                  <th className="text-left px-4 py-2 font-medium w-32">状态</th>
                  <th className="text-left px-4 py-2 font-medium w-24">耗时</th>
                  <th className="text-left px-4 py-2 font-medium w-24">重试</th>
                  <th className="text-left px-4 py-2 font-medium w-64">时间线</th>
                </tr>
              </thead>
              <tbody>
                {tree.map((span) => {
                  const hasChildren = spans.some(s => s.parentSpanId === span.spanId);
                  const expanded = expandedSpans.has(span.spanId);
                  const leftPct = ((span.startTime - traceStart) / traceTotal) * 100;
                  const widthPct = Math.max(((span.durationMs || 0) / traceTotal) * 100, 2);
                  const barColor = span.status === 'success' ? 'bg-green-400'
                    : span.status === 'failed' ? 'bg-red-400'
                    : span.status === 'running' ? 'bg-blue-400'
                    : 'bg-gray-300';
                  return (
                    <tr key={span.spanId} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <div className="flex items-center" style={{ paddingLeft: `${span.level * 20}px` }}>
                          {hasChildren ? (
                            <button onClick={() => toggleSpan(span.spanId)} className="mr-1 text-gray-400 hover:text-gray-600">
                              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                            </button>
                          ) : (
                            <span className="w-3.5 mr-1 inline-block" />
                          )}
                          <span className="font-medium text-gray-700">{span.agentName}</span>
                          <span className="text-gray-400 mx-1">·</span>
                          <span className="text-gray-500 font-mono text-xs">{span.action}</span>
                        </div>
                        {span.errorMessage && (
                          <div className="text-xs text-red-500 mt-1" style={{ paddingLeft: `${span.level * 20 + 24}px` }}>
                            ⚠ {span.errorMessage.substring(0, 120)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">{statusBadge(span.status)}</td>
                      <td className="px-4 py-2 text-gray-600 font-mono text-xs">{formatDuration(span.durationMs)}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">{span.retryCount > 0 ? `${span.retryCount}次` : '-'}</td>
                      <td className="px-4 py-2">
                        <div className="relative h-5 bg-gray-100 rounded">
                          <div
                            className={`absolute h-full rounded ${barColor} transition-all`}
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            title={`${formatTime(span.startTime)} → ${span.endTime ? formatTime(span.endTime) : '...'}`}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ===== 列表视图 =====
  function renderList() {
    if (loading && traces.length === 0) {
      return <div className="p-12 text-center text-gray-400"><Loader className="w-5 h-5 animate-spin inline mr-2" />加载中...</div>;
    }
    if (traces.length === 0) {
      return <div className="p-12 text-center text-gray-400">暂无链路追踪数据。<br /><span className="text-xs">通过 AI 助手发起任务后将自动生成 Trace。</span></div>;
    }
    return (
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium">状态</th>
              <th className="text-left px-4 py-3 font-medium">用户消息</th>
              <th className="text-left px-4 py-3 font-medium w-28">耗时</th>
              <th className="text-left px-4 py-3 font-medium w-20">Span</th>
              <th className="text-left px-4 py-3 font-medium w-44">创建时间</th>
              <th className="text-left px-4 py-3 font-medium w-20"></th>
            </tr>
          </thead>
          <tbody>
            {traces.map((t) => (
              <tr
                key={t.traceId}
                onClick={() => fetchTraceDetail(t.traceId)}
                className="border-t border-gray-50 hover:bg-purple-50/50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3">{statusBadge(t.status)}</td>
                <td className="px-4 py-3 text-gray-700 max-w-md truncate">{t.userMessage || '(无消息)'}</td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{formatDuration(t.totalDurationMs)}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{t.spanCount ?? '-'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{new Date(t.createdAt).toLocaleString('zh-CN')}</td>
                <td className="px-4 py-3 text-gray-400"><ChevronRight className="w-4 h-4" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 pt-20 pb-12">
        {/* 页头 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Activity className="w-6 h-6 text-purple-500" />
              链路追踪
            </h1>
            <p className="text-sm text-gray-500 mt-1">Agent 调度调用链路、耗时分析与失败归因</p>
          </div>
          <div className="flex items-center gap-2">
            {!selectedTrace && (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-600 focus:outline-none focus:border-purple-400"
              >
                <option value="">全部状态</option>
                <option value="success">成功</option>
                <option value="failed">失败</option>
                <option value="running">运行中</option>
              </select>
            )}
            <button
              onClick={() => (selectedTrace ? setSelectedTrace(null) : fetchTraces())}
              className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 transition-colors"
              title="刷新"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2">
            <XCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {selectedTrace ? renderDetail() : renderList()}
      </div>
    </div>
  );
}
