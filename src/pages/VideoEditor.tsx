import { useState, useRef, useEffect } from 'react';
import {
  Scissors, Upload, Type, Mic, Play, Pause, SkipBack, SkipForward,
  CheckCircle, AlertCircle, RefreshCw, Download, Trash2, Clock,
  Wand2, Layers, Film, Volume2, ChevronDown, Zap, Cpu
} from 'lucide-react';
import Navbar from '@/components/Navbar';

interface VideoFile {
  filename: string;
  originalname: string;
  size: number;
  url: string;
  path: string;
}

interface EditTask {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  operations: string[];
  result?: {
    outputUrl: string;
    duration: number;
    fileSize: number;
    subtitles?: { start: number; end: number; text: string }[];
    scenes?: { index: number; startTime: number; endTime: number; description: string; confidence: number }[];
  };
  error?: string;
  createdAt: string;
}

interface ToolsStatus {
  ffmpeg: boolean;
  whisper: boolean;
  edgeTts: boolean;
}

type EditMode = 'smart-edit' | 'subtitle' | 'dubbing' | 'trim' | 'replace';

const MODE_META: Record<EditMode, { label: string; icon: any; desc: string; color: string }> = {
  'smart-edit': { label: '智能剪辑', icon: Wand2, desc: 'AI 自动识别场景，智能裁剪精华片段', color: 'from-purple-500 to-pink-500' },
  'subtitle': { label: 'AI 字幕', icon: Type, desc: '自动语音识别生成字幕，烧录到视频', color: 'from-blue-500 to-cyan-500' },
  'dubbing': { label: 'AI 配音', icon: Mic, desc: '文字转语音，替换或叠加视频音频', color: 'from-orange-500 to-red-500' },
  'trim': { label: '裁剪截取', icon: Scissors, desc: '精确裁剪视频片段，保留精彩部分', color: 'from-green-500 to-emerald-500' },
  'replace': { label: '片段替换', icon: Layers, desc: '替换视频中不满意的时间段', color: 'from-yellow-500 to-amber-500' },
};

const DUBBING_VOICES = [
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女声·温柔）' },
  { value: 'zh-CN-YunxiNeural', label: '云希（男声·叙事）' },
  { value: 'zh-CN-YunjianNeural', label: '云健（男声·运动）' },
  { value: 'zh-CN-XiaoyiNeural', label: '晓伊（女声·活泼）' },
  { value: 'zh-CN-YunyangNeural', label: '云扬（男声·新闻）' },
  { value: 'zh-CN-XiaochenNeural', label: '晓辰（女声·自然）' },
];

export default function VideoEditor() {
  // 视频状态
  const [video, setVideo] = useState<VideoFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // 编辑模式
  const [mode, setMode] = useState<EditMode>('smart-edit');

  // 智能剪辑参数
  const [smartPrompt, setSmartPrompt] = useState('');

  // 字幕参数
  const [subtitleLang, setSubtitleLang] = useState('zh');

  // 配音参数
  const [dubbingText, setDubbingText] = useState('');
  const [dubbingVoice, setDubbingVoice] = useState('zh-CN-XiaoxiaoNeural');
  const [dubbingSpeed, setDubbingSpeed] = useState(1.0);

  // 裁剪参数
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(60);

  // 任务状态
  const [task, setTask] = useState<EditTask | null>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 工具状态
  const [tools, setTools] = useState<ToolsStatus>({ ffmpeg: false, whisper: false, edgeTts: false });

  // 视频播放
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    checkTools();
  }, []);

  useEffect(() => {
    // 轮询任务状态
    if (task && (task.status === 'pending' || task.status === 'processing')) {
      const interval = setInterval(() => fetchTaskStatus(task.id), 2000);
      return () => clearInterval(interval);
    }
  }, [task?.id, task?.status]);

  const checkTools = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/video-edit/tools', { headers });
      const data = await res.json();
      if (data.success) setTools(data.data);
    } catch {}
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError('');
    const formData = new FormData();
    formData.append('video', file);

    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/video-edit/upload', {
        method: 'POST',
        headers,
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setVideo(data.data);
        setMessage({ type: 'success', text: '视频上传成功' });
      } else {
        setUploadError(data.error || '上传失败');
      }
    } catch (err: any) {
      setUploadError(`上传失败: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleEdit = async () => {
    if (!video) return;

    setProcessing(true);
    setMessage(null);
    const operations: string[] = [mode];

    const params: any = {};
    switch (mode) {
      case 'smart-edit':
        params.smartEditPrompt = smartPrompt;
        break;
      case 'subtitle':
        params.subtitleLang = subtitleLang;
        params.autoSubtitle = true;
        break;
      case 'dubbing':
        params.dubbingText = dubbingText;
        params.dubbingVoice = dubbingVoice;
        params.dubbingSpeed = dubbingSpeed;
        break;
      case 'trim':
        params.trimStart = trimStart;
        params.trimEnd = trimEnd;
        break;
    }

    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/video-edit/task', {
        method: 'POST',
        headers,
        body: JSON.stringify({ videoPath: video.path, operations, params }),
      });
      const data = await res.json();
      if (data.success) {
        setTask({
          id: data.data.taskId,
          status: data.data.status,
          progress: 0,
          operations: data.data.operations,
          createdAt: new Date().toISOString(),
        });
      } else {
        setMessage({ type: 'error', text: data.error || '创建任务失败' });
        setProcessing(false);
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `请求失败: ${err.message}` });
      setProcessing(false);
    }
  };

  const fetchTaskStatus = async (taskId: string) => {
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/video-edit/task/${taskId}`, { headers });
      const data = await res.json();
      if (data.success) {
        setTask(data.data);
        if (data.data.status === 'completed') {
          setProcessing(false);
          setMessage({ type: 'success', text: '剪辑完成！' });
        } else if (data.data.status === 'failed') {
          setProcessing(false);
          setMessage({ type: 'error', text: `剪辑失败: ${data.data.error}` });
        }
      }
    } catch {}
  };

  const handleReset = () => {
    setVideo(null);
    setTask(null);
    setProcessing(false);
    setMessage(null);
    setSmartPrompt('');
    setDubbingText('');
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 py-8 pt-20">
        {/* 页面标题 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
              <Film className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800">AI 视频剪辑</h1>
              <p className="text-sm text-gray-500">上传视频，AI 智能剪辑 · 自动字幕 · 智能配音</p>
            </div>
          </div>

          {/* 工具状态 */}
          <div className="flex gap-3 mt-3 text-xs">
            <span className={`px-2 py-0.5 rounded-full flex items-center gap-1 ${tools.ffmpeg ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
              <Zap className="w-3 h-3" />
              FFmpeg {tools.ffmpeg ? '可用' : '未安装'}
            </span>
            <span className={`px-2 py-0.5 rounded-full flex items-center gap-1 ${tools.whisper ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
              <Cpu className="w-3 h-3" />
              Whisper {tools.whisper ? '可用' : '未安装'}
            </span>
            <span className={`px-2 py-0.5 rounded-full flex items-center gap-1 ${tools.edgeTts ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
              <Volume2 className="w-3 h-3" />
              Edge-TTS {tools.edgeTts ? '可用' : '未安装'}
            </span>
          </div>

          {message && (
            <div className={`mt-4 p-3 rounded-xl text-sm flex items-center gap-2 ${message.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
              {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {message.text}
            </div>
          )}
        </div>

        {/* 上传区域 */}
        {!video ? (
          <div className="bg-white rounded-2xl shadow-lg p-8 mb-6">
            <label className="flex flex-col items-center gap-4 cursor-pointer">
              <div className="w-20 h-20 bg-gradient-to-br from-purple-100 to-pink-100 rounded-2xl flex items-center justify-center">
                <Upload className="w-10 h-10 text-purple-500" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-gray-800">点击上传视频</p>
                <p className="text-sm text-gray-500 mt-1">支持 MP4、WebM、MOV、AVI、MKV，最大 500MB</p>
              </div>
              <input
                type="file"
                accept="video/*"
                onChange={handleUpload}
                className="hidden"
              />
              {uploading && (
                <div className="flex items-center gap-2 text-purple-600">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  上传中...
                </div>
              )}
              {uploadError && (
                <p className="text-red-500 text-sm">{uploadError}</p>
              )}
            </label>
          </div>
        ) : (
          <>
            {/* 视频预览 */}
            <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Film className="w-5 h-5 text-purple-500" />
                  <h2 className="font-bold text-gray-800">视频预览</h2>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-500">
                  <span>{video.originalname}</span>
                  <span>·</span>
                  <span>{formatSize(video.size)}</span>
                  <button onClick={handleReset} className="text-red-400 hover:text-red-600" title="重新上传">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
                <video
                  ref={videoRef}
                  src={video.url}
                  className="w-full h-full object-contain"
                  onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
                  onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  controls
                />
              </div>
            </div>

            {/* 编辑模式选择 */}
            <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
              <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-purple-500" />
                选择编辑模式
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
                {(Object.entries(MODE_META) as [EditMode, typeof MODE_META[EditMode]][]).map(([key, meta]) => {
                  const Icon = meta.icon;
                  return (
                    <button
                      key={key}
                      onClick={() => setMode(key)}
                      className={`p-3 rounded-xl border-2 transition-all text-center ${mode === key ? `border-purple-400 bg-purple-50` : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      <Icon className={`w-5 h-5 mx-auto mb-1 ${mode === key ? 'text-purple-600' : 'text-gray-400'}`} />
                      <span className={`text-xs font-medium ${mode === key ? 'text-purple-700' : 'text-gray-600'}`}>{meta.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* 模式参数 */}
              <div className="p-4 bg-gray-50 rounded-xl">
                {mode === 'smart-edit' && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">智能剪辑提示</p>
                    <textarea
                      value={smartPrompt}
                      onChange={e => setSmartPrompt(e.target.value)}
                      placeholder="描述你想要的剪辑效果，例如：保留最精彩的片段，去掉冗余的过渡，剪辑成30秒的短视频"
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:border-purple-400 outline-none text-sm resize-none"
                    />
                  </div>
                )}

                {mode === 'subtitle' && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">字幕语言</p>
                    <select
                      value={subtitleLang}
                      onChange={e => setSubtitleLang(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:border-purple-400 outline-none text-sm bg-white"
                    >
                      <option value="zh">中文</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                      <option value="ko">한국어</option>
                    </select>
                    <p className="text-xs text-gray-400 mt-2">
                      优先使用云端 AI 语音识别，不可用时自动切换到本地 Whisper
                    </p>
                  </div>
                )}

                {mode === 'dubbing' && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-1">配音文本</p>
                      <textarea
                        value={dubbingText}
                        onChange={e => setDubbingText(e.target.value)}
                        placeholder="输入要配音的文字内容..."
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:border-purple-400 outline-none text-sm resize-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-1">音色</p>
                        <select
                          value={dubbingVoice}
                          onChange={e => setDubbingVoice(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:border-purple-400 outline-none text-sm bg-white"
                        >
                          {DUBBING_VOICES.map(v => (
                            <option key={v.value} value={v.value}>{v.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-1">语速: {dubbingSpeed.toFixed(1)}x</p>
                        <input
                          type="range"
                          min="0.5"
                          max="2.0"
                          step="0.1"
                          value={dubbingSpeed}
                          onChange={e => setDubbingSpeed(parseFloat(e.target.value))}
                          className="w-full accent-purple-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {mode === 'trim' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-1">开始时间</p>
                        <input
                          type="number"
                          min="0"
                          max={duration}
                          step="0.1"
                          value={trimStart}
                          onChange={e => setTrimStart(parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:border-purple-400 outline-none text-sm"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700 mb-1">结束时间</p>
                        <input
                          type="number"
                          min={trimStart + 0.1}
                          max={duration}
                          step="0.1"
                          value={trimEnd}
                          onChange={e => setTrimEnd(parseFloat(e.target.value) || trimStart + 1)}
                          className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:border-purple-400 outline-none text-sm"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">
                      视频总时长: {formatTime(duration)}，将截取 {formatTime(trimStart)} - {formatTime(trimEnd)} 共 {formatTime(trimEnd - trimStart)}
                    </p>
                  </div>
                )}

                {mode === 'replace' && (
                  <div className="p-4 text-center">
                    <p className="text-sm text-gray-500">
                      片段替换功能需要在 AI 助手中使用，通过对话描述需要替换的片段。
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      例如：「帮我把视频第 10 秒到第 20 秒的片段替换成新的素材」
                    </p>
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleEdit}
                  disabled={processing || !video}
                  className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white font-medium transition-all text-sm bg-gradient-to-r from-purple-500 to-pink-500 hover:shadow-lg disabled:opacity-50`}
                >
                  {processing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      处理中...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" />
                      开始 {MODE_META[mode].label}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 任务进度 / 结果 */}
            {task && (
              <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-purple-500" />
                  任务状态
                </h2>

                {/* 进度条 */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">
                      {task.status === 'processing' ? '处理中' : task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败' : '等待中'}
                    </span>
                    <span className="text-sm text-gray-500">{task.progress}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${task.status === 'completed' ? 'bg-green-500' : task.status === 'failed' ? 'bg-red-500' : 'bg-purple-500'}`}
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                </div>

                {/* 操作列表 */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {task.operations.map((op, i) => (
                    <span key={i} className="px-2 py-1 bg-purple-100 text-purple-700 rounded-lg text-xs font-medium">
                      {op}
                    </span>
                  ))}
                </div>

                {/* 结果 */}
                {task.result && (
                  <div className="p-4 bg-green-50 rounded-xl">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle className="w-5 h-5 text-green-500" />
                      <span className="font-semibold text-green-700">剪辑完成</span>
                    </div>

                    <div className="bg-black rounded-lg overflow-hidden aspect-video mb-3">
                      <video src={task.result.outputUrl} controls className="w-full h-full object-contain" />
                    </div>

                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span>时长: {formatTime(task.result.duration)}</span>
                      <span>大小: {formatSize(task.result.fileSize)}</span>
                      <a
                        href={task.result.outputUrl}
                        download
                        className="flex items-center gap-1 text-purple-600 hover:text-purple-700"
                      >
                        <Download className="w-4 h-4" />
                        下载
                      </a>
                    </div>

                    {/* 字幕列表 */}
                    {task.result.subtitles && task.result.subtitles.length > 0 && (
                      <div className="mt-4">
                        <h3 className="text-sm font-semibold text-gray-700 mb-2">生成字幕</h3>
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {task.result.subtitles.slice(0, 20).map((sub, i) => (
                            <div key={i} className="flex gap-2 text-xs text-gray-600">
                              <span className="text-gray-400 flex-shrink-0">{formatTime(sub.start)}</span>
                              <span>{sub.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 场景列表 */}
                    {task.result.scenes && task.result.scenes.length > 0 && (
                      <div className="mt-4">
                        <h3 className="text-sm font-semibold text-gray-700 mb-2">检测场景</h3>
                        <div className="space-y-1">
                          {task.result.scenes.map((scene) => (
                            <div key={scene.index} className="flex items-center gap-2 text-xs text-gray-600 p-2 bg-white rounded-lg">
                              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">#{scene.index}</span>
                              <span className="text-gray-400">{formatTime(scene.startTime)} - {formatTime(scene.endTime)}</span>
                              <span className="flex-1">{scene.description}</span>
                              <span className="text-gray-400">{Math.round(scene.confidence * 100)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {task.status === 'failed' && task.error && (
                  <div className="p-4 bg-red-50 rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-red-700 text-sm">处理失败</p>
                      <p className="text-red-600 text-sm mt-0.5">{task.error}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* 双方案说明 */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            双方案架构
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="p-3 bg-blue-50 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <Cpu className="w-4 h-4 text-blue-600" />
                <span className="font-semibold text-blue-800">方案一：云端 AI（优先）</span>
              </div>
              <p className="text-xs text-blue-600">使用大模型 API 进行智能场景检测、语音识别、文字转语音。处理效果最优，需配置 API Key。</p>
            </div>
            <div className="p-3 bg-green-50 rounded-xl">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-4 h-4 text-green-600" />
                <span className="font-semibold text-green-800">方案二：本地插件（回退）</span>
              </div>
              <p className="text-xs text-green-600">云端不可用时自动切换到本地 FFmpeg + Whisper + Edge-TTS，无需联网，免费使用。</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}