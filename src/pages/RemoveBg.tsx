import { useState, useRef, useEffect } from 'react';
import { Upload, Download, RefreshCw, Image as ImageIcon, Wand2, Loader2 } from 'lucide-react';
import Navbar from '@/components/Navbar';

export default function RemoveBg() {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fillProgress, setFillProgress] = useState(0);
  const [fillStats, setFillStats] = useState({ total: 0, filled: 0, rate: 0 });
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
      </div>
    </div>
  );
}
