import { Router, type Request, type Response } from 'express';
import { detectStoryboard, reviewStoryboard, type StoryboardScene } from '../services/storyboardDetectorService.js';

const router = Router();

router.post('/detect', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length < 10) {
      res.status(400).json({ success: false, error: 'text required (min 10 chars)' });
      return;
    }
    const result = await detectStoryboard(text);
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Unknown' });
  }
});

router.post('/review', async (req: Request, res: Response) => {
  try {
    const { scenes } = req.body as { scenes: StoryboardScene[] };
    if (!scenes || scenes.length < 2) {
      res.status(400).json({ success: false, error: 'scenes array required (min 2)' });
      return;
    }
    const result = await reviewStoryboard(scenes);
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Unknown' });
  }
});

export default router;
