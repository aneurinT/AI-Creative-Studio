import Navbar from '@/components/Navbar';
import AIAssistant from '@/components/AIAssistant';
import { useAuth } from '@/contexts/AuthContext';
import { LogOut } from 'lucide-react';

export default function AssistantPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-8 pt-20">
        {/* 用户信息栏 */}
        {user && (
          <div className="flex items-center justify-between mb-4 px-4 py-2 bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-white text-sm font-bold">
                {(user.displayName || user.username)[0].toUpperCase()}
              </div>
              <div>
                <span className="text-sm font-medium text-gray-800">{user.displayName || user.username}</span>
                <span className="text-xs text-gray-400 ml-2">@{user.username}</span>
              </div>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <LogOut size={14} />
              退出
            </button>
          </div>
        )}
        <div className="h-[calc(100vh-240px)]">
          <AIAssistant />
        </div>
      </main>
    </div>
  );
}
