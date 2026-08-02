import { useState } from 'react';
import { Sparkles, Image, Video, Wand2, Layers, MessageSquare, LayoutGrid, ArrowRight } from 'lucide-react';
import Navbar from '@/components/Navbar';
import AIAssistant from '@/components/AIAssistant';

export default function NewHome() {
  const [mode, setMode] = useState<'assistant' | 'manual'>('assistant');

  const manualFeatures = [
    {
      title: '一键生图',
      description: '输入描述，选择风格，AI 为你生成精美图片',
      icon: Sparkles,
      color: 'from-purple-500 to-pink-500',
      bgColor: 'bg-purple-50',
      textColor: 'text-purple-600',
      path: '/generate',
    },
    {
      title: '视频生成',
      description: '描述视频内容和时长，AI 为你创作精彩视频',
      icon: Video,
      color: 'from-blue-500 to-indigo-600',
      bgColor: 'bg-blue-50',
      textColor: 'text-blue-600',
      path: '/video',
    },
    {
      title: '智能抠图',
      description: 'AI 自动识别主体，一键去除图片背景',
      icon: Wand2,
      color: 'from-green-500 to-emerald-600',
      bgColor: 'bg-green-50',
      textColor: 'text-green-600',
      path: '/remove-bg',
    },
    {
      title: '图片合成',
      description: '提取主体并合成到新背景，创造创意作品',
      icon: Layers,
      color: 'from-orange-500 to-amber-600',
      bgColor: 'bg-orange-50',
      textColor: 'text-orange-600',
      path: '/compose',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-8 pt-20">
        <div className="flex items-center justify-center gap-4 mb-8">
          <button
            onClick={() => setMode('assistant')}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all ${
              mode === 'assistant'
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <MessageSquare className="w-5 h-5" />
            AI 智能助手
          </button>
          <button
            onClick={() => setMode('manual')}
            className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all ${
              mode === 'manual'
                ? 'bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg'
                : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
            }`}
          >
            <LayoutGrid className="w-5 h-5" />
            手动模式
          </button>
        </div>

        {/* AIAssistant 始终挂载，通过 display 切换显示/隐藏，避免切换模式时丢失对话和未完成任务 */}
        <div className="h-[calc(100vh-180px)]" style={{ display: mode === 'assistant' ? 'block' : 'none' }}>
          <AIAssistant />
        </div>
        {mode === 'manual' && (
          <div className="space-y-6">
            <div className="text-center">
              <h1 className="text-3xl font-bold text-gray-800 mb-2">AI 创意工坊</h1>
              <p className="text-gray-500">选择你想要使用的功能</p>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {manualFeatures.map((feature) => {
                const Icon = feature.icon;
                return (
                  <a
                    key={feature.title}
                    href={feature.path}
                    className="group bg-white rounded-2xl shadow-lg p-6 hover:shadow-xl transition-all hover:-translate-y-1"
                  >
                    <div className={`w-14 h-14 ${feature.bgColor} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                      <Icon className={`w-7 h-7 ${feature.textColor}`} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-800 mb-2">{feature.title}</h3>
                    <p className="text-gray-500 mb-4">{feature.description}</p>
                    <div className={`inline-flex items-center gap-2 text-sm font-medium ${feature.textColor} group-hover:gap-3 transition-all`}>
                      开始使用
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <footer className="text-center py-6 text-sm text-gray-400">
        AI 创意工坊 · Powered by 多模型协作
      </footer>
    </div>
  );
}