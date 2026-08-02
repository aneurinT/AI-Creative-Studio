import { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, RefreshCw, Move, ZoomIn, ZoomOut, RotateCw, FlipHorizontal, FlipVertical, RotateCcw, Image as ImageIcon, Layers, Wand2 } from 'lucide-react';
import Navbar from '@/components/Navbar';

interface TransformState {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

export default function ImageComposer() {
  const [imageA, setImageA] = useState<string | null>(null);
  const [extractedA, setExtractedA] = useState<string | null>(null);
  const [imageB, setImageB] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transform, setTransform] = useState<TransformState>({
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleFileUploadA = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setImageA(result);
      setExtractedA(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleFileUploadB = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setImageB(result);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleExtractBg = async () => {
    if (!imageA) return;

    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch('/api/remove-bg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: imageA }),
      });

      const data = await response.json();

      if (data.success && data.imageUrl) {
        setExtractedA(data.imageUrl);
      } else {
        setError(data.error || '提取失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setIsProcessing(false);
    }
  };

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#f9fafb';
    ctx.fillRect(0, 0, width, height);

    if (imageB) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const scale = Math.max(width / img.width, height / img.height);
        const x = (width - img.width * scale) / 2;
        const y = (height - img.height * scale) / 2;
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        drawSubject();
      };
      img.src = imageB;
    } else {
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('请上传背景图片', width / 2, height / 2);
      drawSubject();
    }

    function drawSubject() {
      if (!extractedA) {
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.fillRect(width / 2 - 100, height / 2 - 100, 200, 200);
        ctx.fillStyle = '#6b7280';
        ctx.fillText('提取的主体将显示在这里', width / 2, height / 2);
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        ctx.save();
        ctx.translate(width / 2 + transform.x, height / 2 + transform.y);
        ctx.rotate((transform.rotation * Math.PI) / 180);
        ctx.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);

        const size = Math.min(img.width, img.height) * transform.scale;
        const w = (img.width / Math.min(img.width, img.height)) * size;
        const h = (img.height / Math.min(img.width, img.height)) * size;

        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      };
      img.src = extractedA;
    }
  }, [imageB, extractedA, transform]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;

    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;

    setTransform((prev) => ({
      ...prev,
      x: prev.x + dx,
      y: prev.y + dy,
    }));

    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;

    setTransform((prev) => ({
      ...prev,
      scale: Math.max(0.1, Math.min(3, prev.scale + delta)),
    }));
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `composed-${Date.now()}.png`;
    link.click();
  };

  const handleReset = () => {
    setTransform({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      flipX: false,
      flipY: false,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-8 pt-20">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-full mb-4">
            <Layers className="w-5 h-5" />
            <span className="text-sm font-medium">AI 图片合成</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">图片主体合成</h1>
          <p className="text-gray-500">上传两张图片，提取主体并合成到背景中</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-blue-500" />
                图片 A（主体）
              </h2>

              {!imageA ? (
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUploadA}
                    className="hidden"
                    id="upload-a"
                  />
                  <label htmlFor="upload-a" className="cursor-pointer">
                    <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">点击上传主体图片</p>
                  </label>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative rounded-xl overflow-hidden">
                    <img
                      src={imageA}
                      alt="Image A"
                      className="w-full h-48 object-contain bg-gray-100"
                    />
                    <label htmlFor="upload-a" className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 text-white rounded text-xs cursor-pointer">
                      更换
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUploadA}
                      className="hidden"
                      id="upload-a"
                    />
                  </div>

                  <button
                    onClick={handleExtractBg}
                    disabled={isProcessing}
                    className={`w-full py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${isProcessing
                      ? 'bg-gray-300 cursor-not-allowed text-gray-500'
                      : 'bg-blue-500 text-white hover:bg-blue-600'
                      }`}
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        AI 提取中...
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4" />
                        AI 提取主体
                      </>
                    )}
                  </button>
                </div>
              )}

              {extractedA && (
                <div className="mt-4 p-3 bg-green-50 rounded-xl">
                  <p className="text-sm text-green-700 font-medium mb-2">提取结果预览</p>
                  <img
                    src={extractedA}
                    alt="Extracted"
                    className="w-full h-32 object-contain"
                  />
                </div>
              )}

              {error && (
                <div className="mt-4 px-4 py-3 bg-red-50 text-red-600 rounded-xl text-sm">
                  {error}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <ImageIcon className="w-5 h-5 text-green-500" />
                图片 B（背景）
              </h2>

              {!imageB ? (
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-green-400 hover:bg-green-50 transition-all">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUploadB}
                    className="hidden"
                    id="upload-b"
                  />
                  <label htmlFor="upload-b" className="cursor-pointer">
                    <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">点击上传背景图片</p>
                  </label>
                </div>
              ) : (
                <div className="relative rounded-xl overflow-hidden">
                  <img
                    src={imageB}
                    alt="Image B"
                    className="w-full h-48 object-contain bg-gray-100"
                  />
                  <label htmlFor="upload-b" className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 text-white rounded text-xs cursor-pointer">
                    更换
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUploadB}
                    className="hidden"
                    id="upload-b"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Layers className="w-5 h-5 text-purple-500" />
                合成画布
              </h2>

              <div
                ref={containerRef}
                className="relative rounded-xl overflow-hidden bg-gray-100 cursor-move border-2 border-gray-200"
                style={{ height: '500px' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
              >
                <canvas
                  ref={canvasRef}
                  width={800}
                  height={500}
                  className="w-full h-full"
                />
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleDownload}
                  className="flex-1 py-2.5 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 transition-all flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  下载合成图
                </button>
                <button
                  onClick={handleReset}
                  className="py-2.5 px-4 bg-gray-100 text-gray-600 rounded-xl font-medium hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  重置
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-lg font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Move className="w-5 h-5 text-indigo-500" />
                变换控制
              </h2>

              <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
                <button
                  onClick={() => setTransform((prev) => ({ ...prev, scale: Math.min(3, prev.scale + 0.1) }))}
                  className="p-3 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all flex flex-col items-center gap-1"
                  title="放大"
                >
                  <ZoomIn className="w-5 h-5 text-gray-600" />
                  <span className="text-xs text-gray-500">放大</span>
                </button>

                <button
                  onClick={() => setTransform((prev) => ({ ...prev, scale: Math.max(0.1, prev.scale - 0.1) }))}
                  className="p-3 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all flex flex-col items-center gap-1"
                  title="缩小"
                >
                  <ZoomOut className="w-5 h-5 text-gray-600" />
                  <span className="text-xs text-gray-500">缩小</span>
                </button>

                <button
                  onClick={() => setTransform((prev) => ({ ...prev, rotation: (prev.rotation + 15) % 360 }))}
                  className="p-3 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all flex flex-col items-center gap-1"
                  title="旋转"
                >
                  <RotateCw className="w-5 h-5 text-gray-600" />
                  <span className="text-xs text-gray-500">旋转</span>
                </button>

                <button
                  onClick={() => setTransform((prev) => ({ ...prev, flipX: !prev.flipX }))}
                  className={`p-3 rounded-xl transition-all flex flex-col items-center gap-1 ${transform.flipX ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                    }`}
                  title="水平翻转"
                >
                  <FlipHorizontal className="w-5 h-5" />
                  <span className="text-xs">水平翻转</span>
                </button>

                <button
                  onClick={() => setTransform((prev) => ({ ...prev, flipY: !prev.flipY }))}
                  className={`p-3 rounded-xl transition-all flex flex-col items-center gap-1 ${transform.flipY ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                    }`}
                  title="垂直翻转"
                >
                  <FlipVertical className="w-5 h-5" />
                  <span className="text-xs">垂直翻转</span>
                </button>

                <button
                  onClick={handleReset}
                  className="p-3 bg-gray-100 rounded-xl hover:bg-gray-200 transition-all flex flex-col items-center gap-1"
                  title="重置变换"
                >
                  <RotateCcw className="w-5 h-5 text-gray-600" />
                  <span className="text-xs text-gray-500">重置</span>
                </button>
              </div>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="text-sm text-gray-600 block mb-2">缩放: {(transform.scale * 100).toFixed(0)}%</label>
                  <input
                    type="range"
                    min="10"
                    max="300"
                    value={transform.scale * 100}
                    onChange={(e) => setTransform((prev) => ({ ...prev, scale: parseFloat(e.target.value) / 100 }))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <label className="text-sm text-gray-600 block mb-2">旋转: {transform.rotation}°</label>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={transform.rotation}
                    onChange={(e) => setTransform((prev) => ({ ...prev, rotation: parseInt(e.target.value) }))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-600 block mb-2">X: {transform.x.toFixed(0)}px</label>
                    <input
                      type="range"
                      min="-200"
                      max="200"
                      value={transform.x}
                      onChange={(e) => setTransform((prev) => ({ ...prev, x: parseInt(e.target.value) }))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600 block mb-2">Y: {transform.y.toFixed(0)}px</label>
                    <input
                      type="range"
                      min="-200"
                      max="200"
                      value={transform.y}
                      onChange={(e) => setTransform((prev) => ({ ...prev, y: parseInt(e.target.value) }))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
