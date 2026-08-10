import { useState, useEffect, useRef } from 'react';
import { Send, Image, Video, Wand2, Layers, RefreshCw, Trash2, Download, Play, X, Sparkles, Brain, Eye, ChevronDown, ChevronUp, Users, Upload, Plus, StopCircle, Link as LinkIcon } from 'lucide-react';
import ImageUploader from './ImageUploader';
import ChatHistory from './ChatHistory';

/** 获取带认证头的 fetch 选项 */
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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
  actionType?: 'image' | 'video' | 'remove-bg' | 'compose' | 'modify-video' | 'modify-image' | 'general';
  params?: Record<string, any>;
  timestamp: number;
  generatedImage?: string;
  generatedVideo?: string;
  isGenerating?: boolean;
  progress?: number;
  agentThoughts?: AgentThought[];
  sessionId?: string;
  originalPrompt?: string;
  modifyHistory?: { prompt: string; result: string; timestamp: number }[];
  /** 推理模型的 chain-of-thought 思考过程 */
  reasoning?: string;
  /** 使用的模型类型：reasoning | instruction */
  modelUsed?: string;
}

interface AgentThought {
  agentName: string;
  role: string;
  step: number;
  thought: string;
  action?: string;
  output?: string;
  timestamp: number;
}

const STYLE_MAP: Record<string, string> = {
  realistic: '写实',
  anime: '动漫',
  cinematic: '电影',
  abstract: '抽象',
  fantasy: '奇幻',
  'sci-fi': '科幻',
  cute: '可爱',
  cartoon: '卡通',
  ancient: '古风',
  aesthetic: '唯美',
  minimalist: '极简',
  retro: '复古',
  cyberpunk: '赛博朋克',
  vaporwave: '蒸汽波',
  pixel: '像素',
  'hand-drawn': '手绘',
  watercolor: '水彩',
  'oil-painting': '油画',
  sketch: '素描',
};

const DURATION_PATTERNS = [
  { regex: /(\d+)\s*秒/, unit: '秒', multiplier: 1 },
  { regex: /(\d+)\s*秒钟/, unit: '秒', multiplier: 1 },
  { regex: /(\d+)\s*minute/, unit: '分钟', multiplier: 60 },
  { regex: /(\d+)\s*min/, unit: '分钟', multiplier: 60 },
  { regex: /(\d+)\s*mins/, unit: '分钟', multiplier: 60 },
  { regex: /(\d+)\s*分钟/, unit: '分钟', multiplier: 60 },
];

export default function AIAssistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [videoContext, setVideoContext] = useState<{
    prompt: string;
    style: string;
    duration: string;
    videoUrl: string;
  } | null>(null);
  const [imageContext, setImageContext] = useState<{
    prompt: string;
    style: string;
    imageUrl: string;
  } | null>(null);
  const [useMock, setUseMock] = useState(true);
  const [expandedThoughts, setExpandedThoughts] = useState<Set<string>>(new Set());
  const [showUploader, setShowUploader] = useState(false);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [modifyInputId, setModifyInputId] = useState<string | null>(null);
  const [modifyInput, setModifyInput] = useState('');
  const [modifyRefImageUrl, setModifyRefImageUrl] = useState<string | null>(null); // 引用外部图片
  const [refImageUrlInput, setRefImageUrlInput] = useState(''); // 外部图片 URL 输入
  // 会话列表版本号：每次创建/删除会话时递增，触发 ChatHistory 重新加载
  const [sessionListVersion, setSessionListVersion] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  // 跟踪正在进行的任务（图片/视频生成），用于支持终止操作
  const activeTasksRef = useRef<Map<string, AbortController>>(new Map());
  // 映射 messageId → 后端 taskId，用于取消时通知后端
  const taskIdMapRef = useRef<Map<string, string>>(new Map());
  // 未完成任务提示模态框
  const [showPendingModal, setShowPendingModal] = useState(false);
  // 模态框触发模式: 'send' = 新消息触发, 'stop' = 手动停止按钮触发, 'timeout' = 超时自动触发
  const [pendingModalMode, setPendingModalMode] = useState<'send' | 'stop' | 'timeout'>('send');
  // 暂存被拦截的发送内容，待用户处理完未完成任务后继续
  const pendingSendRef = useRef<string | null>(null);
  // 终止任务后的冷却倒计时（秒），>0 时禁止发送
  const [abortCooldown, setAbortCooldown] = useState(0);
  // 用 ref 保持冷却的最新值，避免闭包过期
  const abortCooldownRef = useRef(0);
  // 任务开始时间追踪（messageId → Date.now()），用于超时检测
  const taskStartTimesRef = useRef<Map<string, number>>(new Map());
  // 防重复超时提醒
  const timeoutNoticeShownRef = useRef(false);
  // 消息队列：当前有任务进行时，用户新发送的消息暂存到此队列
  const [messageQueue, setMessageQueue] = useState<Array<{ id: string; text: string; timestamp: number }>>([]);
  // 防止队列重复消费
  const isProcessingQueueRef = useRef(false);
  // 待发送的附件图片（支持多图），发送时与文字一起提交
  const [pendingAttachmentImages, setPendingAttachmentImages] = useState<string[]>([]);
  const multiFileInputRef = useRef<HTMLInputElement>(null);
  // 图片 URL 粘贴输入
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const [urlPreviewError, setUrlPreviewError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    initSession();
  }, []);

  // 组件卸载时清理所有进行中的任务，避免内存泄漏和对已卸载组件 setState
  useEffect(() => {
    return () => {
      activeTasksRef.current.forEach(controller => controller.abort());
      activeTasksRef.current.clear();
    };
  }, []);

  // 终止任务后的冷却倒计时：每秒减 1，到 0 时允许再次发送
  useEffect(() => {
    abortCooldownRef.current = abortCooldown;
    if (abortCooldown <= 0) return;
    const timer = setInterval(() => {
      setAbortCooldown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          const next = 0;
          abortCooldownRef.current = next;
          return next;
        }
        const next = prev - 1;
        abortCooldownRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [abortCooldown]);

  // 超时检测：每 30 秒检查是否有长时间未完成的任务
  useEffect(() => {
    const interval = setInterval(() => {
      if (timeoutNoticeShownRef.current) return;
      const pending = getPendingTasks();
      if (pending.length === 0) {
        timeoutNoticeShownRef.current = false;
        return;
      }

      const now = Date.now();
      // 图片 3 分钟超时 / 视频 8 分钟超时
      const IMAGE_TIMEOUT = 3 * 60 * 1000;
      const VIDEO_TIMEOUT = 8 * 60 * 1000;

      for (const task of pending) {
        const startTime = taskStartTimesRef.current.get(task.id);
        if (!startTime) continue;

        const elapsed = now - startTime;
        const timeout = task.actionType === 'video' ? VIDEO_TIMEOUT : IMAGE_TIMEOUT;

        if (elapsed >= timeout) {
          timeoutNoticeShownRef.current = true;
          pendingSendRef.current = null;
          setPendingModalMode('timeout');
          setShowPendingModal(true);
          break;
        }
      }
    }, 30000); // 每 30 秒检查一次

    return () => clearInterval(interval);
  }, [messages]);

  // 获取所有未完成的生成任务
  function getPendingTasks(): ChatMessage[] {
    return messages.filter(m => {
      if (m.actionType !== 'video' && m.actionType !== 'image') return false
      if (m.isGenerating !== true) return false
      if (m.generatedVideo || m.generatedImage) return false
      if (m.content && (
        m.content.includes('✅') ||
        m.content.includes('❌') ||
        m.content.includes('审核 Agent 已确认') ||
        m.content.includes('视频生成失败') ||
        m.content.includes('图片生成失败')
      )) return false
      return true
    })
  }

  // ===== 审核 Agent 自动巡检：定期检查已完成/失败的任务并清理 =====
  useEffect(() => {
    const staleTasks = messages.filter(m => {
      if (m.actionType !== 'video' && m.actionType !== 'image') return false
      if (m.isGenerating !== true) return false
      return m.generatedVideo || m.generatedImage || (m.content && (
        m.content.includes('✅') ||
        m.content.includes('❌') ||
        m.content.includes('审核 Agent 已确认') ||
        m.content.includes('视频生成失败') ||
        m.content.includes('图片生成失败')
      ))
    })

    if (staleTasks.length === 0) return

    console.log(`[AutoClean] 发现 ${staleTasks.length} 个已完成但未清理的任务，审核Agent自动关闭`)
    staleTasks.forEach(task => {
      activeTasksRef.current.delete(task.id)
      taskStartTimesRef.current.delete(task.id)
    })

    setMessages(prev => prev.map(m => {
      if (staleTasks.find(t => t.id === m.id)) {
        return { ...m, isGenerating: false }
      }
      return m
    }))
  }, [messages])

  // 过滤掉临时 pending 状态的消息（保存到后端时）
  function sanitizeMessagesForPersist(msgs: ChatMessage[]): ChatMessage[] {
    return msgs.map(m => {
      if (m.isGenerating && (m.generatedVideo || m.generatedImage || m.content.includes('✅') || m.content.includes('❌'))) {
        return { ...m, isGenerating: false }
      }
      return m
    })
  }

  // 终止单个任务
  function abortTask(messageId: string) {
    const controller = activeTasksRef.current.get(messageId);
    if (controller) {
      controller.abort();
      activeTasksRef.current.delete(messageId);
      taskStartTimesRef.current.delete(messageId);
    }
    // 通知后端取消后台轮询
    const backendTaskId = taskIdMapRef.current.get(messageId);
    if (backendTaskId) {
      taskIdMapRef.current.delete(messageId);
      fetch(`/api/video/cancel/${backendTaskId}`, { method: 'POST', headers: authHeaders() }).catch(() => {});
    }
    setMessages(prev => {
      const updated = prev.map(m => {
        if (m.id === messageId) {
          return { ...m, isGenerating: false, content: '❌ 任务已被用户终止' };
        }
        return m;
      });
      // 如果是模态框中终止，且已无未完成任务，则关闭模态框并继续发送
      const stillPending = updated.filter(m => m.isGenerating === true && (m.actionType === 'image' || m.actionType === 'video'));
      if (showPendingModal && stillPending.length === 0) {
        setShowPendingModal(false);
        const pendingText = pendingSendRef.current;
        pendingSendRef.current = null;
        if (pendingText) {
          setAbortCooldown(5);
          setMessages(prev2 => [...prev2, {
            id: `abort-${Date.now()}`,
            role: 'assistant',
            content: '⚠️ 已终止全部未完成任务，将在 5 秒后自动发送你的新请求...',
            timestamp: Date.now(),
          }]);
          setTimeout(() => {
            executeSend(pendingText);
          }, 5000);
        }
      }
      return updated;
    });
  }

  // 终止所有未完成任务，并启动 5 秒冷却
  function abortAllPendingTasks() {
    const pending = getPendingTasks();
    pending.forEach(task => {
      const controller = activeTasksRef.current.get(task.id);
      if (controller) {
        controller.abort();
        activeTasksRef.current.delete(task.id);
        taskStartTimesRef.current.delete(task.id);
      }
      // 通知后端取消所有后台轮询
      const backendTaskId = taskIdMapRef.current.get(task.id);
      if (backendTaskId) {
        taskIdMapRef.current.delete(task.id);
        fetch(`/api/video/cancel/${backendTaskId}`, { method: 'POST', headers: authHeaders() }).catch(() => {});
      }
    });
    setMessages(prev => prev.map(m => {
      if (m.isGenerating && (m.actionType === 'image' || m.actionType === 'video')) {
        return { ...m, isGenerating: false, content: '❌ 任务已被用户终止' };
      }
      return m;
    }));
    setShowPendingModal(false);
    setAbortCooldown(5);
  }

  // 估算任务剩余时间（秒）
  function estimateRemainingTime(task: ChatMessage): string {
    if (task.actionType === 'image') {
      return '约 10-30 秒';
    }
    // 视频
    const progress = task.progress || 0;
    if (progress > 0) {
      // 根据进度估算：视频通常需要 60-180 秒
      const totalEstimate = 120;
      const remaining = Math.max(10, Math.round(totalEstimate * (1 - progress / 100)));
      return `约 ${remaining} 秒`;
    }
    return '约 1-3 分钟';
  }

  async function initSession() {
    try {
      const response = await fetch('/api/chat/sessions', { headers: authHeaders() });
      const data = await response.json();
      
      if (data.success && data.sessions.length > 0) {
        const latestSession = data.sessions[0];
        setCurrentSession(latestSession);
        setMessages(latestSession.messages);
      } else {
        await createNewSession();
      }
    } catch {
      await createNewSession();
    }
  }

  async function createNewSession() {
    try {
      const response = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ title: '新会话' }),
      });
      const data = await response.json();
      
      if (data.success) {
        const defaultMessages: ChatMessage[] = [
          {
            id: '1',
            role: 'assistant',
            content: '你好！我是你的 AI 创意助手。我可以帮你完成以下任务：\n\n🎨 **生成图片** - 描述你想要的图片，我来帮你创作\n📹 **生成视频** - 描述视频内容和时长，AI 为你生成\n✨ **智能抠图** - 去除图片背景\n🎭 **图片合成** - 提取主体并合成到新背景\n\n我有多个AI助手协作完成你的需求：\n- 📝 **故事创作专家** - 创作精彩的视频脚本\n- 🎬 **视频制作专家** - 提取视频参数并生成\n- 🎨 **图像创作专家** - 生成高质量图像描述\n\n直接告诉我你的需求吧！',
            timestamp: Date.now(),
          },
        ];

        await fetch(`/api/chat/sessions/${data.session.id}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({ messages: defaultMessages }),
        });

        setCurrentSession({ ...data.session, messages: defaultMessages });
        setMessages(defaultMessages);
        // 递增版本号，通知 ChatHistory 重新加载会话列表
        setSessionListVersion(v => v + 1);
      }
    } catch (error) {
      console.error('Failed to create session:', error);
      initDefaultMessages();
    }
  }

  async function saveMessageToSession(message: ChatMessage) {
    if (!currentSession) return;
    
    try {
      await fetch(`/api/chat/sessions/${currentSession.id}/messages`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(message),
      });
    } catch (error) {
      console.error('Failed to save message:', error);
    }
  }

  async function updateSessionMessages(newMessages: ChatMessage[]) {
    if (!currentSession) return;
    
    try {
      await fetch(`/api/chat/sessions/${currentSession.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ messages: newMessages }),
      });
    } catch (error) {
      console.error('Failed to update session:', error);
    }
  }

  function handleSelectSession(session: ChatSession) {
    setCurrentSession(session);
    setMessages(session.messages);
    setExpandedThoughts(new Set());
  }

  // 当 ChatHistory 中删除会话后回调：刷新列表，若当前会话被删或无会话则自动新建
  async function handleSessionDeleted(deletedId?: string) {
    setSessionListVersion(v => v + 1);

    // 如果删除的不是当前会话，无需额外处理
    if (deletedId && currentSession && currentSession.id !== deletedId) {
      return;
    }

    // 当前会话被删除（或全部删除），尝试加载剩余会话
    try {
      const response = await fetch('/api/chat/sessions', { headers: authHeaders() });
      const data = await response.json();
      if (data.success && data.sessions.length > 0) {
        // 切换到最新的会话
        const latest = data.sessions[0];
        setCurrentSession(latest);
        setMessages(latest.messages || []);
      } else {
        // 没有会话了，创建新会话
        await createNewSession();
      }
    } catch {
      // 加载失败，创建新会话
      await createNewSession();
    }
  }

  function initDefaultMessages() {
    const defaultMessages: ChatMessage[] = [
      {
        id: '1',
        role: 'assistant',
        content: '你好！我是你的 AI 创意助手。我可以帮你完成以下任务：\n\n🎨 **生成图片** - 描述你想要的图片，我来帮你创作\n📹 **生成视频** - 描述视频内容和时长，AI 为你生成\n✨ **智能抠图** - 去除图片背景\n🎭 **图片合成** - 提取主体并合成到新背景\n\n我有多个AI助手协作完成你的需求：\n- 📝 **故事创作专家** - 创作精彩的视频脚本\n- 🎬 **视频制作专家** - 提取视频参数并生成\n- 🎨 **图像创作专家** - 生成高质量图像描述\n\n直接告诉我你的需求吧！',
        timestamp: Date.now(),
      },
    ];
    setMessages(defaultMessages);
  }

  /** 智能滚动：仅在用户处于底部或发送新消息时自动滚动 */
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;

    // 用户手动上滚后不自动滚动，直到他回到底部
    if (!isNearBottom) {
      userScrolledUpRef.current = true;
      return;
    }

    userScrolledUpRef.current = false;
    if (messagesEndRef.current?.scrollIntoView) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  /** 监听用户手动滚动，决定是否恢复自动滚动 */
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      if (isNearBottom) {
        userScrolledUpRef.current = false;
      } else {
        userScrolledUpRef.current = true;
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // 自动展开 Agent 思考流程：新消息带有 agentThoughts 或 reasoning 时默认展开
  useEffect(() => {
    const newExpanded = new Set(expandedThoughts);
    let changed = false;
    for (const msg of messages) {
      if (msg.agentThoughts && msg.agentThoughts.length > 0 && !newExpanded.has(msg.id)) {
        newExpanded.add(msg.id);
        changed = true;
      }
      if (msg.reasoning && !newExpanded.has(`reasoning-${msg.id}`)) {
        newExpanded.add(`reasoning-${msg.id}`);
        changed = true;
      }
    }
    if (changed) {
      setExpandedThoughts(newExpanded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // 自动持久化：messages 变化时防抖保存到后端会话，确保刷新/切换页面不丢失聊天内容
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentSession || messages.length === 0) return;
    // 跳过初始加载（initSession 设置 messages 时不触发保存）
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // 保存前过滤掉不一致的 pending 状态（防止 isGenerating 残留在已完成的视频上）
      updateSessionMessages(sanitizeMessagesForPersist(messages));
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, currentSession]);

  function extractDuration(text: string): string {
    for (const { regex, multiplier } of DURATION_PATTERNS) {
      const match = text.match(regex);
      if (match) {
        const seconds = parseInt(match[1]) * multiplier;
        // 支持所有时长选项：5/10/15/18/30/36/45/60/75/90秒
        if (seconds <= 5) return '5';
        if (seconds <= 10) return '10';
        if (seconds <= 15) return '15';
        if (seconds <= 18) return '18';
        if (seconds <= 30) return '30';
        if (seconds <= 36) return '36';
        if (seconds <= 45) return '45';
        if (seconds <= 60) return '60';
        if (seconds <= 75) return '75';
        return '90';
      }
    }
    return '10';
  }

  function extractStyle(text: string): string {
    for (const [key, value] of Object.entries(STYLE_MAP)) {
      if (text.includes(value) || text.includes(key)) {
        return key;
      }
    }
    return 'realistic';
  }

  /**
   * 格式化 AI 助手的回复内容，使其更自然、更有温度
   * 避免生硬的"正在处理..."，而是加入上下文理解和思考过程
   */
  function formatAssistantResponse(rawResponse: string, action: string, params: Record<string, any>): string {
    // 如果后端返回的回复已经比较自然，直接使用
    if (rawResponse && rawResponse.length > 30 && !rawResponse.startsWith('正在')) {
      return rawResponse;
    }

    // 为不同任务类型生成更自然的引导语
    const style = params?.style ? STYLE_MAP[params.style] || params.style : '';
    const duration = params?.duration ? `约${params.duration}秒` : '';

    switch (action) {
      case 'video':
        return `好的，我来帮你创作一段${duration}的视频${style ? `，采用${style}风格` : ''}。\n\n我会先分析你的需求，然后生成合适的脚本和视觉方案。让我开始吧——`;
      case 'image':
        return `收到！我来为你生成一张${style ? `${style}风格的` : ''}图片。\n\n让我分析一下你想要的画面效果，然后调用图像模型来创作——`;
      case 'modify-video':
        return `明白了，我来帮你修改这段视频。让我看看需要调整哪些地方——`;
      case 'modify-image':
        return `好的，我来调整这张图片。让我理解你的修改需求——`;
      case 'remove-bg':
        return `没问题，我来帮你抠掉这张图片的背景，保留主体部分——`;
      case 'compose':
        return `好的，我来帮你合成这些素材——`;
      default:
        return rawResponse || '让我分析一下你的需求，然后帮你处理——';
    }
  }

  function recognizeAction(text: string): { action: string; params: Record<string, any> } {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('修改') || lowerText.includes('更改') || lowerText.includes('换成') || lowerText.includes('改成')) {
      let modifyType = 'background';
      if (lowerText.includes('背景')) modifyType = 'background';
      else if (lowerText.includes('人物') || lowerText.includes('角色') || lowerText.includes('着装') || lowerText.includes('性别')) modifyType = 'character';
      else if (lowerText.includes('音乐') || lowerText.includes('bgm') || lowerText.includes('音效')) modifyType = 'music';
      else if (lowerText.includes('剧情') || lowerText.includes('故事') || lowerText.includes('情节')) modifyType = 'story';
      else if (lowerText.includes('风格')) modifyType = 'style';
      
      const hasVideoKeyword = lowerText.includes('视频') || lowerText.includes('video');
      const hasImageKeyword = lowerText.includes('图片') || lowerText.includes('image') || lowerText.includes('图');
      
      if (hasVideoKeyword || (!hasImageKeyword && videoContext)) {
        return {
          action: 'modify-video',
          params: {
            modifyType,
            description: text,
            currentPrompt: videoContext?.prompt || '',
            currentStyle: videoContext?.style || '',
            currentDuration: videoContext?.duration || '',
          },
        };
      } else {
        return {
          action: 'modify-image',
          params: {
            modifyType,
            description: text,
            currentPrompt: imageContext?.prompt || '',
            currentStyle: imageContext?.style || '',
          },
        };
      }
    }

    let action = 'image';
    
    if (lowerText.includes('视频') || lowerText.includes('video')) {
      action = 'video';
    } else if (lowerText.includes('抠图') || lowerText.includes('去背景') || lowerText.includes('移除背景')) {
      action = 'remove-bg';
    } else if (lowerText.includes('合成') || lowerText.includes('组合') || lowerText.includes('叠加')) {
      action = 'compose';
    }

    const duration = action === 'video' ? extractDuration(text) : undefined;
    const style = extractStyle(text);

    return {
      action,
      params: {
        prompt: text,
        style,
        duration,
      },
    };
  }

  /**
   * 将推理模型的思考过程解析为可视化的步骤
   * 支持多种格式：按句号/换行拆分，识别"第N步"、"步骤N"等模式
   */
  function parseReasoningSteps(reasoning: string): string[] {
    if (!reasoning) return [];

    // 尝试按"步骤"关键词拆分
    const stepPattern = /(?:第\d+步[：:]|步骤\d+[：:]|\d+\.[\s]*)/g;
    const stepMatches = [...reasoning.matchAll(stepPattern)];

    if (stepMatches.length >= 2) {
      // 按步骤关键词拆分
      const steps: string[] = [];
      for (let i = 0; i < stepMatches.length; i++) {
        const start = stepMatches[i].index!;
        const end = i + 1 < stepMatches.length ? stepMatches[i + 1].index! : reasoning.length;
        steps.push(reasoning.substring(start, end).trim());
      }
      return steps.filter(s => s.length > 5);
    }

    // 按换行拆分
    const lines = reasoning.split('\n').filter(l => l.trim().length > 5);
    if (lines.length >= 2) return lines.map(l => l.trim()).slice(0, 8);

    // 按句号拆分为几个大段
    const sentences = reasoning.split(/[。.；;]/).filter(s => s.trim().length > 5);
    if (sentences.length >= 2) return sentences.map(s => s.trim() + '。').slice(0, 8);

    return [reasoning.trim()];
  }

  /**
   * 格式化推理过程为可读的展示文本
   */
  function formatReasoningDisplay(steps: string[], modelUsed: string): string {
    if (steps.length === 0) return '';

    const modelLabel = modelUsed === 'reasoning'
      ? '🧠 推理模型深度分析过程'
      : '🤖 AI 分析过程';

    if (steps.length === 1) {
      return `${modelLabel}：\n${steps[0]}`;
    }

    const stepLines = steps.map((step, i) => {
      // 提取步骤标题（第一句话作为标题）
      const firstSentence = step.split(/[。.]/)[0];
      const title = firstSentence.length > 30
        ? firstSentence.substring(0, 30) + '...'
        : firstSentence;
      return `**步骤${i + 1}：** ${title}\n${step.length > 80 ? step.substring(0, 80) + '...' : step}`;
    });

    return `${modelLabel}：\n\n${stepLines.join('\n\n')}`;
  }

  async function callHermesAgent(message: string, history: ChatMessage[], signal?: AbortSignal): Promise<{ action?: string; params?: Record<string, any>; response: string; reasoning?: string; modelUsed?: string }> {
    // 优先使用 SSE 流式模式
    try {
      const sseResponse = await fetch('/api/hermes/chat/stream', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({
          message,
          history: history.slice(-10).map(m => ({
            role: m.role,
            content: m.content,
            actionType: m.actionType,
            params: m.params,
          })),
          sessionId: currentSession?.id || '',
        }),
        signal,
      });

      if (!sseResponse.ok) throw new Error(`SSE HTTP ${sseResponse.status}`);

      const reader = sseResponse.body?.getReader();
      if (!reader) throw new Error('No stream reader');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let resultData: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6).trim());
              if (currentEvent === 'token') {
                fullText += parsed.content || '';
              } else if (currentEvent === 'result') {
                resultData = parsed;
              }
            } catch { /* skip */ }
          }
        }
      }

      if (resultData) {
        return {
          action: resultData.action,
          params: resultData.params,
          response: resultData.response || fullText || '我理解你的需求了，正在帮你处理...',
          modelUsed: 'sse-stream',
        };
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return { response: '我理解你的需求了，正在帮你处理...' };
      }
      console.warn('[SSE] Stream failed, falling back to POST:', (err as Error).message);
    }

    // 回退到传统 POST 模式
    try {
      const response = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          message,
          history: history.slice(-10).map(m => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal,
      });

      const data = await response.json();
      return {
        action: data.action,
        params: data.params,
        response: data.response || '我理解你的需求了，正在帮你处理...',
        reasoning: data.reasoning || '',
        modelUsed: data.modelUsed || 'instruction',
      };
    } catch {
      return { response: '我理解你的需求了，正在帮你处理...' };
    }
  }

  // 多模态混合聊天：支持多图+文字
  async function callHermesWithImage(message: string, imageUrls: string[], signal?: AbortSignal): Promise<{ action?: string; params?: Record<string, any>; response: string; reasoning?: string; modelUsed?: string }> {
    try {
      const response = await fetch('/api/hermes/chat-with-image', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ imageUrls, message, history: messages.slice(-10) }),
        signal,
      });

      const data = await response.json();
      return {
        action: data.action,
        params: data.params,
        response: data.response || '📸 已分析你的图片，正在帮你处理...',
        reasoning: data.reasoning || '',
        modelUsed: data.modelUsed || 'instruction',
      };
    } catch {
      return { response: '我理解你的需求了，正在帮你处理...' };
    }
  }

  async function callStoryWriter(message: string): Promise<{ success: boolean; script?: string; thoughts?: AgentThought[]; sessionId?: string; reasoning?: string; modelUsed?: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const response = await fetch('/api/agents/story/write', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          message,
          history: messages.slice(-10).map(m => ({ role: m.role, content: m.content, actionType: m.actionType, params: m.params, generatedImage: m.generatedImage, generatedVideo: m.generatedVideo, originalPrompt: m.originalPrompt })),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await response.json();
      return {
        success: data.success,
        script: data.result?.script,
        thoughts: data.thoughts,
        sessionId: data.sessionId,
        reasoning: data.reasoning || '',
        modelUsed: data.modelUsed || 'instruction',
      };
    } catch (error) {
      console.error('Story writer error:', error);
      return { success: false };
    }
  }

  async function callVideoAnalyzer(script: string, sessionId?: string, originalMessage?: string): Promise<{ success: boolean; result?: Record<string, any>; thoughts?: AgentThought[]; reasoning?: string; modelUsed?: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const response = await fetch('/api/agents/video/analyze', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          script,
          sessionId,
          originalMessage,
          history: messages.slice(-10).map(m => ({ role: m.role, content: m.content, actionType: m.actionType, params: m.params, generatedImage: m.generatedImage, generatedVideo: m.generatedVideo, originalPrompt: m.originalPrompt })),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await response.json();
      return {
        success: data.success,
        result: data.result,
        thoughts: data.thoughts,
        reasoning: data.reasoning || '',
        modelUsed: data.modelUsed || 'instruction',
      };
    } catch (error) {
      console.error('Video analyzer error:', error);
      return { success: false };
    }
  }

  async function callImageAnalyzer(message: string): Promise<{ success: boolean; result?: Record<string, any>; thoughts?: AgentThought[]; reasoning?: string; modelUsed?: string }> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const response = await fetch('/api/agents/image/analyze', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          message,
          history: messages.slice(-10).map(m => ({ role: m.role, content: m.content, actionType: m.actionType, params: m.params, generatedImage: m.generatedImage, generatedVideo: m.generatedVideo, originalPrompt: m.originalPrompt })),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await response.json();
      return {
        success: data.success,
        result: data.result,
        thoughts: data.thoughts,
        reasoning: data.reasoning || '',
        modelUsed: data.modelUsed || 'instruction',
      };
    } catch (error) {
      console.error('Image analyzer error:', error);
      return { success: false };
    }
  }

  async function generateImageAction(params: Record<string, any>) {
    const loadingId = `loading-${Date.now()}`;
    const controller = new AbortController();
    activeTasksRef.current.set(loadingId, controller);
    taskStartTimesRef.current.set(loadingId, Date.now());
    timeoutNoticeShownRef.current = false;
    setMessages(prev => [...prev, {
      id: loadingId,
      role: 'assistant',
      content: '🎨 正在为你生成图片...',
      actionType: 'image',
      isGenerating: true,
      progress: 0,
      timestamp: Date.now(),
    }]);

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 3000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const apiUrl = useMock ? '/api/mock/generate' : '/api/generate';
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: params.prompt,
            style: params.style || 'realistic',
          }),
          signal: controller.signal,
        });

        const responseText = await response.text();
        let data;
        try {
          data = responseText ? JSON.parse(responseText) : {};
        } catch {
          data = {};
        }

        if (data.success && data.imageUrl) {
          setImageContext({
            prompt: params.prompt,
            style: params.style || 'realistic',
            imageUrl: data.imageUrl,
          });
          activeTasksRef.current.delete(loadingId);
          setMessages(prev => prev.map(m => {
            if (m.id === loadingId) {
              return {
                ...m,
                content: '✅ 图片生成成功！你可以继续修改这张图片。',
                isGenerating: false,
                generatedImage: data.imageUrl,
                originalPrompt: params.prompt,
                modifyHistory: [],
              };
            }
            return m;
          }));
          return;
        } else {
          const rawError = data.error || '未知错误';
          // 内容审核相关错误：不重试，直接提示用户修改 prompt
          const isContentBlocked = /unable to generate|content.*filter|content.*block|inappropriate|unsafe|violation|请修改.*提示|审核|不安全/i.test(rawError);
          const errorMsg = isContentBlocked
            ? `\n💡 ${rawError}\n提示：这可能是内容审核策略拦截，请修改或简化你的描述词后重试。`
            : rawError;
          if (attempt < MAX_RETRIES && !isContentBlocked) {
            setMessages(prev => prev.map(m => {
              if (m.id === loadingId) {
                return {
                  ...m,
                  content: `❌ 图片生成失败(第${attempt}次): ${errorMsg}，${RETRY_DELAY_MS / 1000}秒后自动重试...`,
                };
              }
              return m;
            }));
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          } else {
            activeTasksRef.current.delete(loadingId);
            // ===== 全部失败：审核 Agent 分析原因 =====
            let imgAnalysis = '';
            try {
              const analysisResp = await fetch('/api/hermes/failure-analysis', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                  errorMsg,
                  userPrompt: params.prompt || '',
                  style: params.style || 'realistic',
                  duration: 'N/A',
                  engine: params.model || 'Trae/万相',
                }),
                signal: AbortSignal.timeout(15000),
              });
              if (analysisResp.ok) {
                const analysisData = await analysisResp.json();
                if (analysisData.success && analysisData.result) {
                  imgAnalysis = `\n\n🔍 审核Agent诊断：${analysisData.result.reason}\n💡 建议：\n${analysisData.result.suggestions.map((s: string) => `• ${s}`).join('\n')}`;
                }
              }
            } catch {}
            setMessages(prev => prev.map(m => {
              if (m.id === loadingId) {
                return {
                  ...m,
                  content: `❌ 图片生成失败(已重试${MAX_RETRIES}次): ${errorMsg}${imgAnalysis}`,
                  isGenerating: false,
                };
              }
              return m;
            }));
            return;
          }
        }
      } catch (error) {
        // 用户主动终止任务，直接退出
        if ((error as Error).name === 'AbortError') {
          activeTasksRef.current.delete(loadingId);
          return;
        }
        const errorMsg = (error as Error).message;
        if (attempt < MAX_RETRIES) {
          setMessages(prev => prev.map(m => {
            if (m.id === loadingId) {
              return {
                ...m,
                content: `❌ 图片生成异常(第${attempt}次): ${errorMsg}，${RETRY_DELAY_MS / 1000}秒后自动重试...`,
              };
            }
            return m;
          }));
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        } else {
          activeTasksRef.current.delete(loadingId);
          setMessages(prev => prev.map(m => {
            if (m.id === loadingId) {
              return {
                ...m,
                content: `❌ 图片生成异常(已重试${MAX_RETRIES}次): ${errorMsg}，请稍后重试`,
                isGenerating: false,
              };
            }
            return m;
          }));
          return;
        }
      }
    }
  }

  async function modifyImageAction(messageId: string, originalPrompt: string, modifyInstruction: string, style: string = 'realistic', refImageUrl?: string) {
    const loadingId = `modify-loading-${Date.now()}`;
    const controller = new AbortController();
    activeTasksRef.current.set(loadingId, controller);
    setMessages(prev => [...prev, {
      id: loadingId,
      role: 'assistant',
      content: refImageUrl ? '🎨 正在根据参考图和你的需求修改图片...' : '🎨 正在根据你的需求修改图片...',
      actionType: 'image',
      isGenerating: true,
      progress: 0,
      timestamp: Date.now(),
    }]);

    try {
      const apiUrl = useMock ? '/api/mock/generate' : '/api/generate/modify';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          originalPrompt,
          modifyInstruction,
          style,
          ...(refImageUrl ? { refImageUrl } : {}),
        }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (data.success && data.imageUrl) {
        activeTasksRef.current.delete(loadingId);
        setImageContext({
          prompt: `${originalPrompt} | 修改：${modifyInstruction}`,
          style,
          imageUrl: data.imageUrl,
        });
        setMessages(prev => prev.map(m => {
          if (m.id === loadingId) {
            return {
              ...m,
              content: `✅ 图片修改完成！修改需求：${modifyInstruction}`,
              isGenerating: false,
              generatedImage: data.imageUrl,
              originalPrompt: `${originalPrompt} | 修改：${modifyInstruction}`,
              modifyHistory: [
                ...(m.modifyHistory || []),
                { prompt: modifyInstruction, result: data.imageUrl, timestamp: Date.now() }
              ],
            };
          }
          return m;
        }));
      } else {
        activeTasksRef.current.delete(loadingId);
        setMessages(prev => prev.map(m => {
          if (m.id === loadingId) {
            return {
              ...m,
              content: `❌ 图片修改失败：${data.error || '未知错误'}`,
              isGenerating: false,
            };
          }
          return m;
        }));
      }
    } catch (error) {
      // 用户主动终止任务
      if ((error as Error).name === 'AbortError') {
        activeTasksRef.current.delete(loadingId);
        setModifyInputId(null);
        setModifyInput('');
        return;
      }
      activeTasksRef.current.delete(loadingId);
      setMessages(prev => prev.map(m => {
        if (m.id === loadingId) {
          return {
            ...m,
            content: `❌ 图片修改异常：${(error as Error).message}`,
            isGenerating: false,
          };
        }
        return m;
      }));
    }

    setModifyInputId(null);
    setModifyInput('');
  }

  async function modifyVideoAction(messageId: string, originalPrompt: string, modifyInstruction: string, style: string = 'realistic', duration: string = '10') {
    const loadingId = `modify-loading-${Date.now()}`;
    const controller = new AbortController();
    activeTasksRef.current.set(loadingId, controller);
    setMessages(prev => [...prev, {
      id: loadingId,
      role: 'assistant',
      content: '📹 正在根据你的需求修改视频...',
      actionType: 'video',
      isGenerating: true,
      progress: 0,
      timestamp: Date.now(),
    }]);

    try {
      const apiUrl = useMock ? '/api/mock/video' : '/api/video/modify';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          originalPrompt,
          modifyInstruction,
          style,
          duration,
        }),
        signal: controller.signal,
      });

      // 安全解析响应：先用 text() 读取，再 try-catch 解析 JSON，避免空响应体导致报错
      const responseText = await response.text();
      let data;
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = {};
      }

      if (data.success && data.taskId) {
        // 异步模式：后端立即返回 taskId，前端轮询任务状态（与生成视频一致）
        const pollPrompt = data.newPrompt || `${originalPrompt} | 修改：${modifyInstruction}`;
        await pollVideoStatus(data.taskId, loadingId, {
          prompt: pollPrompt,
          style,
          duration,
        }, controller);
      } else if (data.success && data.videoUrl) {
        // 兼容旧模式：后端直接返回视频地址
        setVideoContext({
          prompt: originalPrompt,
          style,
          duration,
          videoUrl: data.videoUrl,
        });
        activeTasksRef.current.delete(loadingId);
        setMessages(prev => prev.map(m => {
          if (m.id === loadingId) {
            return {
              ...m,
              content: `✅ 视频修改完成！修改需求：${modifyInstruction}`,
              isGenerating: false,
              generatedVideo: data.videoUrl,
              originalPrompt: `${originalPrompt} | 修改：${modifyInstruction}`,
              modifyHistory: [
                ...(m.modifyHistory || []),
                { prompt: modifyInstruction, result: data.videoUrl, timestamp: Date.now() }
              ],
            };
          }
          return m;
        }));
      } else {
        activeTasksRef.current.delete(loadingId);
        setMessages(prev => prev.map(m => {
          if (m.id === loadingId) {
            return {
              ...m,
              content: `❌ 视频修改失败：${data.error || '未知错误'}`,
              isGenerating: false,
            };
          }
          return m;
        }));
      }
    } catch (error) {
      // 用户主动终止任务，直接退出
      if ((error as Error).name === 'AbortError') {
        activeTasksRef.current.delete(loadingId);
        setModifyInputId(null);
        setModifyInput('');
        return;
      }
      activeTasksRef.current.delete(loadingId);
      setMessages(prev => prev.map(m => {
        if (m.id === loadingId) {
          return {
            ...m,
            content: `❌ 视频修改异常：${(error as Error).message}`,
            isGenerating: false,
          };
        }
        return m;
      }));
    }

    setModifyInputId(null);
    setModifyInput('');
  }

  async function generateVideoAction(params: Record<string, any>, agentThoughts: AgentThought[] = [], sessionId?: string) {
    const loadingId = `loading-${Date.now()}`;
    const controller = new AbortController();
    activeTasksRef.current.set(loadingId, controller);
    taskStartTimesRef.current.set(loadingId, Date.now());
    timeoutNoticeShownRef.current = false;

    // 🔍 审核 Agent：生成前快速评分
    let qualityBadge = '';
    try {
      const qResp = await fetch('/api/hermes/video-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: 'quick',
          params: { prompt: params.prompt, style: params.style },
          duration: params.duration || '18',
          style: params.style || '',
        }),
        signal: controller.signal,
      });
      const qData = await qResp.json();
      if (qData.success && qData.result) {
        const score = qData.result.score;
        const issues = qData.result.issues || [];
        if (score < 40) {
          qualityBadge = `\n🚨 **审核评分：${score}/100 — 可能失败！**${issues.length ? '\n问题：' + issues.join('；') : ''}`;
        } else if (score < 70) {
          qualityBadge = `\n⚠️ **审核评分：${score}/100**${issues.length ? ' — ' + issues.join('；') : ''}`;
        } else {
          qualityBadge = `\n✅ **审核评分：${score}/100**`;
        }
      }
    } catch {}

    // 如果后端返回了分镜脚本，显示分镜预览
    const sceneBreakdown = params.sceneBreakdown;
    const scenePreview = sceneBreakdown && sceneBreakdown.length > 0
      ? `\n📋 分镜脚本（${sceneBreakdown.length} 个镜头）：\n${sceneBreakdown.map((s: any) => `  ${s.scene}. ${s.description}（${s.duration}秒）`).join('\n')}`
      : '';

    const genPhases = [
      '📹 正在提交视频生成任务...',
      '📹 等待 AI 引擎处理...',
      '📹 正在渲染视频画面...',
      '📹 正在合成视频片段...',
    ];
    let genPhaseIdx = 0;

    setMessages(prev => [...prev, {
      id: loadingId,
      role: 'assistant',
      content: `📹 正在提交视频生成任务...${scenePreview}${qualityBadge}`,
      actionType: 'video',
      isGenerating: true,
      progress: 0,
      timestamp: Date.now(),
      agentThoughts,
      sessionId,
    }]);

    // 实时展示生成进度阶段
    const genTimer = setInterval(() => {
      genPhaseIdx = (genPhaseIdx + 1) % genPhases.length;
      setMessages(prev => prev.map(m => {
        if (m.id === loadingId && m.isGenerating) {
          return { ...m, content: `${genPhases[genPhaseIdx]}${scenePreview}${qualityBadge}` };
        }
        return m;
      }));
    }, 3000);

    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 3000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const apiUrl = useMock ? '/api/mock/video' : '/api/video';
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            prompt: params.prompt,
            style: params.style || 'realistic',
            duration: params.duration || '10',
            sceneBreakdown: params.sceneBreakdown || undefined, // 传递分镜数据
          }),
          signal: controller.signal,
        });

        const responseText = await response.text();
        let data;
        try {
          data = responseText ? JSON.parse(responseText) : {};
        } catch {
          data = {};
        }

        if (data.success && data.taskId) {
          await pollVideoStatus(data.taskId, loadingId, params, controller);
          return;
        } else {
          const errorMsg = data.error || '未知错误';
          if (attempt < MAX_RETRIES) {
            setMessages(prev => prev.map(m => {
              if (m.id === loadingId) {
                return {
                  ...m,
                  content: `❌ 视频生成异常(第${attempt}次): ${errorMsg}，${RETRY_DELAY_MS / 1000}秒后自动重试...`,
                };
              }
              return m;
            }));
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          } else {
            activeTasksRef.current.delete(loadingId);
            setMessages(prev => prev.map(m => {
              if (m.id === loadingId) {
                return {
                  ...m,
                  content: `❌ 视频生成异常(已重试${MAX_RETRIES}次): ${errorMsg}，请稍后重试`,
                  isGenerating: false,
                };
              }
              return m;
            }));
            return;
          }
        }
      } catch (error) {
        // 用户主动终止任务，直接退出
        if ((error as Error).name === 'AbortError') {
          activeTasksRef.current.delete(loadingId);
          return;
        }
        const errorMsg = (error as Error).message;
        if (attempt < MAX_RETRIES) {
          setMessages(prev => prev.map(m => {
            if (m.id === loadingId) {
              return {
                ...m,
                content: `❌ 视频生成异常(第${attempt}次): ${errorMsg}，${RETRY_DELAY_MS / 1000}秒后自动重试...`,
              };
            }
            return m;
          }));
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        } else {
          activeTasksRef.current.delete(loadingId);
          setMessages(prev => prev.map(m => {
            if (m.id === loadingId) {
              return {
                ...m,
                content: `❌ 视频生成异常(已重试${MAX_RETRIES}次): ${errorMsg}，请稍后重试`,
                isGenerating: false,
              };
            }
            return m;
          }));
          return;
        }
      }
    }
  }

  async function pollVideoStatus(taskId: string, loadingId: string, params: Record<string, any>, controller: AbortController) {
    const MAX_POLL_RETRIES = 1; // 减少重试次数：Agent 审核失败不应重试，只有网络/暂时错误才重试一次
    const RETRY_DELAY_MS = 5000;
    let currentTaskId = taskId;
    const isSplitVideo = taskId.startsWith('split_') || taskId.startsWith('seedance-split-');
    // 记录 messageId → taskId 映射，用于取消时通知后端
    taskIdMapRef.current.set(loadingId, currentTaskId);

    for (let pollAttempt = 0; pollAttempt < MAX_POLL_RETRIES + 1; pollAttempt++) {
      if (controller.signal.aborted) {
        activeTasksRef.current.delete(loadingId);
        return;
      }
      try {
        for (let i = 0; i < (isSplitVideo ? 180 : 80); i++) {
          if (controller.signal.aborted) {
            activeTasksRef.current.delete(loadingId);
            return;
          }
          // 自适应轮询：前 20 次每 2 秒，之后每 5 秒
          const pollDelay = useMock ? 1000 : (i < 20 ? 2000 : 5000);
          await new Promise(resolve => setTimeout(resolve, pollDelay));

          if (controller.signal.aborted) {
            activeTasksRef.current.delete(loadingId);
            return;
          }

          const statusUrl = useMock ? `/api/mock/video/pending/${currentTaskId}/status` : `/api/video/pending/${currentTaskId}/status`;
          const response = await fetch(statusUrl, { signal: controller.signal, headers: authHeaders() });
          const responseText = await response.text();

          let data;
          try {
            data = responseText ? JSON.parse(responseText) : {};
          } catch {
            data = {};
          }

          if (data.success && data.videoUrl) {
            const finalVideoUrl = data.videoUrl;
            // 视频生成完成，先清理前端任务映射
            taskIdMapRef.current.delete(loadingId);
            activeTasksRef.current.delete(loadingId);

            // ========== 审核 Agent 最终检查 ==========
            setMessages(prev => prev.map(m => {
              if (m.id === loadingId) {
                return { ...m, content: '🔍 审核 Agent 正在检查视频质量...' };
              }
              return m;
            }));

            let reviewPassed = true;
            try {
              const reviewResp = await fetch('/api/hermes/video-review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  stage: 'final',
                  prompt: params.prompt,
                  style: params.style || 'realistic',
                  duration: params.duration || '10',
                  videoUrl: finalVideoUrl,
                }),
                signal: AbortSignal.timeout(15000),
              });
              if (reviewResp.ok) {
                const reviewData = await reviewResp.json();
                if (reviewData.result && !reviewData.result.passed) {
                  reviewPassed = false;
                  const reason = reviewData.result.explanation || '视频质量不符合要求';
                  console.log(`[VideoReview] 审核不通过: ${reason}`);
                } else {
                  console.log('[VideoReview] 审核通过');
                }
              }
            } catch (reviewErr) {
              console.log('[VideoReview] 审核异常，默认通过:', reviewErr);
              // 审核失败默认通过，不阻塞流程
            }

            if (!reviewPassed) {
              // 审核不通过 → 取消旧任务，清理旧视频，重新创建新任务
              console.log('[VideoReview] 审核不通过，关闭旧任务并重新生成...');

              // 通知后端取消旧任务（如果有后台轮询）
              await fetch(`/api/video/cancel/${currentTaskId}`, { method: 'POST', headers: authHeaders() }).catch(() => {});

              // 更新提示
              setMessages(prev => prev.map(m => {
                if (m.id === loadingId) {
                  return {
                    ...m,
                    content: '⚠️ 审核 Agent 发现视频质量不符合要求，正在重新生成...',
                  };
                }
                return m;
              }));

              // 重新创建任务
              await new Promise(resolve => setTimeout(resolve, 2000));
              const retryApiUrl = useMock ? '/api/mock/video' : '/api/video';
              const retryResp = await fetch(retryApiUrl, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                  prompt: params.prompt,
                  style: params.style || 'realistic',
                  duration: params.duration || '10',
                }),
                signal: controller.signal,
              });
              const retryText = await retryResp.text();
              let retryData: any = {};
              try { retryData = JSON.parse(retryText); } catch {}

              if (retryData.success && retryData.taskId) {
                const newTaskId = retryData.taskId;
                currentTaskId = newTaskId;
                taskIdMapRef.current.set(loadingId, newTaskId);
                // 重置轮询次数，重新开始
                continue;
              } else {
                // 重试也失败，直接终止
                setMessages(prev => prev.map(m => {
                  if (m.id === loadingId) {
                    return {
                      ...m,
                      content: `❌ 审核 Agent 拒绝通过且重新生成失败: ${retryData.error || '未知错误'}`,
                      isGenerating: false,
                    };
                  }
                  return m;
                }));
                return;
              }
            }

            // ========== 审核通过 → 正常结束 ==========
            setVideoContext({
              prompt: params.prompt,
              style: params.style || 'realistic',
              duration: params.duration || '10',
              videoUrl: finalVideoUrl,
            });
            setMessages(prev => prev.map(m => {
              if (m.id === loadingId) {
                return {
                  ...m,
                  content: isSplitVideo ? '✅ 视频片段拼接完成！审核 Agent 已确认质量合格。' : '✅ 视频生成成功！审核 Agent 已确认质量合格。',
                  isGenerating: false,
                  generatedVideo: finalVideoUrl,
                  originalPrompt: params.prompt,
                  modifyHistory: [],
                };
              }
              return m;
            }));
            return;
          }

          if (data.status === 'failed' || data.status === 'FAILED' || data.status === 'cancelled') {
            const errorMsg = data.error || '未知错误';
            taskIdMapRef.current.delete(loadingId);

            // split_ 任务失败不重试（重试会再次触发拆分逻辑，耗时极长）
            if (isSplitVideo) {
              activeTasksRef.current.delete(loadingId);
              const isExpired = errorMsg.includes('已过期') || errorMsg.includes('不存在');
              const isRateLimit = errorMsg.includes('限流') || errorMsg.includes('queue') || errorMsg.includes('跳过');

              // ===== 审核 Agent 介入分析失败原因 =====
              let analysis = '';
              try {
                const analysisResp = await fetch('/api/hermes/failure-analysis', {
                  method: 'POST',
                  headers: authHeaders(),
                  body: JSON.stringify({
                    errorMsg,
                    userPrompt: params.prompt,
                    style: params.style || 'realistic',
                    duration: params.duration || '10',
                    engine: '万相拆分模式',
                  }),
                  signal: AbortSignal.timeout(15000),
                });
                if (analysisResp.ok) {
                  const analysisData = await analysisResp.json();
                  if (analysisData.success && analysisData.result) {
                    analysis = `\n\n🔍 审核Agent诊断：${analysisData.result.reason}\n💡 建议：\n${analysisData.result.suggestions.map((s: string) => `• ${s}`).join('\n')}`;
                  }
                }
              } catch {}

              const errorTip = (isExpired
                ? `❌ 视频生成失败: ${errorMsg}`
                : isRateLimit
                  ? `⚠️ 视频生成部分完成: ${errorMsg}`
                  : `❌ 视频生成失败: ${errorMsg}`) + analysis;
              setMessages(prev => prev.map(m => {
                if (m.id === loadingId) {
                  return { ...m, content: errorTip, isGenerating: false };
                }
                return m;
              }));
              return;
            }

            // Agent 审核失败、内容安全拒绝等明确失败，不应重试
            const isAgentRejected =
              errorMsg.includes('审核') || errorMsg.includes('安全') || errorMsg.includes('违规') ||
              errorMsg.includes('拒绝') || errorMsg.includes('不通过') || errorMsg.includes('rejected') ||
              errorMsg.includes('内容不合规') || errorMsg.includes('safety');
            const isApiFatal =
              errorMsg.includes('API Key') || errorMsg.includes('未配置') || errorMsg.includes('鉴权') ||
              errorMsg.includes('无权限') || errorMsg.includes('余额不足') || errorMsg.includes('quota') ||
              errorMsg.includes('所有') || errorMsg.includes('均失败') || errorMsg.includes('均不可用');

            if (isAgentRejected || isApiFatal) {
              // Agent 明确拒绝或 API 配置问题，直接停止，不重试
              activeTasksRef.current.delete(loadingId);

              // ===== 审核 Agent 介入分析失败原因 =====
              let analysis = '';
              try {
                const analysisResp = await fetch('/api/hermes/failure-analysis', {
                  method: 'POST',
                  headers: authHeaders(),
                  body: JSON.stringify({
                    errorMsg,
                    userPrompt: params.prompt,
                    style: params.style || 'realistic',
                    duration: params.duration || '10',
                    engine: params.engine || 'Agnes/万相',
                  }),
                  signal: AbortSignal.timeout(15000),
                });
                if (analysisResp.ok) {
                  const analysisData = await analysisResp.json();
                  if (analysisData.success && analysisData.result) {
                    analysis = `\n\n🔍 审核Agent诊断：${analysisData.result.reason}\n💡 建议：\n${analysisData.result.suggestions.map((s: string) => `• ${s}`).join('\n')}`;
                  }
                }
              } catch {}

              setMessages(prev => prev.map(m => {
                if (m.id === loadingId) {
                  return {
                    ...m,
                    content: `❌ 视频生成失败: ${errorMsg}${analysis}`,
                    isGenerating: false,
                  };
                }
                return m;
              }));
              return;
            }

            // 临时错误（网络超时、服务繁忙等），允许重试一次
            if (pollAttempt < MAX_POLL_RETRIES) {
              setMessages(prev => prev.map(m => {
                if (m.id === loadingId) {
                  return {
                    ...m,
                    content: `❌ 视频生成失败(第${pollAttempt + 1}次): ${errorMsg}，${RETRY_DELAY_MS / 1000}秒后重新生成...`,
                  };
                }
                return m;
              }));
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));

              const retryApiUrl = useMock ? '/api/mock/video' : '/api/video';
              const retryResponse = await fetch(retryApiUrl, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                  prompt: params.prompt,
                  style: params.style || 'realistic',
                  duration: params.duration || '10',
                }),
                signal: controller.signal,
              });
              const retryText = await retryResponse.text();
              let retryData;
              try {
                retryData = retryText ? JSON.parse(retryText) : {};
              } catch {
                retryData = {};
              }

              if (retryData.success && retryData.taskId) {
                currentTaskId = retryData.taskId;
                taskIdMapRef.current.set(loadingId, currentTaskId);
                setMessages(prev => prev.map(m => {
                  if (m.id === loadingId) {
                    return {
                      ...m,
                      content: `⏳ 视频生成任务已重新提交，请等待生成完成...`,
                    };
                  }
                  return m;
                }));
                // 重置循环，重新轮询新任务
                continue;
              } else {
                // 重试提交也失败了，记录并停止
                console.log(`[Video Poll] Retry submit also failed: ${retryData.error || 'unknown'}`);
              }
            }

            // ===== 全部 Agent 失败：停止任务，不挂起 =====
            activeTasksRef.current.delete(loadingId);

            // 通知后端取消所有后台轮询
            await fetch(`/api/video/cancel/${currentTaskId}`, {
              method: 'POST',
              headers: authHeaders(),
            }).catch(() => {});

            // 审核 Agent 分析最终失败原因
            let finalAnalysis = '';
            try {
              const analysisResp = await fetch('/api/hermes/failure-analysis', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                  errorMsg,
                  userPrompt: params.prompt,
                  style: params.style || 'realistic',
                  duration: params.duration || '10',
                  engine: params.engine || '默认',
                }),
                signal: AbortSignal.timeout(15000),
              });
              if (analysisResp.ok) {
                const analysisData = await analysisResp.json();
                if (analysisData.success && analysisData.result) {
                  finalAnalysis = `\n\n🔍 审核Agent诊断：${analysisData.result.reason}\n💡 建议：\n${analysisData.result.suggestions.map((s: string) => `• ${s}`).join('\n')}`;
                }
              }
            } catch {}

            setMessages(prev => prev.map(m => {
              if (m.id === loadingId) {
                return {
                  ...m,
                  content: `❌ 视频生成失败: ${errorMsg}${finalAnalysis}`,
                  isGenerating: false,
                };
              }
              return m;
            }));
            return;
          }

          if (data.progress !== undefined) {
            const statusText = data.status || '';
            let displayText = isSplitVideo
              ? `📹 视频生成中... ${data.progress}% ${statusText}`
              : `📹 视频生成中... ${data.progress}%`;
            setMessages(prev => prev.map(m => {
              if (m.id === loadingId) {
                return {
                  ...m,
                  content: displayText,
                  progress: data.progress,
                };
              }
              return m;
            }));
          }
        }

        activeTasksRef.current.delete(loadingId);
        setMessages(prev => prev.map(m => {
          if (m.id === loadingId) {
            return {
              ...m,
              content: '⏳ 视频生成时间较长，请稍后在视频历史中查看',
              isGenerating: false,
            };
          }
          return m;
        }));
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          activeTasksRef.current.delete(loadingId);
          return;
        }
        console.error('轮询视频状态异常:', error);
      }
    }
  }

  async function handleSend() {
    if (!input.trim() || isTyping) return;

    // 冷却期内禁止发送
    if (abortCooldown > 0) {
      setMessages(prev => [...prev, {
        id: `cooldown-${Date.now()}`,
        role: 'assistant',
        content: `⏳ 任务终止冷却中，请等待 ${abortCooldown} 秒后再发送新请求...`,
        timestamp: Date.now(),
      }]);
      return;
    }

    // 检测是否有正在进行的生成任务
    const pending = getPendingTasks();
    if (pending.length > 0) {
      // 自动入队，不阻塞用户
      const queueItem = { id: `queue-${Date.now()}`, text: input.trim(), timestamp: Date.now() };
      setMessageQueue(prev => [...prev, queueItem]);
      setInput('');
      return;
    }

    const attachmentImages = [...pendingAttachmentImages];
    setPendingAttachmentImages([]);
    await executeSend(input.trim(), attachmentImages.length > 0 ? attachmentImages : undefined);
  }

  // 处理多图附件选取
  async function handleAttachmentFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newUrls: string[] = [];

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;

      setMessages(prev => [...prev, {
        id: `uploading-${Date.now()}`,
        role: 'assistant',
        content: `📤 正在上传 ${file.name}...`,
        timestamp: Date.now(),
      }]);

      const formData = new FormData();
      formData.append('image', file);

      try {
        const response = await fetch('/api/upload/image', { method: 'POST', body: formData });
        const result = await response.json();
        setMessages(prev => prev.filter(m => !m.id.startsWith('uploading-')));
        if (result.success) {
          newUrls.push(result.imageUrl);
        }
      } catch {
        setMessages(prev => prev.filter(m => !m.id.startsWith('uploading-')));
      }
    }

    if (newUrls.length > 0) {
      setPendingAttachmentImages(prev => [...prev, ...newUrls].slice(0, 5)); // 最多5张
    }

    if (multiFileInputRef.current) multiFileInputRef.current.value = '';
  }

  // 移除单张附件图片
  function removeAttachmentImage(index: number) {
    setPendingAttachmentImages(prev => prev.filter((_, i) => i !== index));
  }
  // 清空所有附件
  function clearAttachmentImages() {
    setPendingAttachmentImages([]);
  }

  // 通过 URL 添加图片（粘贴或手动输入）
  function addImageByUrl(url: string) {
    const trimmed = url.trim();
    if (!trimmed) return;

    // 验证是否为图片 URL
    const isImageUrl = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(trimmed) ||
      /^https?:\/\/.*\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i.test(trimmed) ||
      trimmed.startsWith('data:image/');

    if (!isImageUrl) {
      setUrlPreviewError('请输入有效的图片链接（支持 jpg/png/gif/webp/bmp 格式）');
      return;
    }

    if (pendingAttachmentImages.length >= 5) {
      setUrlPreviewError('最多附加 5 张图片');
      return;
    }

    setUrlPreviewError(null);
    setPendingAttachmentImages(prev => [...prev, trimmed]);
    setImageUrlInput('');
  }

  // 处理粘贴事件：支持图片文件和图片 URL
  function handleInputPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const items = e.clipboardData.items;

    // 优先处理剪贴板中的图片文件（Ctrl+V 截图等）
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          uploadPastedImage(file);
          return;
        }
      }
    }

    // 检查粘贴的文本是否为图片 URL
    const text = e.clipboardData.getData('text').trim();
    if (text && /^https?:\/\/.*\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(text)) {
      e.preventDefault();
      addImageByUrl(text);
    }
  }

  // 上传粘贴的图片文件
  async function uploadPastedImage(file: File) {
    if (pendingAttachmentImages.length >= 5) {
      setUrlPreviewError('最多附加 5 张图片');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/api/upload/image', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (result.success && result.imageUrl) {
        setPendingAttachmentImages(prev => [...prev, result.imageUrl]);
      } else {
        setUrlPreviewError(result.error || '图片上传失败');
      }
    } catch (err) {
      setUrlPreviewError('图片上传失败，请检查网络');
    } finally {
      setIsUploading(false);
    }
  }

  // 处理 URL 输入框的键盘事件
  function handleImageUrlKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addImageByUrl(imageUrlInput);
    } else if (e.key === 'Escape') {
      setShowImageUrlInput(false);
      setImageUrlInput('');
      setUrlPreviewError(null);
    }
  }

  // 从队列中删除指定消息
  function removeFromQueue(queueId: string) {
    setMessageQueue(prev => prev.filter(item => item.id !== queueId));
  }

  // 消费队列中的下一个消息
  async function processNextInQueue() {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;
    try {
      // 确保上一个任务完全结束后再检查队列
      await new Promise(resolve => setTimeout(resolve, 800));
      // 冷却期内不处理队列（使用 ref 避免闭包过期）
      if (abortCooldownRef.current > 0) return;
      // 使用 setState 回调获取最新队列
      setMessageQueue(prev => {
        if (prev.length === 0) return prev;
        const [next, ...rest] = prev;
        // 异步执行队首消息
        setTimeout(async () => {
          try {
            await executeSend(next.text);
          } catch (e) {
            console.error('队列执行异常:', e);
          }
        }, 300);
        return rest;
      });
    } finally {
      isProcessingQueueRef.current = false;
    }
  }

  // 手动停止当前任务：打开任务列表让用户选择停止或等待
  function handleStopCurrentTask() {
    pendingSendRef.current = null;
    setPendingModalMode('stop');
    setShowPendingModal(true);
  }

  // 用户选择等待：关闭模态框，任务在后台继续运行
  function handleWaitPendingTasks() {
    const mode = pendingModalMode;
    setShowPendingModal(false);
    pendingSendRef.current = null;
    timeoutNoticeShownRef.current = false; // 重置超时检测
    if (mode === 'send') {
      setMessages(prev => [...prev, {
        id: `wait-${Date.now()}`,
        role: 'assistant',
        content: '⏳ 已为你保留正在进行的任务，请等待任务完成后再次发送新请求。任务进度会在下方实时显示。',
        timestamp: Date.now(),
      }]);
    } else if (mode === 'timeout') {
      setMessages(prev => [...prev, {
        id: `wait-${Date.now()}`,
        role: 'assistant',
        content: '⏳ 已选择继续等待，任务仍在后台运行。如果后续还需要操作，可以随时点击「停止」按钮。',
        timestamp: Date.now(),
      }]);
    }
  }

  // 用户选择终止：终止所有未完成任务
  async function handleAbortAndContinue() {
    const mode = pendingModalMode;
    abortAllPendingTasks();
    const pendingText = pendingSendRef.current;
    pendingSendRef.current = null;
    if (mode === 'send' && pendingText) {
      // 发送模式：终止后自动发送新请求
      setMessages(prev => [...prev, {
        id: `abort-${Date.now()}`,
        role: 'assistant',
        content: '⚠️ 已终止未完成任务，将在 5 秒后自动发送你的新请求...',
        timestamp: Date.now(),
      }]);
      // 等待5秒冷却后自动发送
      setTimeout(() => {
        executeSend(pendingText);
      }, 5000);
    } else {
      // 停止模式：只终止，清空队列，短暂冷却
      setMessageQueue([]); // 清空等待队列
      abortCooldownRef.current = 3;
      setAbortCooldown(3); // 3秒冷却
      setMessages(prev => [...prev, {
        id: `abort-${Date.now()}`,
        role: 'assistant',
        content: '⏹️ 已停止所有正在进行的任务，等待队列也已清空。',
        timestamp: Date.now(),
      }]);
    }
  }

  // 实际执行发送逻辑
  async function executeSend(sendText: string, imageUrls?: string[]) {
    const hasImages = imageUrls && imageUrls.length > 0;
    const imageCount = hasImages ? imageUrls!.length : 0;
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: hasImages ? `🖼️ [${imageCount}张图片] ${sendText}` : sendText,
      timestamp: Date.now(),
      generatedImage: hasImages ? imageUrls![0] : undefined,
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    // 展示 Agent 思考状态（带推理模型的实时思考过程）
    const thinkingId = `thinking-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: thinkingId,
      role: 'assistant',
      content: '🧠 推理模型正在分析你的需求...',
      actionType: 'general',
      isGenerating: true,
      timestamp: Date.now(),
    }]);

    // 实时展示思考阶段变化（等待推理模型返回时展示阶段动画）
    const thinkingTimer = setInterval(() => {
      setMessages(prev => prev.map(m => {
        if (m.id === thinkingId && m.isGenerating) {
          const d = new Date().getSeconds() % 3;
          const phases = [
            '🧠 正在理解你的需求...',
            '🔍 正在分析关键信息...',
            '💡 正在构思最佳方案...',
            '✨ 正在整理思路...',
          ];
          const phase = phases[Math.floor(new Date().getSeconds() / 2) % phases.length];
          return { ...m, content: `${phase}${'.'.repeat(d + 1)}` };
        }
        return m;
      }));
    }, 1000);

    // Agent 思考阶段也注册 AbortController，支持用户停止
    const agentAbortController = new AbortController();
    const agentTaskId = `agent-${userMessage.id}`;
    activeTasksRef.current.set(agentTaskId, agentAbortController);

    try {
      // 有图片时，使用多模态视觉分析接口
      const hermesResult = hasImages
        ? await callHermesWithImage(sendText, imageUrls!, agentAbortController.signal)
        : await callHermesAgent(sendText, messages, agentAbortController.signal);
      // Agent 思考完成，移除 controller 和思考动画
      clearInterval(thinkingTimer);
      activeTasksRef.current.delete(agentTaskId);

      // 推理模型返回了真实思考过程 → 替换 thinking 消息为简短的模型标识
      // 真正的分析结果在后面的 assistantMessage 中展示
      if (hermesResult.reasoning) {
        setMessages(prev => prev.map(m => {
          if (m.id === thinkingId) {
            return {
              ...m,
              content: `💭 **已完成需求分析**（${hermesResult.modelUsed === 'reasoning' ? 'DeepSeek-R1 / GLM-Z1 深度推理' : 'AI 模型理解'}）`,
              isGenerating: false,
              reasoning: hermesResult.reasoning,
              modelUsed: hermesResult.modelUsed,
            };
          }
          return m;
        }));
      } else {
        // 没有推理过程，移除 thinking 消息
        setMessages(prev => prev.filter(m => m.id !== thinkingId));
      }

      let actionResult = recognizeAction(sendText);
      
      if (hermesResult.action) {
        actionResult.action = hermesResult.action;
        actionResult.params = { ...actionResult.params, ...hermesResult.params };
      }

      // 🔍 审核 Agent：检查 Agent 的理解是否与用户意图一致
      let reviewCorrection = '';
      try {
        const reviewResponse = await fetch('/api/hermes/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userMessage: sendText,
            agentAction: actionResult.action,
            agentParams: actionResult.params,
            agentDescription: hermesResult.response,
          }),
          signal: agentAbortController.signal,
        });
        const reviewData = await reviewResponse.json();
        if (reviewData.success && reviewData.result && !reviewData.result.passed) {
          // 审核发现偏差，自动校对
          console.log('[Review] Deviation detected:', reviewData.result.explanation);
          if (reviewData.result.correctedAction) {
            actionResult.action = reviewData.result.correctedAction;
          }
          if (reviewData.result.correctedParams) {
            actionResult.params = { ...actionResult.params, ...reviewData.result.correctedParams };
          }
          reviewCorrection = `\n\n🔍 *审核 Agent 已校对：${reviewData.result.explanation}*`;
        } else if (reviewData.result?.fromMemory) {
          console.log('[Review] Used memory match');
        }
      } catch (reviewErr) {
        // 审核失败不阻塞流程
        if ((reviewErr as Error).name === 'AbortError') throw reviewErr;
        console.warn('[Review] Review agent call failed, skipping:', reviewErr);
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: formatAssistantResponse(hermesResult.response, actionResult.action, actionResult.params) + reviewCorrection,
        actionType: actionResult.action as any,
        params: actionResult.params,
        timestamp: Date.now(),
        reasoning: hermesResult.reasoning,
        modelUsed: hermesResult.modelUsed,
      };

      setMessages(prev => [...prev, assistantMessage]);

      switch (actionResult.action) {
        case 'video': {
          const loadingId = `loading-${Date.now()}`;
          setMessages(prev => [...prev, {
            id: loadingId,
            role: 'assistant',
            content: '📝 故事创作专家正在创作脚本...',
            actionType: 'video',
            isGenerating: true,
            timestamp: Date.now(),
          }]);

          // 实时展示思考动画
          const storyThoughtTimer = setInterval(() => {
            setMessages(prev => prev.map(m => {
              if (m.id === loadingId && m.isGenerating) {
                const d = new Date().getSeconds() % 3;
                return { ...m, content: `📝 故事创作专家正在创作脚本${'.'.repeat(d + 1)}` };
              }
              return m;
            }));
          }, 800);

          const storyResult = await callStoryWriter(sendText);
          clearInterval(storyThoughtTimer);
          
          // 🔍 审核 Agent：实时审核脚本质量
          let scriptReviewBadge = '';
          if (storyResult.success && storyResult.script) {
            try {
              const reviewResp = await fetch('/api/hermes/video-review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  stage: 'script',
                  userPrompt: sendText,
                  script: storyResult.script,
                  duration: actionResult.params?.duration || '18',
                }),
              });
              const reviewData = await reviewResp.json();
              const r = reviewData.result;
              if (r && r.level === 'error') {
                scriptReviewBadge = `\n\n🚨 **审核警告：${r.message}**`;
                if (r.suggestions?.length) scriptReviewBadge += `\n建议：${r.suggestions.join('；')}`;
              } else if (r && r.level === 'warning') {
                scriptReviewBadge = `\n\n⚠️ **审核提示：${r.message}**`;
              }
            } catch {}
          }
          
          if (storyResult.success && storyResult.script) {
            setMessages(prev => prev.map(m => {
              if (m.id === loadingId) {
                return {
                  ...m,
                  content: `📝 **脚本创作完成！**\n\n${storyResult.script}${scriptReviewBadge}`,
                  agentThoughts: storyResult.thoughts,
                  sessionId: storyResult.sessionId,
                  reasoning: storyResult.reasoning,
                  modelUsed: storyResult.modelUsed,
                  isGenerating: false, // 脚本创作完成，立即清理 isGenerating 状态
                };
              }
              return m;
            }));

            const analyzerLoadingId = `loading-${Date.now()}`;
            setMessages(prev => [...prev, {
              id: analyzerLoadingId,
              role: 'assistant',
              content: '🎬 视频制作专家正在分析脚本...',
              actionType: 'video',
              isGenerating: true,
              progress: 0,
              timestamp: Date.now(),
            }]);

            // 实时展示思考动画
            const analyzerThoughtTimer = setInterval(() => {
              setMessages(prev => prev.map(m => {
                if (m.id === analyzerLoadingId && m.isGenerating) {
                  const d = new Date().getSeconds() % 3;
                  return { ...m, content: `🎬 视频制作专家正在分析脚本${'.'.repeat(d + 1)}` };
                }
                return m;
              }));
            }, 800);

            const analyzeResult = await callVideoAnalyzer(storyResult.script, storyResult.sessionId, sendText);
            clearInterval(analyzerThoughtTimer);

            if (analyzeResult.success && analyzeResult.result) {
              const allThoughts = [...(storyResult.thoughts || []), ...(analyzeResult.thoughts || [])];
              const userDuration = extractDuration(sendText);
              const mergedResult = { ...analyzeResult.result };
              if (userDuration !== '10' || sendText.match(/\d+\s*(秒|分钟|minute|min)/)) {
                mergedResult.duration = userDuration;
              }

              // 构建分析结果展示（完整展示分镜信息和 prompt）
              const resultPreview = mergedResult.sceneBreakdown && mergedResult.sceneBreakdown.length > 0
                ? `🎬 **视频分析完成！**\n\n📋 **分镜脚本（${mergedResult.sceneBreakdown.length} 个镜头，${mergedResult.duration}秒）**：\n${mergedResult.sceneBreakdown.map((s: any) => `  ${s.scene}. ${s.description || s.prompt}（${s.duration}秒）`).join('\n')}\n\n🎨 风格：${mergedResult.style || 'auto'}\n📝 Prompt：${mergedResult.prompt || ''}`
                : `🎬 **视频分析完成！**\n\n🎨 风格：${mergedResult.style || 'auto'}\n⏱ 时长：${mergedResult.duration || '10'}秒\n📝 Prompt：${mergedResult.prompt || ''}`;

              setMessages(prev => prev.map(m => {
                if (m.id === analyzerLoadingId) {
                  return {
                    ...m,
                    content: resultPreview,
                    agentThoughts: allThoughts,
                    reasoning: analyzeResult.reasoning,
                    modelUsed: analyzeResult.modelUsed,
                    isGenerating: false,
                  };
                }
                return m;
              }));
              await generateVideoAction(mergedResult, allThoughts, storyResult.sessionId);
            } else {
              setMessages(prev => prev.map(m => {
                if (m.id === analyzerLoadingId) {
                  return { ...m, isGenerating: false };
                }
                return m;
              }));
              await generateVideoAction(actionResult.params);
            }
          } else {
            await generateVideoAction(actionResult.params);
          }
          break;
        }
        case 'image': {
          const loadingId = `loading-${Date.now()}`;
          setMessages(prev => [...prev, {
            id: loadingId,
            role: 'assistant',
            content: '🎨 图像创作专家正在分析需求...',
            actionType: 'image',
            isGenerating: true,
            timestamp: Date.now(),
          }]);

          // 实时展示思考动画
          const imgThoughtTimer = setInterval(() => {
            setMessages(prev => prev.map(m => {
              if (m.id === loadingId && m.isGenerating) {
                const d = new Date().getSeconds() % 3;
                return { ...m, content: `🎨 图像创作专家正在分析需求${'.'.repeat(d + 1)}` };
              }
              return m;
            }));
          }, 800);

          const analyzeResult = await callImageAnalyzer(sendText);
          clearInterval(imgThoughtTimer);

          if (analyzeResult.success && analyzeResult.result) {
            setMessages(prev => prev.map(m => {
              if (m.id === loadingId) {
                return {
                  ...m,
                  content: `🎨 分析完成！正在生成图片...`,
                  agentThoughts: analyzeResult.thoughts,
                  isGenerating: false, // 分析完成，立即清理 isGenerating
                };
              }
              return m;
            }));
            await generateImageAction(analyzeResult.result);
          } else {
            await generateImageAction(actionResult.params);
          }
          break;
        }
        case 'modify-video': {
          const { modifyType, description, currentPrompt, currentStyle, currentDuration } = actionResult.params;
          
          // 对话式修改：查找最近一条已生成的视频消息，走 /api/video/modify 接口
          // 该接口会调用 LLM 生成优化后的新描述，而非直接重新生成
          const lastVideoMessage = [...messages].reverse().find(
            m => m.role === 'assistant' && m.generatedVideo && !m.isGenerating
          );
          
          if (lastVideoMessage) {
            // 有已生成视频，走修改接口
            const originPrompt = lastVideoMessage.originalPrompt || currentPrompt || '';
            const originStyle = lastVideoMessage.params?.style || currentStyle || 'realistic';
            const originDuration = lastVideoMessage.params?.duration || currentDuration || '10';
            await modifyVideoAction(
              lastVideoMessage.id,
              originPrompt,
              description,
              originStyle,
              originDuration,
            );
          } else {
            // 没有已生成视频，降级为普通生成
            let newPrompt = currentPrompt;
            let newStyle = currentStyle;
            let newDuration = currentDuration;

            if (modifyType === 'background') {
              newPrompt = description;
            } else if (modifyType === 'character') {
              newPrompt = description;
            } else if (modifyType === 'style') {
              newStyle = extractStyle(description);
              newPrompt = description;
            } else if (modifyType === 'story') {
              newPrompt = description;
            }

            await generateVideoAction({
              prompt: newPrompt || currentPrompt || description,
              style: newStyle || 'realistic',
              duration: newDuration || '10',
            });
          }
          break;
        }
        case 'modify-image': {
          const { modifyType, description, currentPrompt, currentStyle } = actionResult.params;
          let newPrompt = currentPrompt;
          let newStyle = currentStyle;

          if (modifyType === 'background') {
            newPrompt = description;
          } else if (modifyType === 'character') {
            newPrompt = description;
          } else if (modifyType === 'style') {
            newStyle = extractStyle(description);
            newPrompt = description;
          }

          await generateImageAction({
            prompt: newPrompt || currentPrompt,
            style: newStyle || 'realistic',
          });
          break;
        }
        case 'remove-bg': {
          await generateImageAction(actionResult.params);
          break;
        }
        case 'compose': {
          await generateImageAction(actionResult.params);
          break;
        }
        case 'general': {
          // 通用问答类指令（天气、时间、常识等），后端已返回回复内容，无需执行创作流程
          break;
        }
      }
    } catch (error) {
      clearInterval(thinkingTimer);
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      if ((error as Error).name === 'AbortError') return;
      console.error('处理请求异常:', error);
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: '抱歉，处理请求时发生了错误，请稍后重试。',
        timestamp: Date.now(),
      }]);
    } finally {
      clearInterval(thinkingTimer);
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      setIsTyping(false);
      // 当前任务完成，自动消费队列中的下一个消息
      processNextInQueue();
    }
  }

  async function handleImageUploaded(imageUrl: string) {
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `上传了图片，将根据图片内容生成视频`,
      actionType: 'video',
      timestamp: Date.now(),
      generatedImage: imageUrl,
    };

    setMessages(prev => [...prev, userMessage]);
    setImageContext({
      prompt: '根据上传图片生成视频',
      style: 'realistic',
      imageUrl,
    });

    // 上传图片后自动走图生视频流程
    await handleGenerateVideoFromImage(imageUrl);
  }

  async function handleGenerateVideoFromImage(imageUrl: string) {
    const loadingId = `loading-${Date.now()}`;
    const controller = new AbortController();
    activeTasksRef.current.set(loadingId, controller);
    setMessages(prev => [...prev, {
      id: loadingId,
      role: 'assistant',
      content: '📹 正在分析图片并生成视频...',
      actionType: 'video',
      isGenerating: true,
      progress: 0,
      timestamp: Date.now(),
    }]);

    try {
      const response = await fetch('/api/upload/image/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          style: 'realistic',
          duration: '10',
        }),
        signal: controller.signal,
      });

      // 安全解析响应，避免空响应体报错
      const responseText = await response.text();
      let data;
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        data = {};
      }

      if (data.success && data.taskId) {
        // 异步模式：轮询任务状态
        await pollVideoStatus(data.taskId, loadingId, {
          prompt: data.description || '根据图片生成视频',
          style: 'realistic',
          duration: '10',
        }, controller);
      } else if (data.success && data.videoUrl) {
        // 兼容旧模式
        setVideoContext({
          prompt: '根据图片生成视频',
          style: 'realistic',
          duration: '10',
          videoUrl: data.videoUrl,
        });
        activeTasksRef.current.delete(loadingId);
        setMessages(prev => prev.map(m => {
          if (m.id === loadingId) {
            return {
              ...m,
              content: '✅ 视频生成成功！你可以继续修改这个视频。',
              generatedVideo: data.videoUrl,
              isGenerating: false,
              originalPrompt: data.description || '根据图片生成视频',
              modifyHistory: [],
            };
          }
          return m;
        }));
      } else {
        activeTasksRef.current.delete(loadingId);
        setMessages(prev => prev.map(m => {
          if (m.id === loadingId) {
            return {
              ...m,
              content: `❌ 图片生成视频失败: ${data.error || '未知错误'}`,
              isGenerating: false,
            };
          }
          return m;
        }));
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        activeTasksRef.current.delete(loadingId);
        return;
      }
      activeTasksRef.current.delete(loadingId);
      setMessages(prev => prev.map(m => {
        if (m.id === loadingId) {
          return {
            ...m,
            content: `❌ 图片生成视频异常: ${(error as Error).message}`,
            isGenerating: false,
          };
        }
        return m;
      }));
    }

    setShowUploader(false);
  }

  function toggleThoughts(messageId: string) {
    setExpandedThoughts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
      }
      return newSet;
    });
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  function getAgentColor(agentName: string): string {
    const colors: Record<string, string> = {
      '故事创作专家': 'bg-blue-100 text-blue-800',
      '视频制作专家': 'bg-green-100 text-green-800',
      '图像创作专家': 'bg-purple-100 text-purple-800',
    };
    return colors[agentName] || 'bg-gray-100 text-gray-800';
  }

  return (
    <div className="flex h-full bg-gray-50">
      <ChatHistory
        currentSessionId={currentSession?.id || null}
        onSelectSession={handleSelectSession}
        onCreateSession={createNewSession}
        onSessionDeleted={handleSessionDeleted}
        sessionListVersion={sessionListVersion}
      />
      <div className="flex-1 flex flex-col h-full bg-gray-50">
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-purple-600" />
            <h1 className="text-lg font-semibold text-gray-800">AI 创意助手</h1>
            {currentSession && (
              <span className="text-xs text-gray-400">- {currentSession.title}</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setUseMock(!useMock)}
              className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                useMock ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {useMock ? 'Mock 模式' : '真实模式'}
            </button>
            <button
              onClick={createNewSession}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="新建会话"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map(message => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                message.role === 'user'
                  ? 'bg-purple-600 text-white rounded-br-md'
                  : 'bg-white text-gray-800 rounded-bl-md shadow-sm'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-gray-500">
                  {message.role === 'user' ? '你' : 'AI助手'}
                </span>
                <span className="text-xs text-gray-400">
                  {formatTime(message.timestamp)}
                </span>
              </div>
              
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>

              {message.generatedImage && (
                <div className="mt-3 rounded-lg overflow-hidden border border-gray-200">
                  <img
                    src={message.generatedImage}
                    alt="Generated"
                    className="w-full h-auto max-h-64 object-contain"
                  />
                  <div className="p-3 bg-gray-50 border-t border-gray-200">
                    <div className="flex gap-2 mb-2 flex-wrap">
                      <button
                        onClick={() => {
                          setModifyInputId(modifyInputId === message.id ? null : message.id);
                          setModifyInput('');
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                      >
                        <Wand2 className="w-3 h-3" />
                        修改图片
                      </button>
                      {/* 引用外部图片链接进行修改 */}
                      <button
                        onClick={() => {
                          setModifyInputId(modifyInputId === message.id ? null : message.id);
                          setModifyInput('');
                          setModifyRefImageUrl(modifyRefImageUrl === message.id ? null : message.id);
                        }}
                        className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                          modifyRefImageUrl === message.id
                            ? 'bg-blue-600 text-white'
                            : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
                        }`}
                      >
                        <LinkIcon className="w-3 h-3" />
                        引用外部图片
                      </button>
                      <button
                        onClick={() => {
                          const a = document.createElement('a');
                          a.href = message.generatedImage!;
                          a.download = `image-${message.id}.png`;
                          a.click();
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        下载
                      </button>
                    </div>
                    {/* 引用外部图片 URL 输入 */}
                    {modifyRefImageUrl === message.id && (
                      <div className="mb-2">
                        <div className="flex items-center gap-1 mb-1">
                          <LinkIcon className="w-3 h-3 text-blue-500" />
                          <span className="text-xs text-blue-600">粘贴外部图片链接进行修改</span>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={refImageUrlInput}
                            onChange={(e) => setRefImageUrlInput(e.target.value)}
                            placeholder="粘贴图片 URL，如 https://example.com/image.jpg"
                            className="flex-1 px-3 py-1.5 text-xs border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                          <button
                            onClick={() => {
                              if (!refImageUrlInput.trim()) return;
                              // 将外部图片 URL 作为参考图，发起修改
                              modifyImageAction(
                                message.id,
                                `参考图: ${refImageUrlInput.trim()}`,
                                modifyInput.trim() || '根据参考图风格重新生成',
                                (message.params?.style) || 'realistic',
                                refImageUrlInput.trim(),
                              );
                              setRefImageUrlInput('');
                              setModifyRefImageUrl(null);
                            }}
                            disabled={!refImageUrlInput.trim()}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                          >
                            引用并生成
                          </button>
                        </div>
                        {refImageUrlInput.trim() && /^https?:\/\/.*\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(refImageUrlInput.trim()) && (
                          <img
                            src={refImageUrlInput.trim()}
                            alt="预览"
                            className="mt-2 w-24 h-24 object-cover rounded-lg border border-blue-200"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        )}
                      </div>
                    )}
                    {modifyInputId === message.id && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={modifyInput}
                          onChange={(e) => setModifyInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && modifyInput.trim()) {
                              modifyImageAction(message.id, message.originalPrompt || '', modifyInput.trim(), (message.params?.style) || 'realistic');
                            }
                          }}
                          placeholder="输入你的修改需求，例如：把背景换成夜晚..."
                          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                        <button
                          onClick={() => modifyInput.trim() && modifyImageAction(message.id, message.originalPrompt || '', modifyInput.trim(), (message.params?.style) || 'realistic')}
                          disabled={!modifyInput.trim()}
                          className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                          发送
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {message.generatedVideo && (
                <div className="mt-3 rounded-lg overflow-hidden border border-gray-200">
                  <video
                    src={message.generatedVideo}
                    controls
                    className="w-full max-h-64"
                  />
                  <div className="p-3 bg-gray-50 border-t border-gray-200">
                    <div className="flex gap-2 mb-2">
                      <button
                        onClick={() => {
                          setModifyInputId(modifyInputId === message.id ? null : message.id);
                          setModifyInput('');
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                      >
                        <Wand2 className="w-3 h-3" />
                        修改视频
                      </button>
                      <button
                        onClick={() => {
                          const a = document.createElement('a');
                          a.href = message.generatedVideo!;
                          a.download = `video-${message.id}.mp4`;
                          a.click();
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                      >
                        <Download className="w-3 h-3" />
                        下载
                      </button>
                    </div>
                    {modifyInputId === message.id && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={modifyInput}
                          onChange={(e) => setModifyInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && modifyInput.trim()) {
                              modifyVideoAction(message.id, message.originalPrompt || '', modifyInput.trim(), (message.params?.style) || 'realistic', (message.params?.duration) || '10');
                            }
                          }}
                          placeholder="输入你的修改需求，例如：让画面更明亮，增加动态效果..."
                          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                        <button
                          onClick={() => modifyInput.trim() && modifyVideoAction(message.id, message.originalPrompt || '', modifyInput.trim(), (message.params?.style) || 'realistic', (message.params?.duration) || '10')}
                          disabled={!modifyInput.trim()}
                          className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                          发送
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Agent 思考流程 — 默认展开展示每个 Agent 的思考过程 */}
              {message.agentThoughts && message.agentThoughts.length > 0 && (
                <div className="mt-3 border border-purple-200 rounded-xl overflow-hidden bg-white">
                  <div className="px-3 py-2 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100 flex items-center gap-2">
                    <Brain className="w-4 h-4 text-purple-500" />
                    <span className="text-xs font-semibold text-purple-700">AI 思考过程</span>
                    <span className="text-[10px] text-purple-400 ml-auto">{message.agentThoughts.length} 个步骤</span>
                  </div>
                  <div className="p-3 space-y-2">
                    {message.agentThoughts.map((thought, index) => {
                      const isLast = index === message.agentThoughts!.length - 1;
                      const isComplete = thought.action === 'script_generated' || thought.action === 'parameters_extracted';
                      const stepColor = isComplete ? 'border-green-200 bg-green-50/50' : 'border-blue-200 bg-blue-50/50';
                      const dotColor = isComplete ? 'bg-green-500' : 'bg-blue-500';
                      const stepLabel = index === 0 ? '理解需求' : index === message.agentThoughts!.length - 1 ? '输出结果' : '分析处理';

                      return (
                        <div key={index} className="flex gap-2.5">
                          {/* 左侧步骤指示器 */}
                          <div className="flex flex-col items-center pt-0.5">
                            <div className={`w-5 h-5 rounded-full ${dotColor} flex items-center justify-center text-white text-[10px] font-bold shadow-sm`}>
                              {index + 1}
                            </div>
                            {!isLast && <div className="w-0.5 flex-1 min-h-[16px] bg-gradient-to-b from-gray-200 to-gray-100 my-0.5" />}
                          </div>
                          {/* 右侧步骤内容 */}
                          <div className={`flex-1 p-2.5 rounded-lg border ${stepColor} transition-colors`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${getAgentColor(thought.agentName)}`}>
                                {thought.agentName}
                              </span>
                              <span className="text-[10px] text-gray-400">{stepLabel}</span>
                            </div>
                            <p className="text-xs text-gray-700 leading-relaxed">{thought.thought}</p>
                            {thought.output && (
                              <div className="mt-1.5 pt-1.5 border-t border-gray-100">
                                <p className="text-[11px] text-gray-500 font-mono whitespace-pre-wrap break-all line-clamp-3">
                                  {thought.output}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 🧠 推理模型的深度思考链（DeepSeek-R1 / GLM-Z1 的 chain-of-thought） */}
              {message.reasoning && (
                <div className="mt-3">
                  <button
                    onClick={() => toggleThoughts(`reasoning-${message.id}`)}
                    className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition-colors font-medium"
                  >
                    {expandedThoughts.has(`reasoning-${message.id}`) ? (
                      <>
                        <ChevronUp className="w-4 h-4" />
                        收起推理过程
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" />
                        🧠 查看推理模型深度思考过程
                      </>
                    )}
                  </button>

                  {expandedThoughts.has(`reasoning-${message.id}`) && (
                    <div className="mt-2 p-4 bg-gradient-to-br from-amber-50 to-orange-50 rounded-lg border border-amber-200">
                      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-amber-200">
                        <div className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center">
                          <Brain className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div>
                          <span className="text-sm font-semibold text-amber-800">
                            {message.modelUsed === 'reasoning' ? '推理模型 Chain-of-Thought' : 'AI 分析过程'}
                          </span>
                          <span className="ml-2 text-xs text-amber-500 font-mono">
                            {message.modelUsed === 'reasoning' ? 'DeepSeek-R1 / GLM-Z1' : '指令模型'}
                          </span>
                        </div>
                      </div>
                      <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-80 overflow-y-auto font-mono text-xs">
                        {formatReasoningDisplay(parseReasoningSteps(message.reasoning), message.modelUsed || 'reasoning')}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-md shadow-sm">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        
        {showUploader && (
          <div className="mt-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <Upload className="w-4 h-4" />
                上传图片制作视频
              </h3>
              <button 
                onClick={() => setShowUploader(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ImageUploader 
              onImageUploaded={handleImageUploaded}
              onGenerateVideo={handleGenerateVideoFromImage}
            />
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 bg-white border-t border-gray-200">
        {/* 任务进行中状态条 + 停止按钮 */}
        {getPendingTasks().length > 0 && (
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <RefreshCw className="w-4 h-4 text-amber-500 animate-spin flex-shrink-0" />
              <span className="text-sm text-amber-700 truncate">
                {getPendingTasks().length} 个任务进行中
                {getPendingTasks().some(t => t.actionType === 'video' && (t.progress || 0) > 0) && (
                  <span> · 视频 {getPendingTasks().find(t => t.actionType === 'video' && (t.progress || 0) > 0)?.progress}%</span>
                )}
              </span>
            </div>
            <button
              onClick={handleStopCurrentTask}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0 ml-2"
            >
              <StopCircle className="w-4 h-4" />
              停止
            </button>
          </div>
        )}

        {/* 多图附件缩略图预览 */}
        {pendingAttachmentImages.length > 0 && (
          <div className="mb-2 px-2 py-2 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-purple-700">
                📸 已附加 {pendingAttachmentImages.length} 张图片
              </span>
              <span className="text-xs text-purple-400">
                Agent 将综合分析这些图片和你的文字指令
              </span>
              <button
                onClick={clearAttachmentImages}
                className="ml-auto text-xs text-red-500 hover:underline"
              >
                清空全部
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {pendingAttachmentImages.map((url, i) => (
                <div key={i} className="relative flex-shrink-0">
                  <img
                    src={url}
                    alt={`附件 ${i + 1}`}
                    className="w-16 h-16 rounded-lg object-cover border border-purple-300"
                  />
                  <span className="absolute top-0 left-0 w-5 h-5 bg-purple-600 text-white text-xs rounded-tl-lg rounded-br-lg flex items-center justify-center font-semibold">
                    {i + 1}
                  </span>
                  <button
                    onClick={() => removeAttachmentImage(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 图片 URL 输入区域（粘贴或手动输入链接） */}
        {showImageUrlInput && (
          <div className="mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-blue-500" />
              <span className="text-xs font-medium text-blue-700">粘贴图片链接</span>
              <span className="text-xs text-blue-400">支持 jpg/png/gif/webp/bmp</span>
              <button
                onClick={() => { setShowImageUrlInput(false); setImageUrlInput(''); setUrlPreviewError(null); }}
                className="ml-auto text-xs text-gray-400 hover:text-gray-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={imageUrlInput}
                onChange={(e) => { setImageUrlInput(e.target.value); setUrlPreviewError(null); }}
                onKeyDown={handleImageUrlKeyDown}
                onPaste={handleInputPaste}
                placeholder="粘贴图片 URL，按 Enter 添加..."
                className="flex-1 px-3 py-1.5 text-sm border border-blue-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                autoFocus
              />
              <button
                onClick={() => addImageByUrl(imageUrlInput)}
                disabled={!imageUrlInput.trim()}
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                  imageUrlInput.trim()
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                添加
              </button>
            </div>
            {urlPreviewError && (
              <p className="mt-1.5 text-xs text-red-500">{urlPreviewError}</p>
            )}
          </div>
        )}

        {/* 消息等待队列面板 */}
        {messageQueue.length > 0 && (
          <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium text-blue-700">
                等待队列 ({messageQueue.length})
              </span>
              <span className="text-xs text-blue-400">
                当前任务完成后自动执行
              </span>
            </div>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {messageQueue.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 px-2 py-1.5 bg-white rounded border border-blue-100 group"
                >
                  <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                    {index + 1}
                  </span>
                  <span className="text-sm text-gray-600 truncate flex-1">{item.text}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {Math.floor((Date.now() - item.timestamp) / 1000) < 60
                      ? '刚刚'
                      : `${Math.floor((Date.now() - item.timestamp) / 60000)}分钟前`}
                  </span>
                  <button
                    onClick={() => removeFromQueue(item.id)}
                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                    title="移除此任务"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <div className="flex gap-2">
            {/* 多图附件按钮 — 支持多选，与文字一起发送 */}
            <div className="relative group">
              <input
                ref={multiFileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleAttachmentFiles}
                className="hidden"
              />
              <button
                onClick={() => multiFileInputRef.current?.click()}
                className={`p-2 rounded-lg transition-colors ${
                  pendingAttachmentImages.length > 0 ? 'text-purple-600 bg-purple-50' : 'text-gray-500 hover:text-purple-600 hover:bg-purple-50'
                }`}
                title="附加多张图片（可多选），与文字一起发送"
              >
                <Image className="w-5 h-5" />
                {pendingAttachmentImages.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-purple-600 text-white text-[10px] rounded-full flex items-center justify-center font-semibold">
                    {pendingAttachmentImages.length}
                  </span>
                )}
              </button>
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                多图+文字混合发送
              </div>
            </div>
            {/* 粘贴图片链接按钮 */}
            <div className="relative group">
              <button
                onClick={() => setShowImageUrlInput(!showImageUrlInput)}
                className={`p-2 rounded-lg transition-colors ${
                  showImageUrlInput ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'
                }`}
                title="粘贴图片链接（支持 Ctrl+V 粘贴截图或图片 URL）"
              >
                <LinkIcon className="w-5 h-5" />
              </button>
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                粘贴图片链接
              </div>
            </div>
            <div className="relative group">
              <button
                onClick={() => setShowUploader(!showUploader)}
                className={`p-2 rounded-lg transition-colors ${
                  showUploader ? 'text-purple-600 bg-purple-50' : 'text-gray-500 hover:text-purple-600 hover:bg-purple-50'
                }`}
              >
                <Upload className="w-5 h-5" />
              </button>
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                上传图片制作视频
              </div>
            </div>
          </div>
          <div className="flex-1 relative">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              onPaste={handleInputPaste}
              placeholder={
                abortCooldown > 0
                  ? `任务终止冷却中，请等待 ${abortCooldown} 秒...`
                  : '输入需求，或 Ctrl+V 粘贴截图/图片链接...'
              }
              className={`w-full px-4 py-2.5 border-none rounded-full focus:outline-none focus:ring-2 transition-all ${
                abortCooldown > 0
                  ? 'bg-orange-50 focus:ring-orange-400 text-gray-400'
                  : 'bg-gray-100 focus:ring-purple-500'
              }`}
              disabled={isTyping || abortCooldown > 0}
            />
            {abortCooldown > 0 && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-orange-500">
                {abortCooldown}s
              </div>
            )}
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping || abortCooldown > 0}
            className={`p-2.5 rounded-full transition-all ${
              input.trim() && !isTyping && abortCooldown === 0
                ? 'bg-purple-600 text-white hover:bg-purple-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center justify-center gap-4 mt-2">
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Users className="w-3 h-3" />
            <span>多Agent协作</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Eye className="w-3 h-3" />
            <span>可查看思考流程</span>
          </div>
        </div>
      </div>
      </div>

      {/* 未完成任务提示模态框 */}
      {showPendingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2">
              {pendingModalMode === 'stop' ? (
                <StopCircle className="w-5 h-5 text-red-500" />
              ) : pendingModalMode === 'timeout' ? (
                <span className="text-xl">⏰</span>
              ) : (
                <RefreshCw className="w-5 h-5 text-orange-500" />
              )}
              <h3 className="text-base font-semibold text-gray-800">
                {pendingModalMode === 'stop' ? '停止当前任务' 
                 : pendingModalMode === 'timeout' ? '任务执行时间较长'
                 : '检测到未完成的任务'}
              </h3>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-64 overflow-y-auto">
              <p className="text-sm text-gray-500">
                {pendingModalMode === 'stop'
                  ? `你有 ${getPendingTasks().length} 个正在进行的任务：`
                  : pendingModalMode === 'timeout'
                    ? `以下 ${getPendingTasks().length} 个任务已持续较长时间，请选择：`
                    : `你有 ${getPendingTasks().length} 个正在进行的任务，请选择处理方式：`}
              </p>
              {getPendingTasks().map(task => (
                <div key={task.id} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">
                      {task.actionType === 'video' ? '📹 视频生成' : '🎨 图片生成'}
                    </span>
                    <span className="text-xs text-gray-400">{estimateRemainingTime(task)}</span>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2 mb-2">{task.content}</p>
                  {task.actionType === 'video' && task.progress !== undefined && task.progress > 0 && (
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div
                        className="bg-purple-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  )}
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={() => abortTask(task.id)}
                      className="text-xs text-red-500 hover:text-red-700 hover:underline"
                    >
                      终止此任务
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={handleWaitPendingTasks}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                等待任务完成
              </button>
              <button
                onClick={handleAbortAndContinue}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
              >
                {pendingModalMode === 'stop' ? '终止全部任务' : '终止全部并发送'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}