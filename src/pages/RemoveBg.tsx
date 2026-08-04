import { useState, useRef, useEffect } from 'react';
import { Upload, Download, RefreshCw, Image as ImageIcon, Wand2, Loader2, FileText, Copy, Check, ChevronDown, ChevronUp, Table, Code } from 'lucide-react';
import Navbar from '@/components/Navbar';

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
  content?: string;
  fullText?: string;
  textBlocks?: Array<{ position: string; type: string; text: string }>;
  tables?: OcrTable[];
  totalChars?: number;
  summary?: string;
  message?: string;
}

export default function RemoveBg() {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fillProgress, setFillProgress] = useState(0);
  const [fillStats, setFillStats] = useState({ total: 0, filled: 0, rate: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // OCR 文字识别状态
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [showOcrResult, setShowOcrResult] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ocrViewMode, setOcrViewMode] = useState<'preview' | 'json' | 'table'>('preview');
  const [expandedTables, setExpandedTables] = useState<Set<number>>(new Set());

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log(`[AI拆分] 文件上传开始: ${file.name}, ${file.size} bytes, ${file.type}`);

    if (!file.type.startsWith('image/')) {
      setError('请上传图片文件');
      console.log('[AI拆分] 处理失败: 不是图片文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setOriginalImage(result);
      setProcessedImage(null);
      setError(null);
      console.log('[AI拆分] 文件读取成功');
    };
    reader.onerror = () => {
      setError('文件读取失败');
      console.error('[AI拆分] 文件读取失败');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveBg = async () => {
    if (!originalImage) return;

    setIsProcessing(true);
    setError(null);
    setFillProgress(0);

    console.log('[AI拆分] 开始移除背景');

    try {
      const response = await fetch('/api/remove-bg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: originalImage }),
      });

      const data = await response.json();

      if (data.success && data.imageUrl) {
        console.log('[AI拆分] 背景移除成功');
        setProcessedImage(data.imageUrl);
        setTimeout(() => fillBackground(data.imageUrl), 100);
      } else {
        setError(data.error || '处理失败');
        console.error(`[AI拆分] 处理失败: ${data.error}`);
      }
    } catch (err) {
      setError('网络错误，请重试');
      console.error('[AI拆分] 网络错误:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const fillBackground = async (imageUrl: string) => {
    console.log('[背景填充] 开始处理');

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrl;
      });

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      let transparentPixels = 0;
      let nonTransparentPixels = 0;

      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 128) {
          transparentPixels++;
        } else {
          nonTransparentPixels++;
        }
      }

      const totalPixels = transparentPixels + nonTransparentPixels;
      const fillRate = nonTransparentPixels > 0
        ? ((nonTransparentPixels / totalPixels) * 100).toFixed(2)
        : '0.00';

      console.log(`[背景填充] 原始图片尺寸: ${img.width}x${img.height}`);
      console.log(`[背景填充] 空白像素总数: ${transparentPixels}`);
      console.log(`[背景填充] 填充率: ${fillRate}%`);

      setFillStats({
        total: totalPixels,
        filled: nonTransparentPixels,
        rate: parseFloat(fillRate),
      });

      let filledCount = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) {
          data[i] = 249;
          data[i + 1] = 250;
          data[i + 2] = 251;
          data[i + 3] = 255;
          filledCount++;

          if (filledCount % 10000 === 0) {
            setFillProgress((filledCount / transparentPixels) * 100);
            await new Promise(r => setTimeout(r, 0));
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
      setProcessedImage(canvas.toDataURL('image/png'));
      setFillProgress(100);

      console.log('[背景填充] 完成');
    } catch (err) {
      console.error('[背景填充] 失败:', err);
    }
  };

  const handleDownload = () => {
    if (!processedImage) return;

    const link = document.createElement('a');
    link.href = processedImage;
    link.download = `bg-removed-${Date.now()}.png`;
    link.click();
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // OCR 文字识别
  const handleOcr = async () => {
    if (!originalImage) return;
    setIsOcrProcessing(true);
    setOcrResult(null);
    setShowOcrResult(true);

    console.log('[OCR] 开始识别图片中的文字...');

    try {
      const response = await fetch('/api/ocr/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: originalImage }),
      });

      const data = await response.json();

      if (data.success && data.result) {
        console.log('[OCR] 识别成功:', data.result.summary || `${data.result.totalChars || 0} 个字符`);
        setOcrResult(data.result);
      } else {
        setError(data.error || 'OCR 识别失败');
        console.error('[OCR] 识别失败:', data.error);
      }
    } catch (err) {
      setError('OCR 服务请求失败，请检查网络');
      console.error('[OCR] 网络错误:', err);
    } finally {
      setIsOcrProcessing(false);
    }
  };

  const handleCopyOcrResult = async () => {
    const text = ocrResult?.fullText || ocrResult?.content;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  useEffect(() => {
    return () => {
      if (originalImage && originalImage.startsWith('blob:')) {
        URL.revokeObjectURL(originalImage);
      }
      if (processedImage && processedImage.startsWith('blob:')) {
        URL.revokeObjectURL(processedImage);
      }
    };
  }, [originalImage, processedImage]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-8 pt-20">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-100 text-indigo-700 rounded-full mb-4">
            <Wand2 className="w-5 h-5" />
            <span className="text-sm font-medium">AI 智能抠图</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">一键移除图片背景</h1>
          <p className="text-gray-500">上传图片，AI 自动识别并移除背景，保留主体</p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-indigo-500" />
              原始图片
            </h2>

            {!originalImage ? (
              <div
                onClick={handleUploadClick}
                className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500 font-medium">点击或拖拽上传图片</p>
                <p className="text-gray-400 text-sm mt-2">支持 JPG、PNG、WebP 格式</p>
              </div>
            ) : (
              <div className="relative rounded-xl overflow-hidden">
                <img
                  src={originalImage}
                  alt="Original"
                  className="w-full h-auto max-h-96 object-contain"
                />
                <button
                  onClick={handleUploadClick}
                  className="absolute bottom-3 right-3 px-3 py-1.5 bg-black/50 text-white rounded-lg text-sm hover:bg-black/70 transition-all"
                >
                  更换图片
                </button>
              </div>
            )}

            {originalImage && (
              <div className="space-y-3">
                <button
                  onClick={handleRemoveBg}
                  disabled={isProcessing}
                  className={`w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-all ${isProcessing
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-500 hover:shadow-lg'
                    }`}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      AI 处理中...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-5 h-5" />
                      一键抠图
                    </>
                  )}
                </button>

                <button
                  onClick={handleOcr}
                  disabled={isOcrProcessing}
                  className={`w-full py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all border-2 ${isOcrProcessing
                    ? 'border-gray-300 bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-500'
                    }`}
                >
                  {isOcrProcessing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      正在识别文字...
                    </>
                  ) : (
                    <>
                      <FileText className="w-5 h-5" />
                      识别图片文字 (OCR)
                    </>
                  )}
                </button>
              </div>
            )}

            {error && (
              <div className="mt-4 px-4 py-3 bg-red-50 text-red-600 rounded-xl text-sm">
                {error}
              </div>
            )}

            {/* OCR 文字识别结果 */}
            {showOcrResult && (
              <div className="mt-6 border-t border-gray-200 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-amber-500" />
                    OCR 文字识别结果
                    <span className="text-xs text-gray-400 font-normal">glm-4v-flash</span>
                  </h3>
                  {/* 视图切换 */}
                  {ocrResult && !isOcrProcessing && (
                    <div className="flex bg-gray-100 rounded-lg p-0.5">
                      <button
                        onClick={() => setOcrViewMode('preview')}
                        className={`px-3 py-1 text-xs rounded-md transition-colors ${ocrViewMode === 'preview' ? 'bg-white shadow text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        📄 预览
                      </button>
                      <button
                        onClick={() => setOcrViewMode('table')}
                        className={`px-3 py-1 text-xs rounded-md transition-colors ${ocrViewMode === 'table' ? 'bg-white shadow text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        <Table className="w-3 h-3 inline mr-1" />
                        表格
                      </button>
                      <button
                        onClick={() => setOcrViewMode('json')}
                        className={`px-3 py-1 text-xs rounded-md transition-colors ${ocrViewMode === 'json' ? 'bg-white shadow text-gray-800 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        <Code className="w-3 h-3 inline mr-1" />
                        JSON
                      </button>
                    </div>
                  )}
                </div>

                {isOcrProcessing ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-amber-500 mr-2" />
                    <span className="text-gray-500">glm-4v-flash 正在识别图片文字...</span>
                  </div>
                ) : ocrResult ? (
                  <div className="space-y-3">
                    {/* 识别摘要 */}
                    <div className="flex flex-wrap gap-3">
                      {ocrResult.hasText !== false && (
                        <>
                          <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
                            ✅ 已识别文字
                          </span>
                          {ocrResult.language && (
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">
                              语言：{ocrResult.language}
                            </span>
                          )}
                          {ocrResult.totalChars != null && ocrResult.totalChars > 0 && (
                            <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
                              共 {ocrResult.totalChars.toLocaleString()} 字符
                            </span>
                          )}
                          {ocrResult.tables && ocrResult.tables.length > 0 && (
                            <span className="px-2 py-1 bg-cyan-100 text-cyan-700 rounded text-xs">
                              {ocrResult.tables.length} 个表格
                            </span>
                          )}
                          {ocrResult.summary && (
                            <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs">
                              {ocrResult.summary}
                            </span>
                          )}
                        </>
                      )}
                      {ocrResult.hasText === false && (
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">
                          ⚠️ 未检测到文字
                        </span>
                      )}
                    </div>

                    {/* 标题 */}
                    {ocrResult.title && (
                      <h4 className="text-base font-bold text-gray-800">{ocrResult.title}</h4>
                    )}

                    {/* === 表格视图 === */}
                    {ocrViewMode === 'table' && (
                      <div className="space-y-4">
                        {/* 提取的表格 */}
                        {ocrResult.tables && ocrResult.tables.length > 0 ? (
                          ocrResult.tables.map((table, tIdx) => (
                            <div key={tIdx} className="border border-gray-200 rounded-lg overflow-hidden">
                              <button
                                onClick={() => {
                                  const next = new Set(expandedTables);
                                  expandedTables.has(tIdx) ? next.delete(tIdx) : next.add(tIdx);
                                  setExpandedTables(next);
                                }}
                                className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
                              >
                                <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                  <Table className="w-4 h-4 text-cyan-500" />
                                  {table.caption || `表格 ${tIdx + 1}`}
                                </span>
                                <span className="flex items-center gap-2 text-xs text-gray-400">
                                  {table.position && <span>{table.position}</span>}
                                  {expandedTables.has(tIdx) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </span>
                              </button>
                              {expandedTables.has(tIdx) && (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="bg-cyan-50">
                                        {table.headers.map((h, hIdx) => (
                                          <th key={hIdx} className="px-4 py-2 text-left text-xs font-semibold text-cyan-800 border-b border-cyan-100">
                                            {h}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {table.rows.map((row, rIdx) => (
                                        <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                          {row.map((cell, cIdx) => (
                                            <td key={cIdx} className="px-4 py-2 text-xs text-gray-600 border-b border-gray-100">
                                              {cell}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-gray-400 text-center py-4">未检测到表格数据</p>
                        )}

                        {/* 文字块列表（表格视图下也显示） */}
                        {ocrResult.textBlocks && ocrResult.textBlocks.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-xs text-gray-500 font-medium mb-2">文字块分布：</p>
                            {ocrResult.textBlocks.map((block, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs py-1.5 px-3 bg-gray-50 rounded">
                                <span className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 font-mono shrink-0">
                                  {block.position}
                                </span>
                                <span className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 shrink-0 text-[10px]">
                                  {block.type}
                                </span>
                                <span className="text-gray-600">{block.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* === JSON 视图 === */}
                    {ocrViewMode === 'json' && (
                      <div className="relative">
                        <div className="p-4 bg-gray-900 rounded-lg max-h-96 overflow-y-auto">
                          <pre className="text-xs text-green-400 font-mono leading-relaxed whitespace-pre-wrap">
                            {JSON.stringify(ocrResult, null, 2)}
                          </pre>
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(ocrResult, null, 2));
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          className="absolute top-2 right-2 p-2 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 transition-colors"
                          title="复制 JSON"
                        >
                          {copied ? (
                            <Check className="w-4 h-4 text-green-400" />
                          ) : (
                            <Copy className="w-4 h-4 text-gray-400" />
                          )}
                        </button>
                      </div>
                    )}

                    {/* === 预览视图（默认） === */}
                    {ocrViewMode === 'preview' && (
                      <>
                        {/* 表格预览卡片 */}
                        {ocrResult.tables && ocrResult.tables.length > 0 && (
                          <div className="space-y-2">
                            {ocrResult.tables.map((table, tIdx) => (
                              <div key={tIdx} className="border border-gray-200 rounded-lg overflow-hidden">
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="bg-gray-50">
                                        {table.headers.map((h, hIdx) => (
                                          <th key={hIdx} className="px-3 py-2 text-left text-xs font-semibold text-gray-700 border-b">
                                            {h}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {table.rows.slice(0, 5).map((row, rIdx) => (
                                        <tr key={rIdx}>
                                          {row.map((cell, cIdx) => (
                                            <td key={cIdx} className="px-3 py-1.5 text-xs text-gray-600 border-b border-gray-50">
                                              {cell}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                {table.rows.length > 5 && (
                                  <div className="px-3 py-1.5 text-xs text-gray-400 bg-gray-50 text-center">
                                    还有 {table.rows.length - 5} 行...（切换到"表格"视图查看完整内容）
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 完整文本内容 */}
                        {(ocrResult.fullText || ocrResult.content) && (
                          <div className="relative">
                            <div className="p-4 bg-white border border-gray-200 rounded-lg max-h-80 overflow-y-auto">
                              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                                {ocrResult.fullText || ocrResult.content}
                              </pre>
                            </div>
                            <button
                              onClick={handleCopyOcrResult}
                              className="absolute top-2 right-2 p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                              title="复制文档"
                            >
                              {copied ? (
                                <Check className="w-4 h-4 text-green-500" />
                              ) : (
                                <Copy className="w-4 h-4 text-gray-400" />
                              )}
                            </button>
                          </div>
                        )}

                        {/* 文字块列表 */}
                        {ocrResult.textBlocks && ocrResult.textBlocks.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-xs text-gray-500 font-medium">文字分布：</p>
                            {ocrResult.textBlocks.map((block, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs py-1.5 px-3 bg-gray-50 rounded">
                                <span className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 font-mono shrink-0">
                                  {block.position}
                                </span>
                                <span className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 shrink-0 text-[10px]">
                                  {block.type}
                                </span>
                                <span className="text-gray-600">{block.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {!ocrResult.hasText && ocrResult.message && (
                      <p className="text-sm text-gray-500 italic">{ocrResult.message}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-4">暂无识别结果</p>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-purple-500" />
              处理结果
            </h2>

            {!processedImage ? (
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center bg-gray-50">
                <ImageIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-400">处理后的图片将在这里显示</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative rounded-xl overflow-hidden bg-gray-50">
                  <img
                    src={processedImage}
                    alt="Processed"
                    className="w-full h-auto max-h-96 object-contain"
                  />
                  {fillProgress > 0 && fillProgress < 100 && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                      <div className="text-white">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                        <span>填充中 {Math.round(fillProgress)}%</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleDownload}
                    className="flex-1 py-2.5 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 transition-all flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    下载图片
                  </button>
                  <button
                    onClick={handleRemoveBg}
                    disabled={isProcessing}
                    className="py-2.5 px-4 bg-gray-100 text-gray-600 rounded-xl font-medium hover:bg-gray-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw className="w-4 h-4" />
                    重新处理
                  </button>
                </div>

                {fillStats.rate > 0 && (
                  <div className="p-4 bg-blue-50 rounded-xl">
                    <p className="text-sm text-blue-600 font-medium mb-2">填充统计</p>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-xl font-bold text-blue-700">{fillStats.rate}%</p>
                        <p className="text-xs text-blue-500">填充率</p>
                      </div>
                      <div>
                        <p className="text-xl font-bold text-blue-700">{fillStats.filled.toLocaleString()}</p>
                        <p className="text-xs text-blue-500">有效像素</p>
                      </div>
                      <div>
                        <p className="text-xl font-bold text-blue-700">{fillStats.total.toLocaleString()}</p>
                        <p className="text-xs text-blue-500">总像素</p>
                      </div>
                    </div>
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
