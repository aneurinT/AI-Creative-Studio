import { Sparkles, Wand2, Layers, Settings, Video, MessageSquare, FileText, Globe } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export default function Navbar() {
  const location = useLocation();

  const navItems = [
    { path: '/assistant', label: 'AI助手', icon: MessageSquare, tip: '多Agent协作的智能对话助手' },
    { path: '/generate', label: '一键生图', icon: Sparkles, tip: '输入描述生成精美图片' },
    { path: '/video', label: '视频生成', icon: Video, tip: '描述内容生成AI视频' },
    { path: '/remove-bg', label: '智能抠图', icon: Wand2, tip: '一键去除图片背景' },
    { path: '/ocr', label: 'OCR识别', icon: FileText, tip: '批量识别图片文字' },
    { path: '/compose', label: '图片合成', icon: Layers, tip: '提取主体并合成到新背景' },
    { path: '/settings', label: '模型配置', icon: Settings, tip: '配置各模型API Key' },
    { path: '/social-bind', label: '账号绑定', icon: Globe, tip: '绑定抖音/快手/小红书账号，定时发布' },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-sm shadow-sm z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-gray-800 text-lg">AI 创意工坊</span>
        </div>

        <div className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                title={item.tip}
                className={`px-3 py-2 rounded-lg flex items-center gap-1.5 transition-all ${isActive
                  ? 'bg-purple-100 text-purple-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
                  }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
