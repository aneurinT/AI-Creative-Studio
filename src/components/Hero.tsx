import { Sparkles } from 'lucide-react';

export default function Hero() {
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-indigo-900 via-purple-900 to-indigo-950 rounded-3xl p-8 md:p-12">
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-10 left-10 w-32 h-32 bg-purple-500 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-40 h-40 bg-indigo-500 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-purple-600 rounded-full blur-3xl opacity-50" />
      </div>
      
      <div className="absolute inset-0 opacity-10">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>

      <div className="relative z-10 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full mb-6">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <span className="text-white/90 text-sm font-medium">AI 驱动的创意工具</span>
        </div>
        
        <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">
          一键作图
          <span className="block text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
            AI Image Generator
          </span>
        </h1>
        
        <p className="text-lg md:text-xl text-white/70 max-w-2xl mx-auto">
          输入文字描述，选择艺术风格，AI 将为你生成独一无二的精美图片
        </p>
      </div>
    </div>
  );
}