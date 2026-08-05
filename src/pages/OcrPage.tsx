import { useState, useRef, useCallback } from 'react';
import {
  Upload, Link, Trash2, FileText, Loader2, Copy, Check,
  Image as ImageIcon, X, Plus, Play, Download, Eye, AlertCircle,
  ChevronDown, ChevronUp, Table, Code, Zap
} from 'lucide-react';
import Navbar from '@/components/Navbar';

// ==================== 类型定义 ====================

interface OcrTable {
  caption?: string;
  headers: string[];
  rows: string[][];
  position?: string;
}

interface OcrResult {
  hasText: boolean;
  language?: string;
  title?: string;
  fullText?: string;
  textBlocks?: Array<{ position: string; type: string; text: string }>;
  tables?: OcrTable[];
  totalChars?: number;
  summary?: string;
  message?: string;
}

interface ImageItem {
  id: string;
  source: 'upload' | 'url';
  url: string;        // 展示用的 dataUrl 或 http url
  name: string;       // 文件名或链接
  status: 'idle' | 'loading' | 'done' | 'error';
  ocrResult?: OcrResult;
  error?: string;
  model?: string;
}

interface BatchSummary {
  total: number;
  successCount: number;
  failCount: number;
  totalChars: number;
}

// ==================== 工具函数 ====================

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ==================== 组件 ====================

export default function OcrPage() {
  // 图片列表
  const [images, setImages] = useState<ImageItem[]>([]);
  // 链接输入
  const [urlInput, setUrlInput] = useState('');
  // 链接预览
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // 批量识别
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  // 当前查看的图片索引
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // 视图模式
  const [viewMode, setViewMode] = useState<'preview' | 'json' | 'table'>('preview');
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ==================== 本地上传 ====================

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    // 只过滤图片文件
    const imageFiles = fileArray.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      // 重置 input
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const newImages: ImageItem[] = [];
    let loaded = 0;
    const total = imageFiles.length;

    imageFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        newImages.push({
          id: generateId(),
          source: 'upload',
          url: dataUrl,
          name: file.name,
          status: 'idle',
        });
        loaded++;

        // 所有图片都读取完成后，一次性更新 state
        if (loaded === total) {
          setImages(prev => [...prev, ...newImages]);
        }
      };
      reader.onerror = () => {
        loaded++;
        if (loaded === total) {
          setImages(prev => [...prev, ...newImages]);
        }
      };
      reader.readAsDataURL(file);
    });

    // 重置 input 以允许重复上传同名文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // ==================== 链接粘贴 ====================

  const handleUrlChange = useCallback((value: string) => {
    setUrlInput(value);
    setPreviewUrl(null);
    setPreviewError(null);

    if (urlTimerRef.current) clearTimeout(urlTimerRef.current);

    if (!value.trim()) return;

    // 基础 URL 格式校验
    const trimmed = value.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      setPreviewError('请输入有效的图片链接（以 http:// 或 https:// 开头）');
      return;
    }

    // 防抖预览
    urlTimerRef.current = setTimeout(() => {
      setPreviewLoading(true);
      const img = new Image();
      img.onload = () => {
        setPreviewUrl(trimmed);
        setPreviewError(null);
        setPreviewLoading(false);
      };
      img.onerror = () => {
        setPreviewError('图片加载失败，请检查链接是否可访问（部分链接可能因跨域限制无法预览，但不影响 OCR 识别）');
        // 即使跨域加载失败，也允许添加（因为后端可以正常下载）
        setPreviewUrl(trimmed);
        setPreviewLoading(false);
      };
      // 设置 crossOrigin 尝试解决跨域问题
      img.crossOrigin = 'anonymous';
      img.src = trimmed;
    }, 600);
  }, []);

  const handleAddUrl = useCallback(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    // 必须已有预览（无论是成功加载还是跨域 fallback）
    if (!previewUrl) return;

    // 检查是否已存在相同 URL
    if (images.some(img => img.url === trimmed)) {
      setPreviewError('该图片已添加');
      return;
    }

    setImages(prev => [...prev, {
      id: generateId(),
      source: 'url',
      url: trimmed,
      name: trimmed.length > 50 ? trimmed.substring(0, 50) + '...' : trimmed,
      status: 'idle',
    }]);

    setUrlInput('');
    setPreviewUrl(null);
    setPreviewError(null);
  }, [urlInput, previewUrl, images]);

  const handleUrlKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddUrl();
    }
  }, [handleAddUrl]);

  // ==================== 删除图片 ====================

  const handleRemove = useCallback((id: string) => {
    setImages(prev => {
      const filtered = prev.filter(img => img.id !== id);
      if (activeIndex !== null) {
        const idx = prev.findIndex(img => img.id === id);
        if (idx === activeIndex) {
          setActiveIndex(filtered.length > 0 ? 0 : null);
        }
      }
      return filtered;
    });
  }, [activeIndex]);

  const handleClearAll = useCallback(() => {
    setImages([]);
    setActiveIndex(null);
    setBatchSummary(null);
  }, []);

  // ==================== 单张 OCR ====================

  const handleSingleOcr = useCallback(async (id: string) => {
    const img = images.find(i => i.id === id);
    if (!img || img.status === 'loading') return;

    setImages(prev => prev.map(i =>
      i.id === id ? { ...i, status: 'loading', error: undefined } : i
    ));

    try {
      const response = await fetch('/api/ocr/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: img.url }),
      });
      const data = await response.json();

      setImages(prev => prev.map(i =>
        i.id === id
          ? {
            ...i,
            status: data.success ? 'done' : 'error',
            ocrResult: data.success ? data.result : undefined,
            error: data.success ? undefined : (data.error || '识别失败'),
            model: data.model,
          }
          : i
      ));
    } catch (err) {
      setImages(prev => prev.map(i =>
        i.id === id ? { ...i, status: 'error', error: '网络请求失败' } : i
      ));
    }
  }, [images]);

  // ==================== 批量 OCR ====================

  const handleBatchOcr = useCallback(async () => {
    const idleImages = images.filter(i => i.status === 'idle' || i.status === 'error');
    if (idleImages.length === 0) return;

    setIsBatchProcessing(true);
    setBatchSummary(null);

    // 将所有待处理图片标记为 loading
    const targetIds = new Set(idleImages.map(i => i.id));
    setImages(prev => prev.map(i =>
      targetIds.has(i.id) ? { ...i, status: 'loading', error: undefined } : i
    ));

    try {
      const response = await fetch('/api/ocr/recognize-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls: idleImages.map(i => i.url) }),
      });
      const data = await response.json();

      if (data.success && data.results) {
        setBatchSummary(data.summary);
        // 构建 url -> result 映射
        const resultMap = new Map<string, any>();
        data.results.forEach((r: any) => {
          resultMap.set(r.imageUrl, r);
        });

        setImages(prev => prev.map(i => {
          if (!targetIds.has(i.id)) return i;
          const matched = resultMap.get(i.url);
          if (matched) {
            return {
              ...i,
              status: matched.success ? 'done' : 'error',
              ocrResult: matched.success ? matched.result : undefined,
              error: matched.success ? undefined : (matched.error || '识别失败'),
              model: matched.model,
            };
          }
          return { ...i, status: 'error', error: '未收到识别结果' };
        }));
      } else {
        setImages(prev => prev.map(i =>
          targetIds.has(i.id) ? { ...i, status: 'error', error: data.error || '批量识别失败' } : i
        ));
      }
    } catch (err) {
      setImages(prev => prev.map(i =>
        targetIds.has(i.id) ? { ...i, status: 'error', error: '网络请求失败' } : i
      ));
    } finally {
      setIsBatchProcessing(false);
    }
  }, [images]);

  // ==================== 复制 ====================

  const handleCopy = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* fallback */ }
  }, []);

  const handleCopyAll = useCallback(async () => {
    const allText = images
      .filter(i => i.ocrResult?.fullText)
      .map((i, idx) => `--- 图片 ${idx + 1}: ${i.name} ---\n${i.ocrResult!.fullText}`)
      .join('\n\n');
    if (allText) {
      try {
        await navigator.clipboard.writeText(allText);
        setCopiedId('all');
        setTimeout(() => setCopiedId(null), 2000);
      } catch { /* fallback */ }
    }
  }, [images]);

  // ==================== 统计 ====================

  const idleCount = images.filter(i => i.status === 'idle').length;
  const loadingCount = images.filter(i => i.status === 'loading').length;
  const doneCount = images.filter(i => i.status === 'done').length;
  const errorCount = images.filter(i => i.status === 'error').length;
  const totalChars = images.reduce((sum, i) => sum + (i.ocrResult?.totalChars || 0), 0);

  // ==================== 渲染 OCR 结果 ====================

  const renderOcrResult = (img: ImageItem) => {
    if (!img.ocrResult) return null;
    const { ocrResult: r } = img;

    return (
      <div className="space-y-3">
        {/* 摘要标签 */}
        <div className="flex flex-wrap gap-1.5">
          {r.hasText !== false ? (
            <>
              <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">有文字</span>
              {r.language && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">语言: {r.language}</span>}
              {r.totalChars != null && r.totalChars > 0 && (
                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">{r.totalChars.toLocaleString()} 字符</span>
              )}
              {r.tables && r.tables.length > 0 && (
                <span className="px-2 py-0.5 bg-cyan-100 text-cyan-700 rounded text-xs">{r.tables.length} 个表格</span>
              )}
              {r.summary && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs truncate max-w-[200px]">{r.summary}</span>}
            </>
          ) : (
            <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">无文字</span>
          )}
        </div>

        {r.title && <h4 className="text-sm font-bold text-gray-800">{r.title}</h4>}

        {/* 表格视图 */}
        {viewMode === 'table' && (
          <div className="space-y-3">
            {r.tables && r.tables.length > 0 ? r.tables.map((table, tIdx) => {
              const tableKey = `${img.id}-${tIdx}`;
              return (
                <div key={tIdx} className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => {
                      const next = new Set(expandedTables);
                      expandedTables.has(tableKey) ? next.delete(tableKey) : next.add(tableKey);
                      setExpandedTables(next);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <span className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
                      <Table className="w-3.5 h-3.5 text-cyan-500" />
                      {table.caption || `表格 ${tIdx + 1}`}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-gray-400">
                      {table.position && <span>{table.position}</span>}
                      {expandedTables.has(tableKey) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </span>
                  </button>
                  {expandedTables.has(tableKey) && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-cyan-50">
                            {table.headers.map((h, hIdx) => (
                              <th key={hIdx} className="px-3 py-1.5 text-left font-semibold text-cyan-800 border-b border-cyan-100">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {table.rows.map((row, rIdx) => (
                            <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="px-3 py-1.5 text-gray-600 border-b border-gray-100">{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            }) : <p className="text-xs text-gray-400 text-center py-3">未检测到表格</p>}

            {r.textBlocks && r.textBlocks.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-gray-500 font-medium">文字块分布：</p>
                {r.textBlocks.map((block, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs py-1 px-2.5 bg-gray-50 rounded">
                    <span className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 font-mono shrink-0">{block.position}</span>
                    <span className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 shrink-0 text-[10px]">{block.type}</span>
                    <span className="text-gray-600">{block.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* JSON 视图 */}
        {viewMode === 'json' && (
          <div className="relative">
            <pre className="p-3 bg-gray-900 rounded-lg max-h-80 overflow-y-auto text-xs text-green-400 font-mono leading-relaxed whitespace-pre-wrap">
              {JSON.stringify(r, null, 2)}
            </pre>
            <button
              onClick={() => handleCopy(JSON.stringify(r, null, 2), `json-${img.id}`)}
              className="absolute top-2 right-2 p-1.5 bg-gray-800 border border-gray-700 rounded-md hover:bg-gray-700 transition-colors"
            >
              {copiedId === `json-${img.id}` ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
            </button>
          </div>
        )}

        {/* 预览视图（默认） */}
        {viewMode === 'preview' && (
          <>
            {r.tables && r.tables.length > 0 && (
              <div className="space-y-2">
                {r.tables.map((table, tIdx) => (
                  <div key={tIdx} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50">
                            {table.headers.map((h, hIdx) => (
                              <th key={hIdx} className="px-3 py-1.5 text-left font-semibold text-gray-700 border-b">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {table.rows.slice(0, 5).map((row, rIdx) => (
                            <tr key={rIdx}>
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="px-3 py-1.5 text-gray-600 border-b border-gray-50">{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {table.rows.length > 5 && (
                      <div className="px-3 py-1 text-xs text-gray-400 bg-gray-50 text-center">
                        还有 {table.rows.length - 5} 行...（切换到"表格"视图查看完整内容）
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {r.fullText && (
              <div className="relative">
                <div className="p-3 bg-white border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{r.fullText}</pre>
                </div>
                <button
                  onClick={() => handleCopy(r.fullText!, `text-${img.id}`)}
                  className="absolute top-2 right-2 p-1.5 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
                >
                  {copiedId === `text-${img.id}` ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
                </button>
              </div>
            )}

            {r.textBlocks && r.textBlocks.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-gray-500 font-medium">文字分布：</p>
                {r.textBlocks.map((block, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs py-1 px-2.5 bg-gray-50 rounded">
                    <span className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 font-mono shrink-0">{block.position}</span>
                    <span className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 shrink-0 text-[10px]">{block.type}</span>
                    <span className="text-gray-600">{block.text}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // ==================== 主渲染 ====================

  const activeImage = activeIndex !== null ? images[activeIndex] : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8 pt-20">
        {/* 页面标题 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 rounded-full mb-4">
            <FileText className="w-5 h-5" />
            <span className="text-sm font-medium">批量 OCR 文字识别</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">图片文字批量识别</h1>
          <p className="text-gray-500">支持本地上传和粘贴图片链接，批量识别图片中的文字内容</p>
        </div>

        {/* 统计栏 */}
        {images.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-gray-500">共 <strong>{images.length}</strong> 张图片</span>
              <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-600 text-xs">待处理: {idleCount}</span>
              {loadingCount > 0 && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">处理中: {loadingCount}</span>}
              {doneCount > 0 && <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">已完成: {doneCount}</span>}
              {errorCount > 0 && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs">失败: {errorCount}</span>}
              {totalChars > 0 && <span className="text-gray-500">共 <strong className="text-purple-600">{totalChars.toLocaleString()}</strong> 字符</span>}
            </div>
            <div className="flex items-center gap-2">
              {/* 复制全部 */}
              {images.some(i => i.ocrResult?.fullText) && (
                <button
                  onClick={handleCopyAll}
                  className="px-3 py-1.5 text-xs bg-purple-50 text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors flex items-center gap-1.5"
                >
                  {copiedId === 'all' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedId === 'all' ? '已复制' : '复制全部文字'}
                </button>
              )}
              <button
                onClick={handleClearAll}
                className="px-3 py-1.5 text-xs bg-red-50 text-red-500 border border-red-200 rounded-lg hover:bg-red-100 transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                清空全部
              </button>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* ==================== 左侧：图片来源管理 ==================== */}
          <div className="lg:col-span-1 space-y-4">
            {/* 本地上传 */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Upload className="w-4 h-4 text-indigo-500" />
                本地上传
              </h2>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-8 border-2 border-dashed border-gray-300 rounded-xl text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all"
              >
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-500 text-sm font-medium">点击上传多张图片</p>
                <p className="text-gray-400 text-xs mt-1">支持 JPG / PNG / WebP，可批量选择</p>
              </button>
            </div>

            {/* 链接粘贴 */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Link className="w-4 h-4 text-blue-500" />
                粘贴图片链接
              </h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={urlInput}
                  onChange={e => handleUrlChange(e.target.value)}
                  onKeyDown={handleUrlKeyDown}
                  placeholder="https://example.com/image.png"
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none transition-all"
                />
                <button
                  onClick={handleAddUrl}
                  disabled={!urlInput.trim() || !previewUrl}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center gap-1.5 shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  添加
                </button>
              </div>

              {/* 链接预览 */}
              {urlInput.trim() && (
                <div className="mt-3">
                  {previewLoading && (
                    <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      正在加载预览...
                    </div>
                  )}
                  {previewError && (
                    <div className="flex items-center gap-2 text-sm text-red-500 py-2">
                      <AlertCircle className="w-4 h-4" />
                      {previewError}
                    </div>
                  )}
                  {previewUrl && !previewError && (
                    <div className="relative rounded-lg overflow-hidden border border-green-200">
                      <img src={previewUrl} alt="Preview" className="w-full h-32 object-cover" />
                      <div className="absolute top-2 left-2 px-2 py-0.5 bg-green-500 text-white text-xs rounded-full flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        预览正常
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 图片列表 */}
            {images.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-gray-500" />
                  图片列表 ({images.length})
                </h2>
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {images.map((img, idx) => (
                    <div
                      key={img.id}
                      onClick={() => setActiveIndex(idx)}
                      className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all border ${
                        activeIndex === idx
                          ? 'border-indigo-400 bg-indigo-50'
                          : 'border-gray-100 hover:border-gray-200 bg-white'
                      }`}
                    >
                      {/* 缩略图 */}
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                        <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                      </div>

                      {/* 信息 */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-700 truncate font-medium">{img.name}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {img.source === 'upload' ? '本地文件' : '网络链接'}
                          {' · '}
                          {img.status === 'idle' && '待识别'}
                          {img.status === 'loading' && (
                            <span className="text-blue-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin inline" />识别中</span>
                          )}
                          {img.status === 'done' && <span className="text-green-600">{img.ocrResult?.totalChars || 0} 字</span>}
                          {img.status === 'error' && <span className="text-red-500">失败</span>}
                        </p>
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        {img.status === 'idle' && (
                          <button
                            onClick={() => handleSingleOcr(img.id)}
                            className="p-1.5 text-amber-500 hover:bg-amber-50 rounded-lg transition-colors"
                            title="识别此图片"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleRemove(img.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="删除"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 批量操作按钮 */}
                {images.filter(i => i.status === 'idle' || i.status === 'error').length > 0 && (
                  <button
                    onClick={handleBatchOcr}
                    disabled={isBatchProcessing}
                    className={`w-full mt-3 py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all ${
                      isBatchProcessing
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-amber-400 to-orange-500 text-white hover:shadow-lg'
                    }`}
                  >
                    {isBatchProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        批量识别中...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        批量识别 ({images.filter(i => i.status === 'idle' || i.status === 'error').length} 张)
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ==================== 右侧：详情面板 ==================== */}
          <div className="lg:col-span-2">
            {!activeImage ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
                <ImageIcon className="w-16 h-16 text-gray-200 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-400 mb-2">选择左侧图片查看详情</h3>
                <p className="text-sm text-gray-300">
                  {images.length === 0 ? '请先上传图片或粘贴图片链接' : '点击左侧图片列表中的图片查看 OCR 识别结果'}
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                {/* 图片预览 */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-indigo-500" />
                      图片 {activeIndex! + 1}
                    </h3>
                    <span className="text-xs text-gray-400">{activeImage.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 视图切换 */}
                    <div className="flex bg-gray-100 rounded-lg p-0.5">
                      {(['preview', 'table', 'json'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setViewMode(mode)}
                          className={`px-3 py-1 text-xs rounded-md transition-colors ${
                            viewMode === mode ? 'bg-white shadow text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'
                          }`}
                        >
                          {mode === 'preview' && '预览'}
                          {mode === 'table' && '表格'}
                          {mode === 'json' && 'JSON'}
                        </button>
                      ))}
                    </div>
                    {activeImage.status === 'idle' && (
                      <button
                        onClick={() => handleSingleOcr(activeImage.id)}
                        className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 transition-colors flex items-center gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5" />
                        开始识别
                      </button>
                    )}
                  </div>
                </div>

                {/* 图片展示 */}
                <div className="rounded-xl overflow-hidden bg-gray-100 mb-4 flex items-center justify-center" style={{ minHeight: 200 }}>
                  <img
                    src={activeImage.url}
                    alt={activeImage.name}
                    className="max-w-full max-h-80 object-contain"
                  />
                </div>

                {/* 状态 / 结果 */}
                {activeImage.status === 'idle' && (
                  <div className="text-center py-8 text-gray-400">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">点击上方"开始识别"按钮进行 OCR 文字识别</p>
                  </div>
                )}

                {activeImage.status === 'loading' && (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-amber-500 mr-3" />
                    <span className="text-gray-500">正在识别图片文字...</span>
                  </div>
                )}

                {activeImage.status === 'error' && (
                  <div className="p-4 bg-red-50 rounded-xl text-red-600 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {activeImage.error || '识别失败'}
                  </div>
                )}

                {activeImage.status === 'done' && activeImage.ocrResult && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs text-gray-400">模型: {activeImage.model || 'glm-4v-flash'}</span>
                      <span className="text-xs text-gray-300">|</span>
                      <span className="text-xs text-gray-400">
                        {activeImage.ocrResult.language && `${activeImage.ocrResult.language}`}
                        {activeImage.ocrResult.totalChars && ` · ${activeImage.ocrResult.totalChars.toLocaleString()} 字符`}
                      </span>
                    </div>
                    {renderOcrResult(activeImage)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
