import { Router, type Request, type Response } from 'express';
import { recognizeText, batchRecognizeText } from '../services/ocrService.js';

const router = Router();

/** 单张图片文字识别 */
router.post('/recognize', async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageUrl, format } = req.body;

    if (!imageUrl) {
      res.status(400).json({ success: false, error: 'imageUrl is required' });
      return;
    }

    console.log(`[OCR Route] Single image, format=${format || 'text'}`);
    const result = await recognizeText({ imageUrl, format: format || 'text' });
    res.json(result);
  } catch (error) {
    console.error('[OCR Route] Error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** 批量图片文字识别 */
router.post('/batch-recognize', async (req: Request, res: Response): Promise<void> => {
  try {
    const { images, format } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      res.status(400).json({ success: false, error: 'images array is required' });
      return;
    }

    console.log(`[OCR Route] Batch: ${images.length} images, format=${format || 'text'}`);
    const requests = images.map((img: string) => ({ imageUrl: img, format: format || 'text' }));
    const results = await batchRecognizeText(requests);
    res.json({ success: true, results });
  } catch (error) {
    console.error('[OCR Route] Batch Error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
