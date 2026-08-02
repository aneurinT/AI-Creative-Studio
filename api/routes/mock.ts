import { Router, type Request, type Response } from 'express'
import fs from 'fs'
import path from 'path'

const router = Router()

const MOCK_IMAGES: Record<string, string> = {
  cat: '/images/mock-cat.png',
  forest: '/images/mock-forest.png',
  anime_cat: '/images/mock-anime-cat.png',
  knight: '/images/mock-knight.png',
  space: '/images/mock-space.png',
  ocean: '/images/mock-ocean.png',
}

const MOCK_VIDEOS: string[] = [
  '/images/1784735812800.mp4',
  '/images/1784737240995.mp4',
  '/images/1784737544080.mp4',
  '/images/1784765565898.mp4',
  '/images/1784777375551.mp4',
  '/images/1784778667411.mp4',
  '/images/1784779720276.mp4',
  '/images/1784785711481.mp4',
];

router.post('/generate', async (req: Request, res: Response): Promise<void> => {
  const { prompt, style } = req.body
  
  console.log(`[Mock] Generate image: prompt="${prompt}", style="${style}"`)
  
  let mockKey = 'cat'
  
  if (prompt.includes('动漫') || prompt.includes('anime') || style === 'anime') {
    mockKey = 'anime_cat'
  } else if (prompt.includes('森林') || prompt.includes('forest') || prompt.includes('背景') || prompt.includes('场景')) {
    mockKey = 'forest'
  } else if (prompt.includes('骑士') || prompt.includes('knight') || prompt.includes('人物') || prompt.includes('角色') || prompt.includes('着装')) {
    mockKey = 'knight'
  } else if (prompt.includes('太空') || prompt.includes('space') || prompt.includes('宇宙') || prompt.includes('星空')) {
    mockKey = 'space'
  } else if (prompt.includes('海洋') || prompt.includes('ocean') || prompt.includes('海') || prompt.includes('海滩')) {
    mockKey = 'ocean'
  } else if (prompt.includes('猫') || prompt.includes('cat')) {
    mockKey = 'cat'
  }

  await new Promise(resolve => setTimeout(resolve, 1500))

  res.json({
    success: true,
    imageUrl: MOCK_IMAGES[mockKey] || MOCK_IMAGES.cat,
    message: 'Image generated successfully',
  })
})

router.post('/video', async (req: Request, res: Response): Promise<void> => {
  const { prompt, style, duration } = req.body
  
  console.log(`[Mock] Generate video: prompt="${prompt}", style="${style}", duration="${duration}"`)
  
  await new Promise(resolve => setTimeout(resolve, 1000))

  res.json({
    success: true,
    taskId: `task_mock_${Date.now()}`,
    message: '视频生成任务已创建，请等待生成完成',
  })
})

router.get('/video/pending/:taskId/status', async (req: Request, res: Response): Promise<void> => {
  const { taskId } = req.params
  
  console.log(`[Mock] Poll video status: taskId="${taskId}"`)
  
  await new Promise(resolve => setTimeout(resolve, 500))

  const mockVideo = MOCK_VIDEOS[Math.floor(Math.random() * MOCK_VIDEOS.length)]
  
  res.json({
    success: true,
    status: 'completed',
    videoUrl: mockVideo,
    progress: 100,
  })
})

export default router