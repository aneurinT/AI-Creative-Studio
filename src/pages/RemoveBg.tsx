import { useState, useRef, useEffect } from 'react';
import { Upload, Download, RefreshCw, Image as ImageIcon, Wand2, Loader2, FileText, Table, Braces, Copy, CheckCircle, Link, Plus } from 'lucide-react';
import Navbar from '@/components/Navbar';

export default function RemoveBg() {
  // 模式切换
  const [mode, setMode] = useState<'remove-bg' | 'ocr'>('remove-bg');
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fillProgress, setFillProgress] = useState(0);
  const [fillStats, setFillStats] = useState({ total: 0, filled: 0, rate: 0 });

  // OCR 相关状态
  const [ocrImages, setOcrImages] = useState<string[]>([]);
  const [ocrFormat, setOcrFormat] = useState<'text' | 'json' | 'table'>('text');
  const [ocrResult, setOcrResult] = useState<{
    text?: string;
    jsonResult?: Record<string, any>;
    tableData?: string[][];
    method?: string;
    format?: string;
  } | null>(null);
  const [ocrResults, setOcrResults] = useState<any[]>([]);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  // 图片地址输入
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // ===== OCR 文字识别 =====
  const handleOcrUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newUrls: string[] = [];
    files.forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        newUrls.push(result);
        if (newUrls.length === files.filter(f => f.type.startsWith('image/')).length) {
          setOcrImages(prev => [...prev, ...newUrls].slice(0, 10));
          setOriginalImage(newUrls[0]);
          setOcrResult(null);
          setError(null);
        }
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeOcrImage = (index: number) => {
    setOcrImages(prev => prev.filter((_, i) => i !== index));
    setOcrResults(prev => prev.filter((_, i) => i !== index));
  };

  const clearOcrImages = () => {
    setOcrImages([]);
    setOcrResults([]);
    setOcrResult(null);
  };

  // 通过粘贴图片地址添加
  const handleAddImageUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    // 简单校验是否为合法图片 URL
    if (!/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(url) && !/^https?:\/\/.+/i.test(url)) {
      setError('请输入有效的图片地址（http/https 开头）');
      return;
    }
    if (ocrImages.length >= 10) {
      setError('最多添加 10 张图片');
      return;
    }
    setError(null);
    setOcrImages(prev => [...prev, url]);
    setOcrResult(null);
    setUrlInput('');
  };

  // 回车快捷添加
  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddImageUrl();
    }
  };

  // 批量粘贴多行 URL（每行一个）
  const handleBatchUrls = () => {
    const lines = urlInput.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) return;
    const validUrls = lines.filter(l => /^https?:\/\/.+/i.test(l.trim()));
    if (validUrls.length === 0) {
      setError('未找到有效的图片地址');
      return;
    }
    const remaining = 10 - ocrImages.length;
    const toAdd = validUrls.slice(0, remaining);
    if (toAdd.length < validUrls.length) {
      setError(`最多添加 10 张，已添加 ${ocrImages.length} 张，本次只能添加 ${remaining} 张`);
    } else {
      setError(null);
    }
    setOcrImages(prev => [...prev, ...toAdd].slice(0, 10));
    setOcrResult(null);
    setUrlInput('');
  };

  const handleSingleOcr = async () => {
    if (!originalImage) return;
    setIsOcrProcessing(true);
    setError(null);
    setOcrResult(null);

    try {
      const response = await fetch('/api/ocr/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: originalImage, format: ocrFormat }),
      });
      const data = await response.json();
      if (data.success) {
        setOcrResult({
          text: data.text,
          jsonResult: data.jsonResult,
          tableData: data.tableData,
          method: data.method,
          format: data.format,
        });
      } else {
        setError(data.error || 'OCR 识别失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setIsOcrProcessing(false);
    }
  };

  const handleBatchOcr = async () => {
    if (ocrImages.length === 0) return;
    setIsOcrProcessing(true);
    setError(null);
    setOcrResults([]);

    try {
      const response = await fetch('/api/ocr/batch-recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: ocrImages, format: ocrFormat }),
      });
      const data = await response.json();
      if (data.success) {
        setOcrResults(data.results);
      } else {
        setError(data.error || '批量识别失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setIsOcrProcessing(false);
    }
  };

  const copyToClipboard = (text: string, index?: number) => {
    navigator.clipboard.writeText(text).then(() => {
      if (index !== undefined) {
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
      }
    });
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
        {/* 模式切换 */}
        <div className="flex justify-center gap-3 mb-8">
          <button
            onClick={() => setMode('remove-bg')}
            className={`px-6 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 ${mode === 'remove-bg'
              ? 'bg-indigo-500 text-white shadow-md'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <Wand2 className="w-4 h-4" />
            智能抠图
          </button>
          <button
            onClick={() => setMode('ocr')}
            className={`px-6 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 ${mode === 'ocr'
              ? 'bg-blue-500 text-white shadow-md'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            文字识别 (OCR)
          </button>
        </div>

        {mode === 'remove-bg' ? (<>
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
              <button
                onClick={handleRemoveBg}
                disabled={isProcessing}
                className={`w-full mt-4 py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 transition-all ${isProcessing
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
            )}

            {error && (
              <div className="mt-4 px-4 py-3 bg-red-50 text-red-600 rounded-xl text-sm">
                {error}
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
        </>) : (
        /* ===== OCR 文字识别模式 ===== */
        <div className="space-y-6">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-full mb-4">
              <FileText className="w-5 h-5" />
              <span className="text-sm font-medium">AI 图片文字识别</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">智能图片文字提取</h1>
            <p className="text-gray-500">支持单张/批量识别，大模型优先，OCR工具降级</p>
          </div>

          {/* 格式选择 */}
          <div className="bg-white rounded-2xl shadow-lg p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex gap-2">
                {([
                  { id: 'text' as const, label: '文本格式', icon: FileText },
                  { id: 'json' as const, label: 'JSON格式', icon: Braces },
                  { id: 'table' as const, label: '表格模式', icon: Table },
                ]).map(item => (
                  <button
                    key={item.id}
                    onClick={() => { setOcrFormat(item.id); setOcrResult(null); setOcrResults([]); }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${ocrFormat === item.id
                      ? 'bg-blue-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-gray-400">
                {ocrFormat === 'text' ? '直接返回纯文本' : ocrFormat === 'json' ? '返回结构化JSON' : '自动识别表格并提取'}
              </span>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* 上传区域 */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-500" />
                上传图片
                <span className="text-xs font-normal text-gray-400">(支持批量上传和粘贴地址)</span>
              </h2>

              <div className="space-y-3">
                {/* 方式一：本地上传 */}
                <div className="flex gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 py-3 border-2 border-dashed border-blue-300 rounded-xl text-blue-600 hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
                  >
                    <Upload className="w-5 h-5" />
                    {ocrImages.length > 0 ? `已选 ${ocrImages.length} 张（点击添加）` : '点击上传图片（支持多选）'}
                  </button>
                  {ocrImages.length > 0 && (
                    <button onClick={clearOcrImages} className="px-4 py-3 text-red-500 hover:bg-red-50 rounded-xl text-sm">
                      清空
                    </button>
                  )}
                </div>

                {/* 方式二：粘贴图片地址 */}
                <div>
                  <button
                    onClick={() => setShowUrlInput(!showUrlInput)}
                    className={`w-full py-2.5 border-2 border-dashed rounded-xl transition-all flex items-center justify-center gap-2 text-sm ${showUrlInput
                      ? 'border-green-400 text-green-600 bg-green-50'
                      : 'border-gray-300 text-gray-500 hover:border-green-300 hover:text-green-600'
                    }`}
                  >
                    <Link className="w-4 h-4" />
                    {showUrlInput ? '收起地址输入' : '或粘贴图片地址（支持批量）'}
                  </button>

                  {showUrlInput && (
                    <div className="mt-3 space-y-2 animate-in fade-in">
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <input
                            type="text"
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            onKeyDown={handleUrlKeyDown}
                            placeholder="粘贴图片 URL，如 https://example.com/image.jpg"
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                          />
                          {urlInput.includes('\n') && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                              {urlInput.trim().split('\n').filter(l => l.trim()).length} 行
                            </span>
                          )}
                        </div>
                        <button
                          onClick={handleAddImageUrl}
                          disabled={!urlInput.trim()}
                          className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-1.5 ${urlInput.trim()
                            ? 'bg-green-500 text-white hover:bg-green-600'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          <Plus className="w-4 h-4" />
                          添加
                        </button>
                      </div>
                      {urlInput.includes('\n') && (
                        <button
                          onClick={handleBatchUrls}
                          className="w-full py-2 bg-green-50 text-green-600 rounded-lg text-sm font-medium hover:bg-green-100 transition-all flex items-center justify-center gap-2"
                        >
                          <Table className="w-4 h-4" />
                          批量添加（{urlInput.trim().split('\n').filter(l => l.trim()).length} 个地址）
                        </button>
                      )}
                      <p className="text-xs text-gray-400">支持直接粘贴图片链接，多行粘贴可批量添加（每行一个地址）</p>
                    </div>
                  )}
                </div>

                {/* 图片预览列表 */}
                {ocrImages.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {ocrImages.map((url, i) => (
                      <div key={i} className="relative flex-shrink-0 group">
                        <img
                          src={url}
                          alt={`OCR ${i + 1}`}
                          className="w-20 h-20 rounded-lg object-cover border-2 border-blue-200"
                          onError={(e) => {
                            // 图片加载失败时显示占位
                            (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect fill="%23f0f0f0" width="80" height="80"/><text x="40" y="45" text-anchor="middle" font-size="12" fill="%23999">加载失败</text></svg>';
                          }}
                        />
                        <span className="absolute top-0 left-0 w-5 h-5 bg-blue-600 text-white text-xs rounded-tl-lg rounded-br-lg flex items-center justify-center">{i + 1}</span>
                        <button onClick={() => removeOcrImage(i)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                        {ocrResults[i] && (
                          <div className="absolute bottom-0 right-0 w-5 h-5 bg-green-500 text-white text-xs rounded-full flex items-center justify-center">✓</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="flex gap-2">
                  <button
                    onClick={handleSingleOcr}
                    disabled={!originalImage || isOcrProcessing}
                    className={`flex-1 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${!originalImage || isOcrProcessing
                      ? 'bg-gray-300 cursor-not-allowed text-gray-500'
                      : 'bg-blue-500 text-white hover:bg-blue-600 shadow-md'
                    }`}
                  >
                    {isOcrProcessing ? (
                      <><Loader2 className="w-5 h-5 animate-spin" />识别中...</>
                    ) : (
                      <><FileText className="w-5 h-5" />单张识别</>
                    )}
                  </button>
                  {ocrImages.length > 1 && (
                    <button
                      onClick={handleBatchOcr}
                      disabled={isOcrProcessing}
                      className={`flex-1 py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${isOcrProcessing
                        ? 'bg-gray-300 cursor-not-allowed text-gray-500'
                        : 'bg-green-500 text-white hover:bg-green-600 shadow-md'
                      }`}
                    >
                      <Table className="w-5 h-5" />
                      批量识别 ({ocrImages.length}张)
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 识别结果 */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-green-500" />
                识别结果
                {ocrResult?.method && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ocrResult.method === 'llm' ? 'bg-purple-100 text-purple-600' : 'bg-amber-100 text-amber-600'}`}>
                    {ocrResult.method === 'llm' ? '🤖 大模型' : '📷 OCR工具'}
                  </span>
                )}
              </h2>

              {!ocrResult && ocrResults.length === 0 ? (
                <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center bg-gray-50">
                  <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-400">识别结果将在这里显示</p>
                  <p className="text-xs text-gray-300 mt-2">支持文本/JSON/表格三种输出格式</p>
                </div>
              ) : (
                <div className="space-y-4 max-h-[500px] overflow-y-auto">
                  {/* 单张结果 */}
                  {ocrResult && (
                    <div className="space-y-2">
                      {ocrResult.text && ocrResult.format === 'text' && (
                        <div className="relative">
                          <pre className="p-3 bg-gray-50 rounded-lg text-sm whitespace-pre-wrap text-gray-700 border">{ocrResult.text}</pre>
                          <button onClick={() => copyToClipboard(ocrResult.text || '')} className="absolute top-2 right-2 p-1.5 bg-white rounded shadow hover:bg-gray-100 text-xs">
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {ocrResult.jsonResult && ocrResult.format === 'json' && (
                        <div className="relative">
                          <pre className="p-3 bg-gray-800 rounded-lg text-sm text-green-400 overflow-x-auto border">{JSON.stringify(ocrResult.jsonResult, null, 2)}</pre>
                          <button onClick={() => copyToClipboard(JSON.stringify(ocrResult.jsonResult, null, 2))} className="absolute top-2 right-2 p-1.5 bg-white rounded shadow hover:bg-gray-100 text-xs">
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {ocrResult.tableData && ocrResult.tableData.length > 0 && (
                        <div className="overflow-x-auto border rounded-lg">
                          <table className="w-full text-sm">
                            <tbody>
                              {ocrResult.tableData.map((row, ri) => (
                                <tr key={ri} className={ri === 0 ? 'bg-blue-50 font-medium' : 'hover:bg-gray-50'}>
                                  {row.map((cell, ci) => (
                                    <td key={ci} className="px-3 py-2 border">{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 批量结果 */}
                  {ocrResults.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-gray-600">批量识别结果 ({ocrResults.filter(r => r.success).length}/{ocrResults.length} 成功)</p>
                      {ocrResults.map((result, i) => (
                        <div key={i} className={`p-3 rounded-lg border ${result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-500">#{i + 1}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${result.method === 'llm' ? 'bg-purple-100 text-purple-600' : 'bg-amber-100 text-amber-600'}`}>
                                {result.method === 'llm' ? '大模型' : 'OCR工具'}
                              </span>
                            </div>
                            <button
                              onClick={() => copyToClipboard(result.text || '', i)}
                              className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                            >
                              {copiedIndex === i ? <><CheckCircle className="w-3 h-3" />已复制</> : <><Copy className="w-3 h-3" />复制</>}
                            </button>
                          </div>
                          {result.success ? (
                            <p className="text-sm text-gray-700 line-clamp-3">{result.text || '(无文字)'}</p>
                          ) : (
                            <p className="text-sm text-red-500">{result.error}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
