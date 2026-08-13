import { useState, useRef, useEffect } from 'react';
import { Sparkles, Wand2, Layers, Settings, Video, MessageSquare, FileText, Globe, Film, Image, ChevronDown } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

interface NavGroup {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: { path: string; label: string; icon: React.ComponentType<{ className?: string }>; tip: string }[];
}

export default function Navbar() {
  const location = useLocation();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  const groups: NavGroup[] = [
    {
      label: '视频模块',
      icon: Film,
      items: [
        { path: '/video', label: '视频生成', icon: Video, tip: '描述内容生成AI视频' },
        { path: '/video-edit', label: 'AI剪辑', icon: Film, tip: 'AI智能剪辑、字幕、配音' },
      ],
    },
    {
      label: '图片模块',
      icon: Image,
      items: [
        { path: '/generate', label: '一键生图', icon: Sparkles, tip: '输入描述生成精美图片' },
        { path: '/remove-bg', label: '智能抠图', icon: Wand2, tip: '一键去除图片背景' },
        { path: '/ocr', label: 'OCR识别', icon: FileText, tip: '批量识别图片文字' },
        { path: '/compose', label: '图片合成', icon: Layers, tip: '提取主体并合成到新背景' },
      ],
    },
    {
      label: '配置模块',
      icon: Settings,
      items: [
        { path: '/settings', label: '模型配置', icon: Settings, tip: '配置各模型API Key' },
        { path: '/social-bind', label: '账号绑定', icon: Globe, tip: '绑定抖音/快手/小红书账号，定时发布' },
      ],
    },
  ];

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Check if any item in a group is active
  function isGroupActive(group: NavGroup): boolean {
    return group.items.some((item) => location.pathname === item.path);
  }

  return (
    <nav ref={navRef} className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-sm shadow-sm z-50">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-gray-800 text-lg">AI 创意工坊</span>
        </Link>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          {/* AI助手 - standalone */}
          <Link
            to="/assistant"
            title="多Agent协作的智能对话助手"
            className={`px-3 py-2 rounded-lg flex items-center gap-1.5 transition-all ${
              location.pathname === '/assistant'
                ? 'bg-purple-100 text-purple-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            AI助手
          </Link>

          {/* Grouped dropdowns */}
          {groups.map((group) => {
            const Icon = group.icon;
            const isOpen = openGroup === group.label;
            const active = isGroupActive(group);

            return (
              <div key={group.label} className="relative">
                <button
                  onClick={() => setOpenGroup(isOpen ? null : group.label)}
                  onMouseEnter={() => setOpenGroup(group.label)}
                  title={group.label}
                  className={`px-3 py-2 rounded-lg flex items-center gap-1.5 transition-all ${
                    active
                      ? 'bg-purple-100 text-purple-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {group.label}
                  <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown */}
                {isOpen && (
                  <div
                    className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 py-1.5 min-w-[160px]"
                    onMouseLeave={() => setOpenGroup(null)}
                  >
                    {group.items.map((item) => {
                      const ItemIcon = item.icon;
                      const isActive = location.pathname === item.path;
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          title={item.tip}
                          onClick={() => setOpenGroup(null)}
                          className={`px-3.5 py-2 flex items-center gap-2 transition-all text-sm ${
                            isActive
                              ? 'bg-purple-50 text-purple-700 font-medium'
                              : 'text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <ItemIcon className="w-3.5 h-3.5 flex-shrink-0" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}