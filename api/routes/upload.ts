import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { analyzeImage } from '../services/imageService.js';
import { createVideoTaskAsync } from './video.js';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const uploadsPath = join(__dirname, '../public/uploads');
if (!existsSync(uploadsPath)) {
  mkdirSync(uploadsPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = file.originalname.split('.').pop();
    cb(null, `upload_${uniqueSuffix}.${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/gif'];
    const allowedVideoTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
    if (allowedImageTypes.includes(file.mimetype) || allowedVideoTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持图片和视频文件'));
    }
  },
});

router.post('/image', upload.single('image'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: '请上传图片文件',
      });
      return;
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    console.log(`[Upload] Image uploaded: ${imageUrl}`);

    res.json({
      success: true,
      imageUrl,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (error) {
    console.error('[Upload] Image upload error:', error);
    res.status(500).json({
      success: false,
      error: `图片上传失败: ${(error as Error).message}`,
    });
  }
});

router.post('/image/video', async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageUrl, style = 'realistic', duration = '10' } = req.body;

    if (!imageUrl) {
      res.status(400).json({
        success: false,
        error: '请提供图片地址',
      });
      return;
    }

    console.log(`[Upload] Image to video: ${imageUrl}, style=${style}, duration=${duration}`);

    const analysisResult = await analyzeImage({ imagePath: imageUrl });

    if (!analysisResult.success || !analysisResult.description) {
      res.status(500).json({
        success: false,
        error: '图片分析失败',
      });
      return;
    }

    console.log(`[Upload] Image analyzed: ${analysisResult.description.substring(0, 50)}...`);

    const videoPrompt = `${analysisResult.description}。风格：${style}。时长：${duration}秒。请生成一段与之匹配的视频。`;

    // 异步创建视频任务（立即返回 taskId，避免同步等待导致 HTTP 请求超时）
    const result = await createVideoTaskAsync(videoPrompt, style, duration, true);

    console.log(`[Upload] Video task created: success=${result.success}, taskId=${result.taskId}`);

    res.json({
      ...result,
      imageUrl,
      description: analysisResult.description,
    });
  } catch (error) {
    console.error('[Upload] Image to video error:', error);
    res.status(500).json({
      success: false,
      error: `图片转视频失败: ${(error as Error).message}`,
    });
  }
});

// 本地视频上传：用于视频拼接功能，用户可上传本地视频文件
router.post('/video', upload.single('video'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: '请上传视频文件',
      });
      return;
    }

    const videoUrl = `/uploads/${req.file.filename}`;
    console.log(`[Upload] Video uploaded: ${videoUrl}, size=${req.file.size}`);

    res.json({
      success: true,
      videoUrl,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (error) {
    console.error('[Upload] Video upload error:', error);
    res.status(500).json({
      success: false,
      error: `视频上传失败: ${(error as Error).message}`,
    });
  }
});

export default router;