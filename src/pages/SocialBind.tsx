import { useState, useEffect } from 'react';
import { Link2, CheckCircle, AlertCircle, ExternalLink, RefreshCw, Clock, Shield, Trash2 } from 'lucide-react';
import Navbar from '@/components/Navbar';

interface PlatformInfo {
  platform: string;
  name: string;
  icon: string;
  maxTitleLength: number;
  maxContentLength: number;
  supportedMedia: string[];
  maxVideoDuration: number;
  maxTags: number;
}

interface AuthStatus {
  platform: string;
  authorized: boolean;
}

interface ScheduleItem {
  id: string;
  platform: string;
  platforms: string[];
  title: string;
  content: string;
  interval: number;       // 间隔分钟数
  nextRunAt: string;
  enabled: boolean;
  createdAt: string;
}

const PLATFORM_META: Record<string, { color: string; bgColor: string; borderColor: string; textColor: string; desc: string; oauthDesc: string }> = {
  douyin: {
    color: 'from-gray-900 to-black',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    textColor: 'text-gray-800',
    desc: '短视频平台，支持图片和视频发布',
    oauthDesc: '需在抖音开放平台创建应用并获取 Client Key',
  },
  kuaishou: {
    color: 'from-orange-500 to-red-500',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    textColor: 'text-orange-800',
    desc: '短视频平台，支持图片和视频发布',
    oauthDesc: '需在快手开放平台创建应用并获取 App Key',
  },
  xiaohongshu: {
    color: 'from-red-500 to-pink-500',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-800',
    desc: '生活方式社区，支持图文和视频笔记',
    oauthDesc: '需在小红书开放平台创建应用并获取 App Key',
  },
};

export default function SocialBind() {
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [authStatus, setAuthStatus] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [authorizing, setAuthorizing] = useState<string | null>(null);
  const [unbinding, setUnbinding] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    platforms: [] as string[],
    title: '',
    content: '',
    interval: 60,
  });
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // 获取平台配置
      const configRes = await fetch('/api/social/config', { headers });
      const configData = await configRes.json();
      if (configData.success) {
        setPlatforms(configData.data);
      }

      // 获取授权状态
      const healthRes = await fetch('/api/social/health', { headers });
      const healthData = await healthRes.json();
      if (healthData.success && healthData.platforms) {
        const status: Record<string, boolean> = {};
        healthData.platforms.forEach((p: AuthStatus) => {
          status[p.platform] = p.authorized;
        });
        setAuthStatus(status);
      }

      // 获取定时任务
      fetchSchedules();
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSchedules = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/social/schedules', { headers });
      const data = await res.json();
      if (data.success) {
        setSchedules(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch schedules:', err);
    }
  };

  const handleAuthorize = async (platform: string) => {
    setAuthorizing(platform);
    setMessage(null);

    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const redirectUri = `${window.location.origin}/social-bind`;
      const state = Math.random().toString(36).substring(2, 15);

      const res = await fetch(
        `/api/social/auth/${platform}?redirectUri=${encodeURIComponent(redirectUri)}&state=${state}`,
        { headers }
      );
      const data = await res.json();

      if (data.success && data.data.authUrl) {
        // 模拟授权流程：新窗口打开授权 URL，同时用 mock 回调
        window.open(data.data.authUrl, '_blank', 'width=600,height=700');

        // Mock 回调处理
        setTimeout(async () => {
          try {
            const callbackRes = await fetch(`/api/social/auth/${platform}/callback`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                code: `mock_code_${Date.now()}`,
                openId: `mock_openid_${platform}`,
                userId: localStorage.getItem('user_id') || 'default',
              }),
            });
            const callbackData = await callbackRes.json();
            if (callbackData.success) {
              setAuthStatus(prev => ({ ...prev, [platform]: true }));
              setMessage({ type: 'success', text: `${PLATFORM_META[platform]?.desc?.split('，')[0] || platform} 授权成功！Token 有效期 2 小时` });
            } else {
              setMessage({ type: 'error', text: `授权失败: ${callbackData.error || '未知错误'}` });
            }
          } catch (err: any) {
            setMessage({ type: 'error', text: `授权回调失败: ${err.message}` });
          }
          setAuthorizing(null);
        }, 1500);
      } else {
        setMessage({ type: 'error', text: data.error || '获取授权链接失败' });
        setAuthorizing(null);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `授权失败: ${err.message}` });
      setAuthorizing(null);
    }
  };

  const handleUnbind = async (platform: string) => {
    if (!confirm(`确定要解绑 ${PLATFORM_META[platform]?.desc?.split('，')[0] || platform} 账号吗？解绑后需要重新授权才能发布。`)) return;

    setUnbinding(platform);
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/social/auth/${platform}/revoke`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: localStorage.getItem('user_id') || 'default' }),
      });
      const data = await res.json();
      if (data.success) {
        setAuthStatus(prev => ({ ...prev, [platform]: false }));
        setMessage({ type: 'success', text: '已解绑' });
      } else {
        setMessage({ type: 'error', text: data.error || '解绑失败' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `解绑失败: ${err.message}` });
    } finally {
      setUnbinding(null);
    }
  };

  const handleCreateSchedule = async () => {
    if (scheduleForm.platforms.length === 0) {
      setMessage({ type: 'error', text: '请至少选择一个平台' });
      return;
    }
    if (!scheduleForm.title.trim()) {
      setMessage({ type: 'error', text: '请输入发布标题' });
      return;
    }

    setScheduleSubmitting(true);
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/social/schedule', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          platforms: scheduleForm.platforms,
          content: {
            title: scheduleForm.title,
            content: scheduleForm.content,
          },
          intervalMinutes: scheduleForm.interval,
          userId: localStorage.getItem('user_id') || 'default',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: `定时发布已创建，每 ${scheduleForm.interval} 分钟自动发布一次` });
        setShowScheduleModal(false);
        setScheduleForm({ platforms: [], title: '', content: '', interval: 60 });
        fetchSchedules();
      } else {
        setMessage({ type: 'error', text: data.error || '创建失败' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `创建定时任务失败: ${err.message}` });
    } finally {
      setScheduleSubmitting(false);
    }
  };

  const handleToggleSchedule = async (id: string, enabled: boolean) => {
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/social/schedule/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      if (data.success) {
        fetchSchedules();
      }
    } catch (err) {
      console.error('Failed to toggle schedule:', err);
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm('确定要删除这个定时任务吗？')) return;
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/social/schedule/${id}`, { method: 'DELETE', headers });
      const data = await res.json();
      if (data.success) {
        fetchSchedules();
        setMessage({ type: 'success', text: '定时任务已删除' });
      }
    } catch (err) {
      console.error('Failed to delete schedule:', err);
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds >= 60) return `${Math.floor(seconds / 60)} 分钟`;
    return `${seconds} 秒`;
  };

  const formatNextRun = (isoStr: string) => {
    const d = new Date(isoStr);
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-4xl mx-auto px-4 py-8 pt-20">
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
            <span className="ml-2 text-gray-500">加载中...</span>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-4xl mx-auto px-4 py-8 pt-20">
        {/* 页面标题 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
              <Link2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800">账号绑定</h1>
              <p className="text-sm text-gray-500">绑定抖音、快手、小红书账号，实现内容一键发布到各大平台</p>
            </div>
          </div>

          {message && (
            <div className={`mt-4 p-3 rounded-xl text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
              {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {message.text}
            </div>
          )}
        </div>

        {/* 平台绑定卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {platforms.map((platform) => {
            const meta = PLATFORM_META[platform.platform] || PLATFORM_META.douyin;
            const isAuthorized = authStatus[platform.platform] || false;
            const isAuthing = authorizing === platform.platform;
            const isUnbinding = unbinding === platform.platform;

            return (
              <div
                key={platform.platform}
                className={`bg-white rounded-2xl shadow-lg p-5 border-2 transition-all ${isAuthorized ? 'border-green-300' : 'border-gray-200'}`}
              >
                {/* 平台图标 + 名称 */}
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-12 h-12 bg-gradient-to-br ${meta.color} rounded-xl flex items-center justify-center text-2xl`}>
                    {platform.icon}
                  </div>
                  <div>
                    <h3 className={`font-bold ${meta.textColor}`}>{platform.name}</h3>
                    <p className="text-xs text-gray-500">{meta.desc}</p>
                  </div>
                </div>

                {/* 绑定状态 */}
                <div className={`p-3 rounded-xl mb-3 ${isAuthorized ? 'bg-green-50' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-2">
                    {isAuthorized ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span className="text-sm text-green-600 font-medium">已授权</span>
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-500">未授权</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{meta.oauthDesc}</p>
                </div>

                {/* 平台能力 */}
                <div className="text-xs text-gray-500 space-y-1 mb-3">
                  <div className="flex justify-between">
                    <span>标题限制</span>
                    <span>{platform.maxTitleLength} 字</span>
                  </div>
                  <div className="flex justify-between">
                    <span>内容限制</span>
                    <span>{platform.maxContentLength} 字</span>
                  </div>
                  <div className="flex justify-between">
                    <span>视频时长</span>
                    <span>{formatDuration(platform.maxVideoDuration)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>标签数量</span>
                    <span>最多 {platform.maxTags} 个</span>
                  </div>
                  <div className="flex justify-between">
                    <span>支持类型</span>
                    <span>{platform.supportedMedia.join(' / ')}</span>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex gap-2">
                  {isAuthorized ? (
                    <button
                      onClick={() => handleUnbind(platform.platform)}
                      disabled={isUnbinding}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-all text-sm disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      {isUnbinding ? '解绑中...' : '解绑'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAuthorize(platform.platform)}
                      disabled={isAuthing}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-white transition-all text-sm bg-gradient-to-r ${meta.color} hover:opacity-90 disabled:opacity-50`}
                    >
                      <ExternalLink className="w-4 h-4" />
                      {isAuthing ? '授权中...' : '授权绑定'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 定时发布 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-purple-500" />
              <h2 className="text-lg font-bold text-gray-800">定时发布</h2>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                {schedules.filter(s => s.enabled).length} 个运行中
              </span>
            </div>
            <button
              onClick={() => setShowScheduleModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl text-sm font-medium hover:shadow-lg transition-all"
            >
              <Clock className="w-4 h-4" />
              新建定时发布
            </button>
          </div>

          {schedules.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">暂无定时发布任务</p>
              <p className="text-xs mt-1">设置定时发布后，系统将按设定间隔自动发布内容到指定平台</p>
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.map((schedule) => (
                <div
                  key={schedule.id}
                  className={`p-4 rounded-xl border-2 transition-all ${schedule.enabled ? 'border-purple-200 bg-purple-50/30' : 'border-gray-200 bg-gray-50'}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-800 text-sm truncate">{schedule.title}</h3>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{schedule.content || '(无正文)'}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          每 {schedule.interval} 分钟
                        </span>
                        <span>
                          下次: {formatNextRun(schedule.nextRunAt)}
                        </span>
                        <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                          {schedule.platforms.map(p => {
                            const found = platforms.find(pl => pl.platform === p);
                            return found ? found.name : p;
                          }).join(' / ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      <button
                        onClick={() => handleToggleSchedule(schedule.id, !schedule.enabled)}
                        className={`w-10 h-6 rounded-full transition-all relative ${schedule.enabled ? 'bg-purple-500' : 'bg-gray-300'}`}
                        title={schedule.enabled ? '点击暂停' : '点击启用'}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${schedule.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                      </button>
                      <button
                        onClick={() => handleDeleteSchedule(schedule.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 发布失败处理说明 */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-gray-800">发布失败处理</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-600">
            <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-xl">
              <span className="w-6 h-6 bg-amber-200 text-amber-700 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">1</span>
              <div>
                <p className="font-medium text-amber-800">自动重试</p>
                <p className="text-xs text-amber-600 mt-0.5">发布失败后自动重试最多 3 次，每次间隔递增（30s / 60s / 120s）</p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-xl">
              <span className="w-6 h-6 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">2</span>
              <div>
                <p className="font-medium text-blue-800">Token 刷新</p>
                <p className="text-xs text-blue-600 mt-0.5">检测到 Token 过期时自动使用 refresh_token 刷新，无需重新授权</p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 bg-red-50 rounded-xl">
              <span className="w-6 h-6 bg-red-200 text-red-700 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">3</span>
              <div>
                <p className="font-medium text-red-800">失败记录</p>
                <p className="text-xs text-red-600 mt-0.5">所有发布失败记录在历史中，可查看失败原因和时间</p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 bg-green-50 rounded-xl">
              <span className="w-6 h-6 bg-green-200 text-green-700 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">4</span>
              <div>
                <p className="font-medium text-green-800">发布历史</p>
                <p className="text-xs text-green-600 mt-0.5">完整记录所有发布历史，支持按平台筛选和查看详情</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 定时发布弹窗 */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowScheduleModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">新建定时发布</h3>

            {/* 选择平台 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">发布平台</label>
              <div className="flex gap-2">
                {platforms.map(p => (
                  <button
                    key={p.platform}
                    onClick={() => setScheduleForm(prev => ({
                      ...prev,
                      platforms: prev.platforms.includes(p.platform)
                        ? prev.platforms.filter(x => x !== p.platform)
                        : [...prev.platforms, p.platform],
                    }))}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border-2 transition-all text-sm ${scheduleForm.platforms.includes(p.platform) ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-600'}`}
                  >
                    <span>{p.icon}</span>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 标题 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">发布标题</label>
              <input
                type="text"
                value={scheduleForm.title}
                onChange={e => setScheduleForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="输入发布内容标题"
                className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:border-purple-400 outline-none text-sm"
              />
            </div>

            {/* 正文 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">正文内容</label>
              <textarea
                value={scheduleForm.content}
                onChange={e => setScheduleForm(prev => ({ ...prev, content: e.target.value }))}
                placeholder="输入发布正文（可选）"
                rows={3}
                className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:border-purple-400 outline-none text-sm resize-none"
              />
            </div>

            {/* 间隔时间 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                发布间隔: <span className="text-purple-600 font-bold">{scheduleForm.interval}</span> 分钟
              </label>
              <input
                type="range"
                min="10"
                max="1440"
                step="10"
                value={scheduleForm.interval}
                onChange={e => setScheduleForm(prev => ({ ...prev, interval: parseInt(e.target.value) }))}
                className="w-full accent-purple-500"
              />
              <div className="flex justify-between text-xs text-gray-400">
                <span>10 分钟</span>
                <span>24 小时</span>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowScheduleModal(false)}
                className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleCreateSchedule}
                disabled={scheduleSubmitting}
                className="flex-1 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium hover:shadow-lg transition-all disabled:opacity-50"
              >
                {scheduleSubmitting ? '创建中...' : '创建定时任务'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}