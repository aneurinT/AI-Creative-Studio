import { create } from 'zustand'

interface ImageModel {
  id: string
  name: string
  description: string
  requiresKey: boolean
}

interface HistoryItem {
  id: string
  prompt: string
  style: string
  imageUrl: string
  createdAt: string
}

interface ImageStore {
  prompt: string
  selectedStyle: string
  selectedModel: string
  selectedSize: string
  models: ImageModel[]
  generatedImage: string | null
  caption: string | null
  isGenerating: boolean
  isGeneratingCaption: boolean
  error: string | null
  history: HistoryItem[]

  setPrompt: (prompt: string) => void
  setSelectedStyle: (style: string) => void
  setSelectedModel: (model: string) => void
  setSelectedSize: (size: string) => void
  fetchModels: () => Promise<void>
  generateImage: () => Promise<void>
  generateCaption: () => Promise<void>
  fetchHistory: () => Promise<void>
  deleteHistoryItem: (id: string) => Promise<void>
}

const STYLES = [
  { id: 'realistic', name: '写实风格' },
  { id: 'cartoon', name: '卡通风格' },
  { id: 'anime', name: '动漫风格' },
  { id: 'oil-painting', name: '油画风格' },
  { id: 'watercolor', name: '水彩风格' },
  { id: 'cyberpunk', name: '赛博朋克' },
  { id: '3d-render', name: '3D渲染' },
  { id: 'sketch', name: '素描风格' },
]

export const useImageStore = create<ImageStore>((set, get) => ({
  prompt: '',
  selectedStyle: 'realistic',
  selectedModel: 'trae',
  selectedSize: 'landscape_16_9',
  models: [],
  generatedImage: null,
  caption: null,
  isGenerating: false,
  isGeneratingCaption: false,
  error: null,
  history: [],

  setPrompt: (prompt) => set({ prompt }),
  setSelectedStyle: (style) => set({ selectedStyle: style }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setSelectedSize: (size) => set({ selectedSize: size }),

  fetchModels: async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/generate/models', { headers })
      const data = await res.json()
      if (data.success) {
        set({ models: data.models })
      }
    } catch (err) {
      console.error('Failed to fetch models:', err)
    }
  },

  generateImage: async () => {
    const { prompt, selectedStyle, selectedModel, selectedSize } = get()
    if (!prompt.trim()) {
      set({ error: '请输入图片描述' })
      return
    }

    set({ isGenerating: true, error: null, generatedImage: null, caption: null })

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          style: selectedStyle,
          model: selectedModel,
          size: selectedSize,
        }),
      })
      const data = await res.json()

      if (data.success && data.imageUrl) {
        set({ generatedImage: data.imageUrl, isGenerating: false })
        get().generateCaption()
        get().fetchHistory()
      } else {
        set({ error: data.error || '生成失败', isGenerating: false })
      }
    } catch (err) {
      set({ error: '网络错误，请重试', isGenerating: false })
    }
  },

  generateCaption: async () => {
    const { prompt, selectedStyle } = get()
    if (!prompt.trim()) return

    set({ isGeneratingCaption: true })

    try {
      const res = await fetch('/api/generate/caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          style: selectedStyle,
        }),
      })
      const data = await res.json()

      if (data.success && data.caption) {
        set({ caption: data.caption, isGeneratingCaption: false })
      } else {
        set({ isGeneratingCaption: false })
      }
    } catch (err) {
      set({ isGeneratingCaption: false })
    }
  },

  fetchHistory: async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/history', { headers })
      const data = await res.json()
      if (data.success) {
        set({ history: data.history })
      }
    } catch (err) {
      console.error('Failed to fetch history:', err)
    }
  },

  deleteHistoryItem: async (id: string) => {
    try {
      await fetch(`/api/history/${id}`, { method: 'DELETE' })
      set({ history: get().history.filter((item) => item.id !== id) })
    } catch (err) {
      console.error('Failed to delete history:', err)
    }
  },
}))

export { STYLES }
