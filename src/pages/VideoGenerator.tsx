import { useState, useEffect, useRef } from 'react';
import Navbar from '@/components/Navbar';
import { Video, Sparkles, Download, RefreshCw, History, Trash2, Play, AlertCircle, Loader2, Film, X, Plus, Upload, Brain, CheckCircle, AlertTriangle } from 'lucide-react';

const STYLES = [
  { id: 'realistic', name: '写实风格' },
  { id: 'anime', name: '动漫风格' },
  { id: 'cinematic', name: '电影质感' },
  { id: 'abstract', name: '抽象艺术' },
  { id: 'fantasy', name: '奇幻风格' },
  { id: 'sci-fi', name: '科幻风格' },
];

const DURATIONS = [
  { id: '5', name: '5秒' },
  { id: '10', name: '10秒' },
  { id: '15', name: '15秒' },
  { id: '18', name: '18秒' },
  { id: '30', name: '30秒' },
  { id: '36', name: '36秒' },
  { id: '45', name: '45秒' },
  { id: '60', name: '1分钟' },
  { id: '75', name: '1分15秒' },
  { id: '90', name: '1分30秒' },
];

const RATE_LIMIT_SECONDS = 60;

interface VideoHistoryItem {
  id: string;
  prompt: string;
  style: string;
  duration: string;
  videoUrl: string;
  createdAt: string;
}

interface PendingTask {
  taskId: string;
  prompt: string;
  style: string;
  duration: string;
  createdAt: string;
}

const styleNameMap: Record<string, string> = {
  realistic: '写实风格',
  anime: '动漫风格',
  cinematic: '电影质感',
  abstract: '抽象艺术',
  fantasy: '奇幻风格',
  'sci-fi': '科幻风格',
};

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function VideoGenerator() {
  const [prompt, setPrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('realistic');
  const [selectedDuration, setSelectedDuration] = useState('10');
  const [generatedVideo, setGeneratedVideo] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [lastGenerateTime, setLastGenerateTime] = useState<number>(0);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [history, setHistory] = useState<VideoHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [selectedHistoryVideo, setSelectedHistoryVideo] = useState<VideoHistoryItem | null>(null);
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);
  const [showPendingDialog, setShowPendingDialog] = useState(false);
  const [checkingTaskId, setCheckingTaskId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'generate' | null>(null);
  // 视频拼接相关状态
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<string[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergedVideo, setMergedVideo] = useState<string | null>(null);
  // 本地上传视频列表：用于拼接时添加本地视频
  const [uploadedVideos, setUploadedVideos] = useState<{ url: string; name: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 视频生成引擎：'agnes'（第三方API）'ltx'（本地）'cogvideox'（智谱免费）'wanx-video'（通义万相）
  const [engine, setEngine] = useState<'agnes' | 'ltx' | 'cogvideox' | 'wanx-video' | 'seedance'>('cogvideox');
  // LTX 本地模型选择
  const [ltxModel, setLtxModel] = useState('ltxv-2b-distilled');
  // LTX 服务状态
  const [ltxStatus, setLtxStatus] = useState<{ available: boolean; gpuName?: string; ltxVideoInstalled?: boolean } | null>(null);
  // 多模态：上传多张参考图片
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  // 分镜头模式
  const [storyboardMode, setStoryboardMode] = useState(false);
  const [storyboardScenes, setStoryboardScenes] = useState<Array<{ prompt: string; description: string; duration: number }>>([
    { prompt: '', description: '开场', duration: 10 },
    { prompt: '', description: '发展', duration: 10 },
    { prompt: '', description: '高潮', duration: 10 },
    { prompt: '', description: '结尾', duration: 10 },
  ]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const multiImageInputRef = useRef<HTMLInputElement>(null);
  // 分镜检测结果
  const [storyboardDetectResult, setStoryboardDetectResult] = useState<{
    detected: boolean; loading: boolean; confidence?: number; warnings?: string[]; suggestions?: string[]; summary?: string;
  }>({ detected: false, loading: false });
  // useRef 跟踪 isGenerating 最新值，避免 setTimeout 闭包中读到过时状态
  const isGeneratingRef = useRef(false);
  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  const fetchHistory = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch('/api/video/history', { headers });
      const result = await response.json();
      if (result.success) {
        setHistory(result.history);
      }
    } catch (error) {
      console.error('获取视频历史记录失败:', error);
    }
  };

  const fetchPendingTasks = async (): Promise<PendingTask[]> => {
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      // 先清理过期任务
      await fetch('/api/video/pending/clean', { method: 'POST', headers }).catch(() => {});
      const response = await fetch('/api/video/pending', { headers });
      const result = await response.json();
      if (result.success) {
        setPendingTasks(result.tasks);
        return result.tasks;
      }
    } catch (error) {
      console.error('获取未完成任务失败:', error);
    }
    return [];
  };

  useEffect(() => {
    fetchHistory();
    fetchPendingTasks();
  }, []);

  // 检查 LTX 本地服务状态
  useEffect(() => {
    const checkLtx = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const response = await fetch('/api/ltx/health', { headers });
        const result = await response.json();
        setLtxStatus({
          available: result.available,
          gpuName: result.gpuName,
          ltxVideoInstalled: result.ltxVideoInstalled,
        });
      } catch {
        setLtxStatus({ available: false });
      }
    };
    checkLtx();
  }, []);

  useEffect(() => {
    const now = Date.now();
    const elapsed = (now - lastGenerateTime) / 1000;
    const remaining = Math.max(0, RATE_LIMIT_SECONDS - elapsed);

    if (remaining > 0) {
      setWaitSeconds(Math.ceil(remaining));
      const timer = setInterval(() => {
        setWaitSeconds(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [lastGenerateTime]);

  // 上传多张参考图片
  async function handleMultiImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setIsUploadingImage(true);
    const newUrls: string[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const formData = new FormData();
      formData.append('image', file);
      try {
        const token = localStorage.getItem('auth_token');
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const response = await fetch('/api/upload/image', { method: 'POST', body: formData, headers });
        const result = await response.json();
        if (result.success) newUrls.push(result.imageUrl);
      } catch {}
    }
    if (newUrls.length > 0) {
      setReferenceImages(prev => [...prev, ...newUrls].slice(0, 5));
    }
    setIsUploadingImage(false);
    if (multiImageInputRef.current) multiImageInputRef.current.value = '';
  }

  function removeReferenceImage(index: number) {
    setReferenceImages(prev => prev.filter((_, i) => i !== index));
  }
  function clearReferenceImages() {
    setReferenceImages([]);
  }

  // 解析粘贴的分镜脚本文本（前端正则 + 后端AI双重判断）
  async function parseStoryboardText(text: string) {
    const lines = text.split('\n').filter(l => l.trim());

    // 前端正则快速解析
    const sceneRegex = /^(\d+)[\.\)、\s:：-]+(.+)/;
    const namedRegex = /^场景\s*(\d+)[：:\s-]*(.+)/;
    const markdownRegex = /^##?\s*(\d+)[\s\.]+(.+)/;
    const scenes: typeof storyboardScenes = [];

    for (const line of lines) {
      const trimmed = line.trim();
      let desc = '';
      let duration = 10;
      const durMatch = trimmed.match(/(\d+)\s*秒|(\d+)\s*s\b/i);
      if (durMatch) { const d = parseInt(durMatch[1] || durMatch[2]); duration = Math.min(Math.max(d, 5), 15); }

      const match = trimmed.match(sceneRegex) || trimmed.match(namedRegex) || trimmed.match(markdownRegex);
      if (match) {
        desc = (match[2] || '').replace(/\d+\s*秒|\d+\s*s\b/gi, '').trim();
        scenes.push({ prompt: desc.substring(0, 200), description: `场景${scenes.length + 1}: ${desc.substring(0, 20)}`, duration });
      } else if (trimmed.length > 10) {
        desc = trimmed.replace(/\d+\s*秒|\d+\s*s\b/gi, '').trim();
        scenes.push({ prompt: desc.substring(0, 200), description: `场景${scenes.length + 1}`, duration });
      }
    }

    if (scenes.length >= 2) {
      setStoryboardScenes(scenes);
      setStoryboardMode(true);
    } else if (scenes.length === 1) {
      setStoryboardScenes([...scenes, { prompt: '', description: '结尾', duration: 10 }]);
      setStoryboardMode(true);
    }

    // 后端 AI 深度检测
    setStoryboardDetectResult({ detected: false, loading: true });
    try {
      const resp = await fetch('/api/storyboard/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await resp.json();
      if (data.success && data.result) {
        const r = data.result;
        setStoryboardDetectResult({
          detected: r.isStoryboard,
          loading: false,
          confidence: r.confidence,
          warnings: r.warnings,
          suggestions: r.suggestions,
          summary: r.summary,
        });
        // AI 解析的场景比前端正则更好，替换
        if (r.scenes && r.scenes.length >= 2) {
          setStoryboardScenes(r.scenes.map((s: any) => ({
            prompt: s.prompt || '',
            description: s.description || `场景${s.index}`,
            duration: s.duration || 10,
          })));
          setStoryboardMode(true);
        }
      }
    } catch {
      setStoryboardDetectResult({ detected: false, loading: false });
    }
  }

  const doGenerate = async () => {
    setIsGenerating(true);
    setError('');
    setGeneratedVideo(null);
    setProgress(0);
    setLastGenerateTime(Date.now());

    let succeeded = false;
    try {
      // 根据引擎和模式选择 API 端点
      const isLtx = engine === 'ltx';
      const isFree = engine === 'cogvideox' || engine === 'wanx-video' || engine === 'seedance';

      // 自动检测：非分镜模式下，如果 prompt 像分镜脚本，AI 判断
      if (!storyboardMode && isFree && prompt.trim().length > 30) {
        try {
          const detectResp = await fetch('/api/storyboard/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: prompt }),
          });
          const detectData = await detectResp.json();
          if (detectData.success && detectData.result?.isStoryboard && detectData.result.scenes?.length >= 2) {
            console.log('[AutoDetect] 发现分镜脚本，自动切换到分镜模式');
            setStoryboardScenes(detectData.result.scenes.map((s: any) => ({
              prompt: s.prompt || '',
              description: s.description || `场景${s.index}`,
              duration: s.duration || 10,
            })));
            setStoryboardMode(true);
            setStoryboardDetectResult({
              detected: true, loading: false,
              confidence: detectData.result.confidence,
              summary: detectData.result.summary,
              warnings: detectData.result.warnings,
              suggestions: detectData.result.suggestions,
            });
            // 直接用新的 scenes 继续
            const scenes = detectData.result.scenes.map((s: any) => ({ prompt: s.prompt?.trim() || '', description: s.description, duration: s.duration || 10 }));
            const apiUrl = '/api/video/storyboard';
            const requestBody = { scenes, style: selectedStyle, ...(referenceImages.length > 0 && { imageUrl: referenceImages[0] }) };
            const token = localStorage.getItem('auth_token');
            const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
            if (token) hdrs['Authorization'] = `Bearer ${token}`;
            const response = await fetch(apiUrl, { method: 'POST', headers: hdrs, body: JSON.stringify(requestBody) });
            const data = await response.json();
            if (data.success && data.taskId) {
              setTaskId(data.taskId);
              setGeneratedVideo({ url: '', taskId: data.taskId, status: 'processing' });
              pollVideoStatus(data.taskId, engine);
            } else { setError(data.error || '分镜头任务创建失败'); setIsGenerating(false); }
            return;
          }
        } catch { /* 检测失败，继续普通流程 */ }
      }

      // 分镜头模式：使用 /api/video/storyboard
      if (storyboardMode && isFree) {
        const scenes = storyboardScenes
          .filter(s => s.prompt.trim())
          .map(s => ({ prompt: s.prompt.trim(), description: s.description, duration: s.duration }));
        if (scenes.length < 2) { setError('分镜头模式至少需要 2 个场景'); setIsGenerating(false); return; }
        const apiUrl = '/api/video/storyboard';
        const requestBody = { scenes, style: selectedStyle, ...(referenceImages.length > 0 && { imageUrl: referenceImages[0] }) };
        const token2 = localStorage.getItem('auth_token');
        const hdrs2: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token2) hdrs2['Authorization'] = `Bearer ${token2}`;
        const response = await fetch(apiUrl, { method: 'POST', headers: hdrs2, body: JSON.stringify(requestBody) });
        const data = await response.json();
        if (data.success && data.taskId) {
          setTaskId(data.taskId);
          setGeneratedVideo({ url: '', taskId: data.taskId, status: 'processing' });
          pollVideoStatus(data.taskId, engine);
        } else {
          setError(data.error || '分镜头任务创建失败');
          setIsGenerating(false);
        }
        return;
      }

      let apiUrl = isLtx ? '/api/ltx/generate' : isFree ? '/api/video/free' : '/api/video';
      
      let requestBody: any;
      if (isLtx) {
        requestBody = { prompt: prompt.trim(), style: selectedStyle, duration: selectedDuration, model: ltxModel };
      } else if (isFree) {
        requestBody = { 
          prompt: prompt.trim(), 
          model: engine, 
          duration: parseInt(selectedDuration) || 5, 
          style: selectedStyle,
          ...(referenceImages.length > 0 && { imageUrls: referenceImages }),
        };
      } else {
        requestBody = { prompt: prompt.trim(), style: selectedStyle, duration: selectedDuration };
      }

      const engineNames: Record<string, string> = { ltx: 'LTX local', cogvideox: 'CogVideoX-Flash(免费)', 'wanx-video': '万相视频(免费)', seedance: 'Seedance 2.0', agnes: 'Agnes API' };
      console.log(`VideoGenerator: Starting ${engineNames[engine] || engine} video generation...`);
      const token3 = localStorage.getItem('auth_token');
      const hdrs3: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token3) hdrs3['Authorization'] = `Bearer ${token3}`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: hdrs3,
        body: JSON.stringify(requestBody),
        cache: 'no-cache',
      });

      console.log('VideoGenerator: Response status:', response.status, response.statusText);

      const text = await response.text();
      console.log('VideoGenerator: Response text length:', text?.length, 'first 100 chars:', text?.substring(0, 100));

      if (!text) {
        setError('视频生成失败：服务器返回空响应，请稍后重试');
        return;
      }

      let result;
      try {
        result = JSON.parse(text);
        console.log('VideoGenerator: Parsed result:', result.success, result.taskId);
      } catch (e) {
        console.error('VideoGenerator: JSON parse error:', e);
        setError('视频生成失败：服务器响应格式异常');
        return;
      }

      if (result.success && result.taskId) {
        await pollVideoStatus(result.taskId, engine);
        succeeded = true;
      } else {
        const errorMsg = result.error || '视频生成失败';
        setError(errorMsg);
        if (errorMsg.includes('rate limit') || errorMsg.includes('频率限制')) {
          setLastGenerateTime(Date.now());
        }
        if (errorMsg.includes('queue is full') || errorMsg.includes('队列繁忙')) {
          setTimeout(() => {
            // 使用 ref 检查最新状态，避免过时闭包导致无限重试
            if (!isGeneratingRef.current) {
              doGenerate();
            }
          }, 5000);
        }
      }
    } catch (error) {
      setError(`视频生成异常: ${(error as Error).message}`);
    } finally {
      setIsGenerating(false);
      // 仅在非成功情况下重置进度，避免覆盖成功后的 100%
      if (!succeeded) {
        setProgress(0);
      }
    }
  };

  const pollVideoStatus = async (taskId: string, currentEngine: 'agnes' | 'ltx' | 'cogvideox' | 'wanx-video' | 'seedance' = 'seedance') => {
    const isSplitVideo = taskId.startsWith('split_') || taskId.startsWith('seedance-split-');
    const isMergeVideo = taskId.startsWith('merge_');
    const isLtx = currentEngine === 'ltx' || taskId.startsWith('ltx_');
    const isFree = currentEngine === 'cogvideox' || currentEngine === 'wanx-video' || currentEngine === 'seedance';
    const isFallback = taskId.startsWith('zhipu-fallback-') || taskId.startsWith('wanx-fallback-');

    // 优化轮询策略：后端已在后台轮询，前端只需查询持久化的进度
    // 自适应间隔：前30次每3秒（快速响应），之后每6秒（减少请求）
    const MAX_POLLS = (isSplitVideo || isMergeVideo)
      ? 200   // 拆分任务最多 200 次 ≈ 18 分钟（原来 360 次/30 分钟）
      : (isFree || isFallback)
        ? 120   // 免费/降级任务 120 次 ≈ 10 分钟
        : 80;    // 普通任务 80 次 ≈ 7 分钟（后端已后台轮询）
    const FAST_POLL_COUNT = 30;  // 前 30 次快速轮询
    const FAST_INTERVAL = isFree ? 3000 : 3000;   // 3 秒
    const SLOW_INTERVAL = 6000;  // 6 秒
    // 根据引擎选择不同的状态查询 URL
    let statusUrl: string;
    if (isLtx) {
      statusUrl = `/api/ltx/status/${taskId}`;
    } else if (isFree) {
      statusUrl = `/api/video/free/status/${taskId}?model=${currentEngine}`;
    } else {
      statusUrl = `/api/video/pending/${taskId}/status`;
    }

    for (let i = 0; i < MAX_POLLS; i++) {
      try {
        const token4 = localStorage.getItem('auth_token');
        const hdrs4: Record<string, string> = {};
        if (token4) hdrs4['Authorization'] = `Bearer ${token4}`;
        const response = await fetch(statusUrl, { headers: hdrs4 });
        const responseText = await response.text();

        let result;
        try {
          result = responseText ? JSON.parse(responseText) : {};
        } catch {
          console.error('轮询视频状态: 响应格式异常', responseText?.substring(0, 100));
          await new Promise(resolve => setTimeout(resolve, SLOW_INTERVAL));
          continue;
        }

        if (result.success && result.videoUrl) {
          setProgress(100);
          setGeneratedVideo(result.videoUrl);
          fetchHistory();
          return;
        }

        if (result.status === 'failed' || result.status === 'FAILED' || result.status === 'cancelled') {
          setError(result.error || '视频生成失败');
          return;
        }

        // 使用后端真实进度（后端后台轮询会更新进度）
        if (result.progress !== undefined && result.progress > 0) {
          setProgress(Math.min(result.progress, 95));
        } else {
          // 仅在无真实进度时使用估算值，但步长更小避免虚假感知
          setProgress(Math.min(15 + (i * 0.15), 85));
        }

        const interval = i < FAST_POLL_COUNT ? FAST_INTERVAL : SLOW_INTERVAL;
        await new Promise(resolve => setTimeout(resolve, interval));
      } catch (error) {
        console.error('轮询视频状态失败:', error);
        await new Promise(resolve => setTimeout(resolve, SLOW_INTERVAL));
      }
    }

    setError(isSplitVideo
      ? '视频拆分生成超时，请稍后在视频历史中查看'
      : isMergeVideo
        ? '视频拼接超时，请稍后在视频历史中查看'
        : (isFree
            ? '视频正在后台生成中（Seedance 需 3-8 分钟），完成后自动出现在视频历史'
            : '视频生成超时，请稍后在视频历史中查看'));
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating || waitSeconds > 0) return;

    const tasks = await fetchPendingTasks();
    if (tasks.length > 0) {
      setPendingAction('generate');
      setShowPendingDialog(true);
      return;
    }

    doGenerate();
  };

  const handleCheckTaskStatus = async (taskId: string) => {
    setCheckingTaskId(taskId);
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(`/api/video/pending/${taskId}/status`, { headers });
      const result = await response.json();

      if (result.success && result.videoUrl) {
        setGeneratedVideo(result.videoUrl);
        fetchHistory();
        setPendingTasks(prev => prev.filter(t => t.taskId !== taskId));
        setShowPendingDialog(false);
        setPendingAction(null);
      } else if (result.status === 'failed' || result.status === 'FAILED') {
        alert(`任务失败: ${result.error || '未知错误'}`);
        setPendingTasks(prev => prev.filter(t => t.taskId !== taskId));
      } else {
        alert(`任务仍在进行中: ${result.status || 'processing'}${result.progress ? ` (${result.progress}%)` : ''}`);
      }
    } catch (error) {
      console.error('检查任务状态失败:', error);
      alert('检查任务状态失败');
    } finally {
      setCheckingTaskId(null);
    }
  };

  const handleAbandonTask = async (taskId: string) => {
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      // 先标记为失败，再删除
      await fetch(`/api/video/pending/${taskId}/status`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'failed' }),
      }).catch(() => {});
      await fetch(`/api/video/pending/${taskId}`, { method: 'DELETE', headers });
      setPendingTasks(prev => prev.filter(t => t.taskId !== taskId));
    } catch (error) {
      console.error('放弃任务失败:', error);
    }
  };

  const handleAbandonAndGenerate = async () => {
    for (const task of pendingTasks) {
      await handleAbandonTask(task.taskId);
    }
    setPendingTasks([]);
    setShowPendingDialog(false);
    doGenerate();
  };

  const handleDownload = (videoUrl: string) => {
    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = `ai-video-${Date.now()}.mp4`;
    link.click();
  };

  const handleDelete = async (id: string) => {
    if (deletingIds.has(id)) return;
    if (!confirm('确定要删除这条视频记录吗？')) return;

    setDeletingIds(prev => new Set(prev).add(id));
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch(`/api/video/history/${id}`, {
        method: 'DELETE',
        headers,
      });
      const result = await response.json();
      if (result.success) {
        setHistory(prev => prev.filter(item => item.id !== id));
        if (selectedHistoryVideo?.id === id) {
          setSelectedHistoryVideo(null);
        }
      }
    } catch (error) {
      console.error('删除视频记录失败:', error);
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleClearHistory = async () => {
    if (!confirm('确定要清空所有视频历史记录吗？此操作不可恢复。')) return;

    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch('/api/video/history', {
        method: 'DELETE',
        headers,
      });
      const result = await response.json();
      if (result.success) {
        setHistory([]);
        setSelectedHistoryVideo(null);
      }
    } catch (error) {
      console.error('清空视频历史记录失败:', error);
    }
  };

  const toggleMergeSelect = (videoUrl: string) => {
    setSelectedForMerge(prev =>
      prev.includes(videoUrl)
        ? prev.filter(url => url !== videoUrl)
        : [...prev, videoUrl]
    );
  };

  // 上传本地视频文件，用于拼接
  const handleUploadVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('video', file);

      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch('/api/upload/video', {
        method: 'POST',
        body: formData,
        headers,
      });

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        setError('视频上传失败：服务器响应格式异常');
        return;
      }

      if (result.success && result.videoUrl) {
        setUploadedVideos(prev => [...prev, { url: result.videoUrl, name: file.name }]);
      } else {
        setError(result.error || '视频上传失败');
      }
    } catch (error) {
      setError(`视频上传异常: ${(error as Error).message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 移除已上传的本地视频
  const handleRemoveUploadedVideo = (url: string) => {
    setUploadedVideos(prev => prev.filter(v => v.url !== url));
    setSelectedForMerge(prev => prev.filter(u => u !== url));
  };

  const handleMergeVideos = async () => {
    if (selectedForMerge.length < 2) return;

    setIsMerging(true);
    setMergeProgress(0);
    setMergedVideo(null);

    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const response = await fetch('/api/video/merge', {
        method: 'POST',
        headers,
        body: JSON.stringify({ videoUrls: selectedForMerge }),
      });

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        setError('视频拼接失败：服务器响应格式异常');
        return;
      }

      if (result.success && result.taskId) {
        // 轮询拼接状态
        const taskId = result.taskId;
        for (let i = 0; i < 120; i++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          try {
            const statusResp = await fetch(`/api/video/pending/${taskId}/status`);
            const statusResult = await statusResp.json();

            if (statusResult.success && statusResult.videoUrl) {
              setMergeProgress(100);
              setMergedVideo(statusResult.videoUrl);
              fetchHistory();
              setMergeMode(false);
              setSelectedForMerge([]);
              return;
            }

            if (statusResult.status === 'failed' || statusResult.status === 'FAILED') {
              setError(statusResult.error || '视频拼接失败');
              return;
            }

            if (statusResult.progress) {
              setMergeProgress(statusResult.progress);
            } else {
              setMergeProgress(Math.min(20 + i * 0.6, 90));
            }
          } catch (err) {
            console.error('轮询拼接状态失败:', err);
          }
        }
        setError('视频拼接超时，请稍后在视频历史中查看');
      } else {
        setError(result.error || '视频拼接失败');
      }
    } catch (error) {
      setError(`视频拼接异常: ${(error as Error).message}`);
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-8 pt-20 space-y-6">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-4">
            <Video className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">AI 视频生成</h1>
          <p className="text-gray-500">输入描述，选择风格和时长，AI 为你创作精彩视频</p>
        </div>

        <div className="flex justify-center gap-3 mb-4 flex-wrap">
          <button
            onClick={() => setShowHistory(false)}
            className={`px-6 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 ${!showHistory
              ? 'bg-blue-500 text-white shadow-md'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
          >
            <Sparkles className="w-4 h-4" />
            生成视频
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className={`px-6 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 ${showHistory && !mergeMode
              ? 'bg-blue-500 text-white shadow-md'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
              }`}
          >
            <History className="w-4 h-4" />
            历史记录
            {history.length > 0 && (
              <span className="bg-white/20 text-xs px-2 py-0.5 rounded-full">
                {history.length}
              </span>
            )}
          </button>
          {(history.length >= 2 || uploadedVideos.length > 0 || mergeMode) && (
            <button
              onClick={() => {
                setMergeMode(!mergeMode);
                setSelectedForMerge([]);
                setShowHistory(true);
                setMergedVideo(null);
              }}
              disabled={isMerging}
              title="选择多个视频进行拼接，支持上传本地视频"
              className={`px-6 py-2.5 rounded-xl font-medium transition-all flex items-center gap-2 ${mergeMode
                ? 'bg-purple-500 text-white shadow-md'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
            >
              <Film className="w-4 h-4" />
              视频拼接
            </button>
          )}
        </div>

        {!showHistory ? (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-500" />
                  视频描述
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述你想要生成的视频内容，例如：一只可爱的小猫在樱花树下追逐蝴蝶，阳光透过树叶洒下斑驳光影..."
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all resize-none"
                  rows={4}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate();
                  }}
                />
                <p className="text-xs text-gray-400">按 Ctrl+Enter 快速生成</p>
              </div>

              {/* 分镜头脚本模式 */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={storyboardMode}
                    onChange={(e) => setStoryboardMode(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">🎬 分镜头脚本模式</span>
                  <span className="text-xs text-gray-400">(逐场景生成 → 自动拼接)</span>
                </label>

                {storyboardMode && (
                  <div className="space-y-2 pl-6 border-l-2 border-blue-200">
                    {/* 粘贴完整分镜脚本 */}
                    <div className="relative">
                      <textarea
                        placeholder={`直接粘贴完整分镜脚本，自动解析为场景...
支持格式：
  1. 开场：夕阳下的海边，广角镜头，暖色调 - 10秒
  2. 发展：情侣牵手漫步，中景跟拍 - 10秒

  场景1-开场：城市夜景，霓虹灯光
  场景2-高潮：天台拥抱，慢镜头

  Opening: Aerial beach shot, golden hour
  Development: Couple walking, tracking shot`}
                        className="w-full px-3 py-2 text-xs border border-dashed border-blue-300 rounded bg-blue-50 resize-none font-mono"
                        rows={4}
                        id="storyboard-paste"
                        onPaste={(e) => {
                          e.preventDefault();
                          const text = e.clipboardData.getData('text');
                          parseStoryboardText(text).catch(() => {});
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            const text = (e.target as HTMLTextAreaElement).value;
                            if (text.trim()) parseStoryboardText(text).catch(() => {});
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          const el = document.getElementById('storyboard-paste') as HTMLTextAreaElement;
                          if (el?.value.trim()) parseStoryboardText(el.value).catch(() => {});
                        }}
                        className="absolute bottom-2 right-2 text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600"
                      >
                        解析
                      </button>
                    </div>
                    {/* AI 分镜判断结果 */}
                    {storyboardDetectResult.loading && (
                      <div className="flex items-center gap-2 text-xs text-blue-500"><Loader2 size={12} className="animate-spin" />AI 正在分析分镜脚本...</div>
                    )}
                    {!storyboardDetectResult.loading && storyboardDetectResult.detected && (
                      <div className="space-y-1 p-2 bg-green-50 border border-green-200 rounded text-xs">
                        <div className="flex items-center gap-1 text-green-700 font-medium"><CheckCircle size={12} />AI 识别为分镜脚本（置信度 {Math.round((storyboardDetectResult.confidence || 0) * 100)}%）</div>
                        {storyboardDetectResult.summary && <div className="text-gray-600">{storyboardDetectResult.summary}</div>}
                        {storyboardDetectResult.warnings?.filter((w: string) => !w.includes('至少需要2个')).slice(0, 3).map((w: string, i: number) => (
                          <div key={i} className="flex items-start gap-1 text-amber-600"><AlertTriangle size={10} className="mt-0.5 shrink-0" /><span>{w.length > 80 ? w.slice(0, 80) + '...' : w}</span></div>
                        ))}
                        {storyboardDetectResult.suggestions?.slice(0, 2).map((s: string, i: number) => (
                          <div key={i} className="flex items-start gap-1 text-blue-600"><Brain size={10} className="mt-0.5 shrink-0" /><span>{s.length > 80 ? s.slice(0, 80) + '...' : s}</span></div>
                        ))}
                      </div>
                    )}
                    {!storyboardDetectResult.loading && !storyboardDetectResult.detected && storyboardDetectResult.confidence !== undefined && (
                      <div className="text-xs text-gray-400 flex items-center gap-1"><AlertCircle size={10} />未识别为分镜脚本，将按普通描述处理</div>
                    )}
                    {storyboardScenes.map((scene, index) => (
                      <div key={index} className="flex gap-2 items-start">
                        <span className="text-xs font-bold text-blue-500 mt-2 w-6">{index + 1}.</span>
                        <input
                          value={scene.description}
                          onChange={(e) => {
                            const next = [...storyboardScenes];
                            next[index].description = e.target.value;
                            setStoryboardScenes(next);
                          }}
                          placeholder="场景名（如：开场/发展/高潮/结尾）"
                          className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded"
                        />
                        <textarea
                          value={scene.prompt}
                          onChange={(e) => {
                            const next = [...storyboardScenes];
                            next[index].prompt = e.target.value;
                            setStoryboardScenes(next);
                          }}
                          placeholder="场景描述..."
                          className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded resize-none"
                          rows={2}
                        />
                        <select
                          value={scene.duration}
                          onChange={(e) => {
                            const next = [...storyboardScenes];
                            next[index].duration = parseInt(e.target.value);
                            setStoryboardScenes(next);
                          }}
                          className="text-xs border border-gray-200 rounded px-1"
                        >
                          <option value={5}>5s</option>
                          <option value={10}>10s</option>
                          <option value={15}>15s</option>
                        </select>
                        <button
                          onClick={() => {
                            if (storyboardScenes.length <= 2) return;
                            setStoryboardScenes(prev => prev.filter((_, i) => i !== index));
                          }}
                          className="text-red-400 hover:text-red-600 text-xs mt-1"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setStoryboardScenes(prev => [...prev, { prompt: '', description: `场景 ${prev.length + 1}`, duration: 10 }])}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        + 添加场景
                      </button>
                      <span className="text-xs text-gray-400">
                        共 {storyboardScenes.filter(s => s.prompt.trim()).length} 个有效场景
                        · 预计总时长 {storyboardScenes.reduce((sum, s) => sum + s.duration, 0)}s
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* 生成引擎切换 */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">生成引擎</label>
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    onClick={() => setEngine('agnes')}
                    title="使用 Agnes Video V2.0 第三方API，支持长视频，画质较高"
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${engine === 'agnes'
                      ? 'bg-indigo-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                  >
                    Agnes API（云端）
                  </button>
                  <button
                    onClick={() => setEngine('ltx')}
                    disabled={!ltxStatus?.available}
                    title={ltxStatus?.available
                      ? `使用本地 LTX-Video 模型，生成速度快（GPU: ${ltxStatus.gpuName || '未知'}）`
                      : 'LTX 本地服务未启动，请先部署 ltx-video-server'}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${engine === 'ltx'
                      ? 'bg-emerald-500 text-white shadow-md'
                      : ltxStatus?.available
                        ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                      }`}
                  >
                    LTX 本地模型
                  </button>
                  <button
                    onClick={() => setEngine('cogvideox')}
                    title="智谱 CogVideoX-Flash，完全免费，文生视频/图生视频"
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${engine === 'cogvideox'
                      ? 'bg-blue-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                  >
                    ✨ 智谱免费
                  </button>
                  <button
                    onClick={() => setEngine('wanx-video')}
                    title="通义万相视频生成，新用户50秒免费额度，90天有效"
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${engine === 'wanx-video'
                      ? 'bg-orange-500 text-white shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                  >
                    🎬 万相免费
                  </button>
                  <button
                    onClick={() => setEngine('seedance')}
                    title="Seedance 2.0 — 火山引擎旗舰视频模型，4模态输入，10秒以上长视频"
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${engine === 'seedance'
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                  >
                    🎥 Seedance
                  </button>
                  {ltxStatus && (
                    <span className={`text-xs px-2 py-1 rounded-full ${ltxStatus.available
                      ? (ltxStatus.ltxVideoInstalled ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700')
                      : 'bg-red-100 text-red-600'
                      }`}>
                      {ltxStatus.available
                        ? (ltxStatus.ltxVideoInstalled ? `在线 - ${ltxStatus.gpuName || 'GPU'}` : '服务在线但模型未安装')
                        : '离线'}
                    </span>
                  )}
                </div>
                {engine === 'ltx' && ltxStatus?.available && (
                  <div className="space-y-1.5 mt-2">
                    <label className="text-xs text-gray-500">本地模型选择</label>
                    <select
                      value={ltxModel}
                      onChange={(e) => setLtxModel(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border-2 border-gray-200 focus:border-emerald-400 text-sm"
                    >
                      <option value="ltxv-2b-distilled">LTX 2B 蒸馏版（低显存6GB+，最快）</option>
                      <option value="ltxv-2b-dev">LTX 2B 开发版（低显存8GB+，质量好）</option>
                      <option value="ltxv-13b-distilled">LTX 13B 蒸馏版（10GB+，推荐）</option>
                      <option value="ltxv-13b-distilled-fp8">LTX 13B 蒸馏FP8（8GB+，RTX 4090最佳）</option>
                      <option value="ltxv-13b-dev">LTX 13B 开发版（16GB+，最高质量）</option>
                    </select>
                    <p className="text-xs text-amber-600">本地模型仅支持18秒以内的视频，更长的视频请使用 Agnes API</p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">视频风格</label>
                <div className="flex flex-wrap gap-2">
                  {STYLES.map((style) => (
                    <button
                      key={style.id}
                      onClick={() => setSelectedStyle(style.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${selectedStyle === style.id
                        ? 'bg-blue-500 text-white shadow-md'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                    >
                      {style.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 多模态：参考图片上传 */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  参考图片 <span className="text-xs font-normal text-gray-400">(可选，支持图生视频)</span>
                </label>
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    ref={multiImageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleMultiImageUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => multiImageInputRef.current?.click()}
                    disabled={isUploadingImage}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium text-gray-600 disabled:opacity-50"
                  >
                    {isUploadingImage ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {referenceImages.length > 0 ? '添加更多' : '上传参考图(可多选)'}
                  </button>
                  {referenceImages.length > 0 && (
                    <button onClick={clearReferenceImages} className="text-xs text-red-500 hover:underline">
                      清空全部
                    </button>
                  )}
                </div>
                {referenceImages.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto mt-1">
                    {referenceImages.map((url, i) => (
                      <div key={i} className="relative flex-shrink-0">
                        <img src={url} alt={`参考图 ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border-2 border-blue-300" />
                        <span className="absolute top-0 left-0 w-5 h-5 bg-blue-600 text-white text-xs rounded-tl-lg rounded-br-lg flex items-center justify-center font-semibold">{i + 1}</span>
                        <button onClick={() => removeReferenceImage(i)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
                {referenceImages.length > 0 && !isUploadingImage && (
                  <p className="text-xs text-green-600">✅ {referenceImages.length} 张参考图，将以多图+文字生成视频</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">视频时长</label>
                <div className="flex flex-wrap gap-2">
                  {DURATIONS.map((duration) => {
                    const isDisabled = engine === 'ltx' && parseInt(duration.id) > 18;
                    return (
                      <button
                        key={duration.id}
                        onClick={() => setSelectedDuration(duration.id)}
                        disabled={isDisabled}
                        title={isDisabled ? '本地模型仅支持18秒以内' : ''}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selectedDuration === duration.id
                          ? 'bg-purple-500 text-white shadow-md'
                          : isDisabled
                            ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                      >
                        {duration.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim() || waitSeconds > 0}
                className={`w-full py-4 rounded-xl font-semibold text-white transition-all flex items-center justify-center gap-2 ${isGenerating || !prompt.trim() || waitSeconds > 0
                  ? 'bg-gray-300 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:shadow-lg hover:scale-[1.01]'
                  }`}
              >
                {waitSeconds > 0 ? (
                  <>
                    <RefreshCw className="w-5 h-5" />
                    请等待 {waitSeconds} 秒后再生成
                  </>
                ) : isGenerating ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    AI 正在创作视频中... ({Math.round(progress)}%)
                  </>
                ) : (
                  <>
                    <Video className="w-5 h-5" />
                    一键生成视频
                  </>
                )}
              </button>

              {isGenerating && (
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}

              {error && (
                <div className="px-4 py-3 bg-red-50 text-red-600 rounded-xl text-sm">
                  {error}
                </div>
              )}
            </div>

            {generatedVideo && (
              <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <Video className="w-5 h-5 text-blue-500" />
                  生成结果
                </h2>

                <div className="rounded-xl overflow-hidden bg-gray-900 aspect-video">
                  <video
                    src={generatedVideo}
                    controls
                    autoPlay
                    className="w-full h-full"
                  />
                </div>

                <div className="p-4 bg-gray-50 rounded-xl">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">视频描述</span>
                    <span className="text-gray-400">时长: {selectedDuration}秒</span>
                  </div>
                  <p className="text-gray-700 mt-1">{prompt}</p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => handleDownload(generatedVideo)}
                    className="flex-1 py-3 bg-blue-500 text-white rounded-xl flex items-center justify-center gap-2 hover:bg-blue-600 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    下载视频
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="flex-1 py-3 text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} />
                    重新生成
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* 拼接模式操作栏 */}
            {mergeMode && (
              <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Film className="w-5 h-5 text-purple-600" />
                    <span className="font-medium text-purple-700">
                      视频拼接模式 - 已选择 {selectedForMerge.length} 个视频
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setMergeMode(false);
                      setSelectedForMerge([]);
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-xs text-purple-600">
                  点击下方视频卡片选择要拼接的视频（至少选2个），拼接顺序按选择顺序。也支持上传本地视频参与拼接。
                </p>

                {/* 本地视频上传区域 */}
                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/x-msvideo,video/webm"
                    onChange={handleUploadVideo}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || isMerging}
                    className="flex-1 py-2.5 border-2 border-dashed border-purple-300 text-purple-600 rounded-xl text-sm font-medium hover:bg-purple-100 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        上传中...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        上传本地视频
                      </>
                    )}
                  </button>
                </div>

                {/* 已上传的本地视频列表 */}
                {uploadedVideos.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-purple-600">已上传的本地视频：</p>
                    {uploadedVideos.map((v) => (
                      <div
                        key={v.url}
                        className={`flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer ${
                          selectedForMerge.includes(v.url)
                            ? 'bg-purple-100 border-purple-400'
                            : 'bg-white border-purple-200 hover:border-purple-300'
                        }`}
                        onClick={() => toggleMergeSelect(v.url)}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Video className="w-4 h-4 text-purple-500 flex-shrink-0" />
                          <span className="text-sm text-gray-700 truncate">{v.name}</span>
                          {selectedForMerge.includes(v.url) && (
                            <span className="text-xs text-purple-600 flex-shrink-0">✓ 已选</span>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveUploadedVideo(v.url);
                          }}
                          className="text-gray-400 hover:text-red-500 flex-shrink-0 ml-2"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {isMerging && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-purple-700">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      正在拼接视频... {Math.round(mergeProgress)}%
                    </div>
                    <div className="w-full bg-purple-200 rounded-full h-2">
                      <div
                        className="bg-purple-500 h-2 rounded-full transition-all"
                        style={{ width: `${mergeProgress}%` }}
                      />
                    </div>
                  </div>
                )}
                {!isMerging && selectedForMerge.length >= 2 && (
                  <button
                    onClick={handleMergeVideos}
                    className="w-full py-3 bg-purple-500 text-white rounded-xl font-medium hover:bg-purple-600 transition-all flex items-center justify-center gap-2"
                  >
                    <Film className="w-4 h-4" />
                    开始拼接 {selectedForMerge.length} 个视频
                  </button>
                )}
              </div>
            )}

            {/* 拼接结果展示 */}
            {mergedVideo && (
              <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <Film className="w-5 h-5 text-purple-500" />
                  拼接结果
                </h2>
                <div className="rounded-xl overflow-hidden bg-gray-900 aspect-video">
                  <video src={mergedVideo} controls autoPlay className="w-full h-full" />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleDownload(mergedVideo)}
                    className="flex-1 py-3 bg-purple-500 text-white rounded-xl flex items-center justify-center gap-2 hover:bg-purple-600 transition-all"
                  >
                    <Download className="w-4 h-4" />
                    下载视频
                  </button>
                  <button
                    onClick={() => setMergedVideo(null)}
                    className="flex-1 py-3 text-purple-600 border border-purple-200 hover:bg-purple-50 rounded-xl flex items-center justify-center gap-2 transition-all"
                  >
                    关闭
                  </button>
                </div>
              </div>
            )}

            {history.length > 0 && !mergeMode && (
              <div className="flex justify-end">
                <button
                  onClick={handleClearHistory}
                  className="px-4 py-2 text-red-500 hover:bg-red-50 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  清空历史
                </button>
              </div>
            )}

            {history.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <History className="w-10 h-10 text-gray-300" />
                </div>
                <h3 className="text-lg font-medium text-gray-600 mb-2">暂无视频历史记录</h3>
                <p className="text-gray-400 text-sm">生成的视频会自动保存在这里</p>
                <button
                  onClick={() => setShowHistory(false)}
                  className="mt-6 px-6 py-2.5 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 transition-all"
                >
                  去生成视频
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {history.map((item, index) => {
                  const isSelected = selectedForMerge.includes(item.videoUrl);
                  return (
                  <div
                    key={item.id}
                    className={`bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-all group ${mergeMode && isSelected ? 'ring-2 ring-purple-500' : ''}`}
                  >
                    <div
                      className="aspect-video bg-gray-900 relative cursor-pointer overflow-hidden"
                      onClick={() => mergeMode ? toggleMergeSelect(item.videoUrl) : setSelectedHistoryVideo(item)}
                    >
                      <video
                        src={item.videoUrl}
                        className="w-full h-full object-cover"
                        muted
                        preload="metadata"
                      />
                      {mergeMode ? (
                        <div className={`absolute inset-0 flex items-center justify-center transition-all ${isSelected ? 'bg-purple-500/40' : 'bg-black/30 opacity-0 group-hover:opacity-100'}`}>
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isSelected ? 'bg-purple-500' : 'bg-white/90'}`}>
                            {isSelected ? (
                              <span className="text-white font-bold">{selectedForMerge.indexOf(item.videoUrl) + 1}</span>
                            ) : (
                              <Plus className="w-6 h-6 text-gray-800" />
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="w-14 h-14 bg-white/90 rounded-full flex items-center justify-center">
                            <Play className="w-6 h-6 text-gray-800 ml-1" />
                          </div>
                        </div>
                      )}
                      <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                        {item.duration}秒
                      </div>
                    </div>

                    <div className="p-4 space-y-3">
                      <p className="text-sm text-gray-700 line-clamp-2 min-h-[40px]">
                        {item.prompt}
                      </p>

                      <div className="flex items-center justify-between text-xs">
                        <div className="flex gap-2">
                          <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded">
                            {styleNameMap[item.style] || item.style}
                          </span>
                        </div>
                        <span className="text-gray-400">
                          {formatDate(item.createdAt)}
                        </span>
                      </div>

                      {!mergeMode && (
                        <div className="flex gap-2 pt-2 border-t border-gray-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedHistoryVideo(item);
                            }}
                            className="flex-1 py-2 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg font-medium transition-all flex items-center justify-center gap-1"
                          >
                            <Play className="w-3 h-3" />
                            播放
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(item.videoUrl);
                            }}
                            className="flex-1 py-2 text-xs text-green-600 bg-green-50 hover:bg-green-100 rounded-lg font-medium transition-all flex items-center justify-center gap-1"
                          >
                            <Download className="w-3 h-3" />
                            下载
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(item.id);
                            }}
                            disabled={deletingIds.has(item.id)}
                            className="py-2 px-3 text-xs text-red-500 bg-red-50 hover:bg-red-100 rounded-lg font-medium transition-all disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {selectedHistoryVideo && (
        <div
          className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedHistoryVideo(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <Video className="w-5 h-5 text-blue-500" />
                  视频详情
                </h3>
                <button
                  onClick={() => setSelectedHistoryVideo(null)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className="rounded-xl overflow-hidden bg-gray-900 aspect-video">
                <video
                  src={selectedHistoryVideo.videoUrl}
                  controls
                  autoPlay
                  className="w-full h-full"
                />
              </div>

              <div className="p-4 bg-gray-50 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">视频描述</span>
                  <span className="text-gray-400">时长: {selectedHistoryVideo.duration}秒</span>
                </div>
                <p className="text-gray-700">{selectedHistoryVideo.prompt}</p>
                <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                  <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs">
                    {styleNameMap[selectedHistoryVideo.style] || selectedHistoryVideo.style}
                  </span>
                  <span className="text-gray-400 text-xs">
                    {formatDate(selectedHistoryVideo.createdAt)}
                  </span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleDownload(selectedHistoryVideo.videoUrl)}
                  className="flex-1 py-3 bg-blue-500 text-white rounded-xl flex items-center justify-center gap-2 hover:bg-blue-600 transition-all"
                >
                  <Download className="w-4 h-4" />
                  下载视频
                </button>
                <button
                  onClick={() => {
                    setPrompt(selectedHistoryVideo.prompt);
                    setSelectedStyle(selectedHistoryVideo.style);
                    setSelectedDuration(selectedHistoryVideo.duration);
                    setSelectedHistoryVideo(null);
                    setShowHistory(false);
                  }}
                  className="flex-1 py-3 text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-xl flex items-center justify-center gap-2 transition-all"
                >
                  <RefreshCw className="w-4 h-4" />
                  使用此参数重新生成
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="text-center py-6 text-sm text-gray-400">
        AI Video Generator · Powered by Agnes Video V2.0
      </footer>

      {showPendingDialog && pendingTasks.length > 0 && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">发现未完成的视频生成任务</h3>
                  <p className="text-sm text-gray-500">请先处理以下任务，再开始新的生成</p>
                </div>
              </div>

              <div className="space-y-3">
                {pendingTasks.map((task) => (
                  <div key={task.taskId} className="border border-gray-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 font-medium line-clamp-2">{task.prompt}</p>
                        <div className="flex items-center gap-2 mt-2 text-xs">
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded">
                            {styleNameMap[task.style] || task.style}
                          </span>
                          <span className="text-gray-400">{task.duration}秒</span>
                          <span className="text-gray-400">{formatDate(task.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleCheckTaskStatus(task.taskId)}
                        disabled={checkingTaskId === task.taskId}
                        className="flex-1 py-2 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg font-medium transition-all flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {checkingTaskId === task.taskId ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            检查中...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-3 h-3" />
                            检查状态
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => handleAbandonTask(task.taskId)}
                        className="flex-1 py-2 text-xs text-red-500 bg-red-50 hover:bg-red-100 rounded-lg font-medium transition-all flex items-center justify-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        放弃任务
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {pendingAction === 'generate' && pendingTasks.length > 0 && (
                <div className="flex gap-3 pt-2 border-t border-gray-100">
                  <button
                    onClick={handleAbandonAndGenerate}
                    className="flex-1 py-2.5 bg-orange-500 text-white rounded-xl font-medium hover:bg-orange-600 transition-all text-sm"
                  >
                    全部放弃并继续生成
                  </button>
                  <button
                    onClick={() => {
                      setShowPendingDialog(false);
                      setPendingAction(null);
                    }}
                    className="flex-1 py-2.5 text-gray-600 border border-gray-200 hover:bg-gray-50 rounded-xl font-medium transition-all text-sm"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
