import { Router, type Request, type Response } from 'express';
import { analyzeImageWithText } from '../services/imageService.js';

const router = Router();

/** 获取图片 base64 数据（处理各种 URL 格式） */
async function getImageBase64(imageUrl: string): Promise<{ mime: string; base64: string } | null> {
  // 直接是 base64
  if (imageUrl.startsWith('data:image/')) {
    const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (match) return { mime: match[1], base64: match[2] };
    return null;
  }
  // 远程 URL — 下载
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    try {
      const resp = await fetch(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OCRBot/1.0)' },
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) return null;
      const buf = Buffer.from(await resp.arrayBuffer());
      return { mime: 'png', base64: buf.toString('base64') };
    } catch { return null; }
  }
  // 本地文件
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const filePath = imageUrl.startsWith('/') ? path.join(__dirname, '..', imageUrl) : imageUrl;
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    return { mime: 'png', base64: buf.toString('base64') };
  } catch { return null; }
}

/** 本地 OCR 降级方案：调用 ocr.space 免费 API */
async function localOcr(imageUrl: string): Promise<{ success: boolean; result?: any; model?: string; error?: string }> {
  console.log('[OCR] 大模型不可用，降级到 ocr.space 本地识别');
  try {
    const apiKey = process.env.OCR_SPACE_API_KEY || 'helloworld';
    const resp = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { 'apikey': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ url: imageUrl, language: 'chs,eng', isOverlayRequired: 'true', OCREngine: '2' }).toString(),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return { success: false, error: `OCR工具不可用(${resp.status})` };

    const data = await resp.json() as any;
    const parsed = data?.ParsedResults?.[0];
    if (!parsed?.ParsedText?.trim()) return { success: false, error: 'OCR工具未检测到文字' };

    const text = parsed.ParsedText;
    const lines = text.split('\n').filter((l: string) => l.trim());
    const words = parsed.TextOverlay?.Lines?.flatMap((l: any) => l.Words || []) || [];

    return {
      success: true,
      model: 'ocr.space',
      result: {
        hasText: true,
        language: 'auto',
        fullText: text,
        totalChars: text.length,
        textBlocks: words.slice(0, 30).map((w: any, i: number) => ({
          position: `(${w.Left},${w.Top})`,
          type: '文字',
          text: w.WordText || '',
        })),
        tables: [],
        summary: `OCR工具识别：${lines.length}行，${text.length}字符`,
      },
    };
  } catch (err) {
    return { success: false, error: `本地OCR异常: ${(err as Error).message}` };
  }
}

const OCR_PROMPT = `你是一个专业的OCR文字识别系统，使用智谱 glm-4v-flash 视觉模型。请仔细识别图片中的所有文字内容。

## 识别要求
1. **逐字识别**：不要遗漏任何文字，包括小字、水印、标注、页眉页脚
2. **保持顺序**：按原文的阅读顺序排列（从上到下、从左到右）
3. **表格处理**：如果图片中有表格，提取为结构化表格数据
4. **列表处理**：识别有序/无序列表，保留层级关系
5. **格式标注**：标注文字类型（标题/正文/列表项/表格单元格/标注等）
6. **位置标注**：用方位标注文字在图片中的位置
7. **语言检测**：标注文字的主要语言

## 输出格式（严格JSON，不要markdown代码块包裹，直接输出纯JSON）
{
  "hasText": true,
  "language": "zh-CN",
  "title": "文档标题",
  "summary": "文档内容简要概述（50字内）",
  "totalChars": 1234,
  "tables": [
    {
      "caption": "表格标题",
      "headers": ["列1", "列2", "列3"],
      "rows": [
        ["数据1", "数据2", "数据3"],
        ["数据4", "数据5", "数据6"]
      ],
      "position": "图片中间"
    }
  ],
  "textBlocks": [
    {"position": "顶部居中", "type": "标题", "text": "文档大标题"},
    {"position": "左上角", "type": "正文", "text": "第一段正文内容..."},
    {"position": "中间偏左", "type": "列表项", "text": "列表项1"},
    {"position": "底部", "type": "标注", "text": "脚注或版权信息"}
  ],
  "fullText": "图片中所有文字的完整内容（保持原文格式和换行）"
}

## 注意事项
- 如果图片中没有文字，返回：{"hasText": false, "message": "未在图片中检测到文字内容"}
- 如果有表格，必须在 tables 数组中完整提取，包括表头和所有数据行
- fullText 字段保留原文的完整内容和格式
- 严格输出纯JSON，不要包裹在markdown代码块中`;

/** 单张图片 OCR 识别核心逻辑 — 大模型优先，失败降级到本地 OCR */
async function recognizeSingleImage(imageUrl: string) {
  const logUrl = imageUrl.startsWith('data:')
    ? `data:image/... (base64, ${imageUrl.length} chars)`
    : imageUrl.substring(0, 80);
  console.log(`[OCR] 大模型识别: ${logUrl}`);

  // 步骤1：大模型识别（glm-4v-flash）
  const result = await analyzeImageWithText({ imageUrl, message: OCR_PROMPT });

  if (result.success) {
    const description = result.description || '';
    const jsonStr = extractJson(description);

    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        console.log(`[OCR] 大模型成功: ${parsed.language || '?'} | ${parsed.totalChars || 0}字 | ${parsed.tables?.length || 0}表格`);
        return { success: true, result: parsed, model: 'glm-4v-flash' };
      } catch { /* JSON 解析失败，继续走纯文本 */ }
    }

    // 纯文本回退
    return {
      success: true,
      result: { hasText: true, language: 'auto', fullText: description, textBlocks: [], tables: [], totalChars: description.length, summary: 'OCR识别结果（纯文本）' },
      model: 'glm-4v-flash',
    };
  }

  const llmError = result.error || '大模型识别失败';
  console.warn(`[OCR] 大模型失败: ${llmError}，降级到本地OCR`);

  // 步骤2：降级到本地 OCR 工具
  const localResult = await localOcr(imageUrl);
  if (localResult.success) {
    console.log(`[OCR] 本地OCR成功: ${localResult.result?.totalChars || 0}字`);
    return localResult;
  }

  // 全部失败
  return {
    success: false,
    error: `大模型: ${llmError}; 本地OCR: ${localResult.error}`,
  };
}

/**
 * 单张图片 OCR 文字识别
 * 使用智谱 glm-4v-flash 免费视觉模型识别图片中的文字，输出 JSON 结构化数据
 */
router.post('/recognize', async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      res.status(400).json({ success: false, error: 'imageUrl is required' });
      return;
    }

    const result = await recognizeSingleImage(imageUrl);
    res.json(result);
  } catch (error) {
    console.error('[OCR] Error:', error);
    res.status(500).json({
      success: false,
      error: `OCR识别服务异常: ${(error as Error).message}`,
    });
  }
});

/**
 * 批量 OCR 文字识别
 * 支持一次上传多张图片 URL，并发识别（限制并发数为3，避免 API 限流）
 */
router.post('/recognize-batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageUrls } = req.body;

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      res.status(400).json({ success: false, error: 'imageUrls array is required' });
      return;
    }

    if (imageUrls.length > 20) {
      res.status(400).json({ success: false, error: '最多支持20张图片的批量识别' });
      return;
    }

    console.log(`[OCR-Batch] 批量识别 ${imageUrls.length} 张图片`);

    // 并发处理，限制并发数为 3
    const CONCURRENCY = 3;
    const results: Array<{ index: number; imageUrl: string; success: boolean; result?: any; error?: string; model?: string }> = new Array(imageUrls.length);

    for (let i = 0; i < imageUrls.length; i += CONCURRENCY) {
      const batch = imageUrls.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map(async (url, batchIdx) => {
          const globalIdx = i + batchIdx;
          console.log(`[OCR-Batch] 处理第 ${globalIdx + 1}/${imageUrls.length} 张...`);
          try {
            return await recognizeSingleImage(url);
          } catch (err) {
            return { success: false, error: `识别异常: ${(err as Error).message}` };
          }
        })
      );

      batchResults.forEach((settled, batchIdx) => {
        const globalIdx = i + batchIdx;
        if (settled.status === 'fulfilled') {
          results[globalIdx] = {
            index: globalIdx,
            imageUrl: imageUrls[globalIdx],
            ...settled.value,
          };
        } else {
          results[globalIdx] = {
            index: globalIdx,
            imageUrl: imageUrls[globalIdx],
            success: false,
            error: settled.reason?.message || '未知错误',
          };
        }
      });
    }

    const successCount = results.filter(r => r.success).length;
    const totalChars = results.reduce((sum, r) => {
      return sum + (r.success && r.result?.totalChars ? r.result.totalChars : 0);
    }, 0);

    console.log(`[OCR-Batch] 批量识别完成: ${successCount}/${results.length} 成功, 共 ${totalChars} 字`);

    res.json({
      success: true,
      results,
      summary: {
        total: results.length,
        successCount,
        failCount: results.length - successCount,
        totalChars,
      },
    });
  } catch (error) {
    console.error('[OCR-Batch] Error:', error);
    res.status(500).json({
      success: false,
      error: `批量OCR识别异常: ${(error as Error).message}`,
    });
  }
});

/** 从模型返回中提取纯JSON（处理可能的markdown代码块包裹） */
function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const mdMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch) {
    return mdMatch[1].trim();
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : null;
}

export default router;
