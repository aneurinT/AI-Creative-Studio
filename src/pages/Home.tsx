import { useEffect } from 'react'
import { useImageStore, STYLES } from '@/store/imageStore'
import ModelSelector from '@/components/ModelSelector'
import Navbar from '@/components/Navbar'
import { Sparkles, Download, RefreshCw, Image as ImageIcon, Type, Copy, Check, Trash2, History } from 'lucide-react'
import { useState } from 'react'

export default function Home() {
  const {
    prompt, setPrompt,
    selectedStyle, setSelectedStyle,
    selectedSize, setSelectedSize,
    models, fetchModels,
    generatedImage, caption,
    isGenerating, isGeneratingCaption,
    error, generateImage,
    history, fetchHistory, deleteHistoryItem,
  } = useImageStore()

  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (models.length === 0) fetchModels()
    fetchHistory()
  }, [])

  const handleGenerate = () => generateImage()

  const handleCopyCaption = () => {
    if (caption) {
      navigator.clipboard.writeText(caption)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDownload = () => {
    if (generatedImage) {
      const link = document.createElement('a')
      link.href = generatedImage
      link.download = `ai-image-${Date.now()}.png`
      link.click()
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8 pt-20 space-y-6">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">一键生成精美图片</h1>
          <p className="text-gray-500">输入描述，选择风格，AI 为你创作</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              图片描述
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想要生成的图片，例如：一只可爱的小猫在樱花树下..."
              className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-purple-400 focus:ring-2 focus:ring-purple-100 outline-none transition-all resize-none"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate()
              }}
            />
            <p className="text-xs text-gray-400">按 Ctrl+Enter 快速生成</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">艺术风格</label>
            <div className="flex flex-wrap gap-2">
              {STYLES.map((style) => (
                <button
                  key={style.id}
                  onClick={() => setSelectedStyle(style.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${selectedStyle === style.id
                    ? 'bg-purple-500 text-white shadow-md'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                  {style.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">图片尺寸</label>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'landscape_16_9', name: '横图 16:9' },
                { id: '1024*1024', name: '方图 1:1' },
                { id: '1024*1792', name: '竖图 9:16' },
                { id: '1792*1024', name: '横图 16:9 高清' },
                { id: 'square_hd', name: '方图高清' },
                { id: 'portrait_4_3', name: '竖图 4:3' },
                { id: 'landscape_4_3', name: '横图 4:3' },
              ].map((size) => (
                <button
                  key={size.id}
                  onClick={() => setSelectedSize(size.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${selectedSize === size.id
                    ? 'bg-indigo-500 text-white shadow-md'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                >
                  {size.name}
                </button>
              ))}
            </div>
          </div>

          <ModelSelector />

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className={`w-full py-3.5 rounded-xl font-semibold text-white transition-all flex items-center justify-center gap-2 ${isGenerating || !prompt.trim()
              ? 'bg-gray-300 cursor-not-allowed'
              : 'bg-gradient-to-r from-purple-500 to-pink-500 hover:shadow-lg hover:scale-[1.01]'
              }`}
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                AI 正在创作中...
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                一键生图
              </>
            )}
          </button>

          {error && (
            <div className="px-4 py-3 bg-red-50 text-red-600 rounded-xl text-sm">
              {error}
            </div>
          )}
        </div>

        {generatedImage && (
          <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-purple-500" />
              生成结果
            </h2>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="relative rounded-xl overflow-hidden bg-gray-100 group">
                  <img
                    src={generatedImage}
                    alt={prompt}
                    className="w-full h-auto"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={handleDownload}
                      className="px-4 py-2 bg-white/90 rounded-lg text-sm font-medium text-gray-700 hover:bg-white flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      下载
                    </button>
                    <button
                      onClick={handleGenerate}
                      className="px-4 py-2 bg-white/90 rounded-lg text-sm font-medium text-gray-700 hover:bg-white flex items-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" />
                      重新生成
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Type className="w-4 h-4 text-pink-500" />
                    AI 配图文案
                  </h3>
                  {caption && (
                    <button
                      onClick={handleCopyCaption}
                      className="px-3 py-1 text-xs text-purple-600 hover:bg-purple-50 rounded-lg flex items-center gap-1 transition-all"
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied ? '已复制' : '复制文案'}
                    </button>
                  )}
                </div>

                {isGeneratingCaption ? (
                  <div className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-100">
                    <div className="flex items-center gap-2 text-purple-500">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span className="text-sm">文案创作中...</span>
                    </div>
                    <div className="mt-3 space-y-2">
                      <div className="h-3 bg-purple-200/50 rounded animate-pulse" style={{ width: '100%' }} />
                      <div className="h-3 bg-purple-200/50 rounded animate-pulse" style={{ width: '80%' }} />
                      <div className="h-3 bg-purple-200/50 rounded animate-pulse" style={{ width: '60%' }} />
                    </div>
                  </div>
                ) : caption ? (
                  <div className="p-5 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-100">
                    <p className="text-gray-700 leading-relaxed text-sm whitespace-pre-wrap">
                      {caption}
                    </p>
                  </div>
                ) : (
                  <div className="p-4 bg-gray-50 rounded-xl text-center text-sm text-gray-400">
                    文案生成失败，可点击下方按钮重试
                  </div>
                )}

                <div className="p-3 bg-gray-50 rounded-xl">
                  <p className="text-xs text-gray-400 mb-1">原始描述</p>
                  <p className="text-sm text-gray-600">{prompt}</p>
                </div>

                {caption && (
                  <button
                    onClick={() => useImageStore.getState().generateCaption()}
                    disabled={isGeneratingCaption}
                    className="w-full py-2 text-sm text-purple-600 hover:bg-purple-50 rounded-lg flex items-center justify-center gap-1 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isGeneratingCaption ? 'animate-spin' : ''}`} />
                    重新生成文案
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <History className="w-5 h-5 text-indigo-500" />
              历史记录
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {history.slice(0, 8).map((item) => (
                <div key={item.id} className="relative group rounded-xl overflow-hidden bg-gray-100">
                  <img
                    src={item.imageUrl}
                    alt={item.prompt}
                    className="w-full h-32 object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-all flex flex-col justify-end p-2">
                    <p className="text-white text-xs line-clamp-2">{item.prompt}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-white/50 text-xs">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => deleteHistoryItem(item.id)}
                        className="text-white/70 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="text-center py-6 text-sm text-gray-400">
        AI Image Generator · Powered by 多模型协作
      </footer>
    </div>
  )
}