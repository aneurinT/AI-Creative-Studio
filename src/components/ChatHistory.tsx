import React, { useState, useEffect } from 'react';
import { Plus, Trash2, MessageCircle, Clock } from 'lucide-react';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatHistoryProps {
  currentSessionId: string | null;
  onSelectSession: (session: ChatSession) => void;
  onCreateSession: () => void;
  onSessionDeleted?: (deletedId?: string) => void;
  sessionListVersion?: number;
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
  currentSessionId,
  onSelectSession,
  onCreateSession,
  onSessionDeleted,
  sessionListVersion = 0,
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  // 当 sessionListVersion 变化时（创建/删除会话后），重新加载会话列表
  useEffect(() => {
    if (sessionListVersion > 0) {
      loadSessions();
    }
  }, [sessionListVersion]);

  async function loadSessions() {
    setLoading(true);
    try {
      const response = await fetch('/api/chat/sessions', { headers: authHeaders() });
      const data = await response.json();
      if (data.success) {
        setSessions(data.sessions);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('确定要删除这个会话吗？')) return;

    try {
      const response = await fetch(`/api/chat/sessions/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await response.json();
      if (data.success) {
        setSessions(prev => prev.filter(s => s.id !== id));
        // 通知父组件：会话已删除，父组件负责处理当前会话切换/新建
        if (onSessionDeleted) {
          onSessionDeleted(id);
        }
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - timestamp;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;

    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  }

  function getLastMessage(session: ChatSession): string {
    const lastMessage = session.messages[session.messages.length - 1];
    if (!lastMessage) return '暂无消息';

    const content = lastMessage.content;
    if (content.length > 30) return content.substring(0, 30) + '...';
    return content;
  }

  return (
    <div className="w-72 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-purple-600" />
            聊天记录
          </h2>
          <button
            onClick={onCreateSession}
            className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
            title="新建会话"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            加载中...
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <MessageCircle className="w-12 h-12 mb-2 opacity-50" />
            <p className="text-sm">暂无聊天记录</p>
            <p className="text-xs mt-1">点击上方按钮新建会话</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {sessions.map(session => (
              <div
                key={session.id}
                onClick={() => onSelectSession(session)}
                className={`p-3 rounded-lg cursor-pointer transition-all group ${
                  currentSessionId === session.id
                    ? 'bg-purple-50 border border-purple-200'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                <div className="flex items-start justify-between">
                  <h3 className={`font-medium text-sm flex-1 truncate ${
                    currentSessionId === session.id ? 'text-purple-700' : 'text-gray-700'
                  }`}>
                    {session.title || '新会话'}
                  </h3>
                  <button
                    onClick={(e) => handleDeleteSession(session.id, e)}
                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="删除会话"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1 truncate">
                  {getLastMessage(session)}
                </p>
                <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                  <Clock className="w-3 h-3" />
                  <span>{formatTime(session.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatHistory;