/**
 * AI 视频剪辑路由 (AI Video Editing Routes)
 *
 * 提供视频上传、AI 智能剪辑、字幕生成、配音合成等 API 端点。
 * 双方案：AI 大模型优先 → 本地插件回退
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { videoEditService, type EditOperation, type EditParams } from '../services/videoEditService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// 上传目录
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'videos');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 配置 multer
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `video_${Date.now()}_${Math.random().toString(36).substring(2, 6)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}，仅支持 ${allowed.join(', ')}`));
    }
  },
});

// ==================== 视频上传 ====================

/** POST /api/video-edit/upload — 上传视频 */
router.post('/upload', upload.single('video'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: '请上传视频文件' });
    return;
  }

  const videoUrl = `/uploads/videos/${req.file.filename}`;
  res.json({
    success: true,
    data: {
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      url: videoUrl,
      path: req.file.path,
    },
  });
});

// ==================== 工具检查 ====================

/** GET /api/video-edit/tools — 检查本地工具可用性 */
router.get('/tools', async (_req: Request, res: Response) => {
  try {
    const tools = await videoEditService.checkTools();
    res.json({ success: true, data: tools });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 剪辑任务 ====================

/** POST /api/video-edit/task — 创建并执行剪辑任务 */
router.post('/task', async (req: Request, res: Response) => {
  const { videoPath, operations, params } = req.body as {
    videoPath: string;
    operations: EditOperation[];
    params: EditParams;
  };

  if (!videoPath || !fs.existsSync(videoPath)) {
    res.status(400).json({ success: false, error: '视频文件不存在' });
    return;
  }

  if (!operations || !Array.isArray(operations) || operations.length === 0) {
    res.status(400).json({ success: false, error: 'operations is required (non-empty array)' });
    return;
  }

  const validOps: EditOperation[] = ['trim', 'split', 'merge', 'subtitle', 'dubbing', 'replace-segment', 'smart-edit', 'scene-detect'];
  for (const op of operations) {
    if (!validOps.includes(op)) {
      res.status(400).json({ success: false, error: `不支持的操作: ${op}` });
      return;
    }
  }

  try {
    const task = videoEditService.createTask(videoPath, operations, params || {});

    // 异步执行任务
    videoEditService.executeTask(task.id).catch((err) => {
      console.error(`[VideoEdit Route] Task ${task.id} failed:`, err.message);
    });

    res.status(201).json({
      success: true,
      data: {
        taskId: task.id,
        status: task.status,
        operations: task.operations,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /api/video-edit/task/:id — 获取任务状态 */
router.get('/task/:id', (req: Request, res: Response) => {
  const task = videoEditService.getTask(req.params.id);
  if (!task) {
    res.status(404).json({ success: false, error: '任务不存在' });
    return;
  }

  res.json({
    success: true,
    data: {
      id: task.id,
      status: task.status,
      progress: task.progress,
      operations: task.operations,
      result: task.result,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
  });
});

/** GET /api/video-edit/tasks — 获取所有任务 */
router.get('/tasks', (_req: Request, res: Response) => {
  const tasks = videoEditService.getAllTasks();
  res.json({
    success: true,
    data: tasks.map(t => ({
      id: t.id,
      status: t.status,
      progress: t.progress,
      operations: t.operations,
      createdAt: t.createdAt,
    })),
  });
});

// ==================== 快速操作（同步返回结果） ====================

/** POST /api/video-edit/scene-detect — 场景检测 */
router.post('/scene-detect', async (req: Request, res: Response) => {
  const { videoPath, prompt } = req.body as { videoPath: string; prompt?: string };

  if (!videoPath || !fs.existsSync(videoPath)) {
    res.status(400).json({ success: false, error: '视频文件不存在' });
    return;
  }

  try {
    const task = videoEditService.createTask(videoPath, ['scene-detect'], { smartEditPrompt: prompt });
    const result = await videoEditService.executeTask(task.id);
    res.json({
      success: true,
      data: {
        scenes: result.scenes || [],
        videoInfo: {
          duration: result.duration,
          fileSize: result.fileSize,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/video-edit/subtitle — 生成字幕 */
router.post('/subtitle', async (req: Request, res: Response) => {
  const { videoPath, lang } = req.body as { videoPath: string; lang?: string };

  if (!videoPath || !fs.existsSync(videoPath)) {
    res.status(400).json({ success: false, error: '视频文件不存在' });
    return;
  }

  try {
    const task = videoEditService.createTask(videoPath, ['subtitle'], { subtitleLang: lang || 'zh', autoSubtitle: true });
    const result = await videoEditService.executeTask(task.id);
    res.json({
      success: true,
      data: {
        subtitles: result.subtitles || [],
        outputUrl: result.outputUrl,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/video-edit/dubbing — 生成配音 */
router.post('/dubbing', async (req: Request, res: Response) => {
  const { videoPath, text, voice, speed } = req.body as {
    videoPath: string;
    text: string;
    voice?: string;
    speed?: number;
  };

  if (!videoPath || !fs.existsSync(videoPath)) {
    res.status(400).json({ success: false, error: '视频文件不存在' });
    return;
  }

  if (!text) {
    res.status(400).json({ success: false, error: '配音文本不能为空' });
    return;
  }

  try {
    const task = videoEditService.createTask(videoPath, ['dubbing'], {
      dubbingText: text,
      dubbingVoice: voice || 'zh-CN-XiaoxiaoNeural',
      dubbingSpeed: speed || 1.0,
    });
    const result = await videoEditService.executeTask(task.id);
    res.json({
      success: true,
      data: {
        outputUrl: result.outputUrl,
        duration: result.duration,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;