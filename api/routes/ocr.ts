import { Router, type Request, type Response } from 'express';
import { analyzeImageWithText } from '../services/imageService.js';

const router = Router();

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

/** 单张图片 OCR 识别核心逻辑 */
async function recognizeSingleImage(imageUrl: string) {
  // 截断日志中的 base64 数据避免日志过长
  const logUrl = imageUrl.startsWith('data:')
    ? `data:image/... (base64, ${imageUrl.length} chars)`
    : imageUrl.substring(0, 80);
  console.log(`[OCR] glm-4v-flash 识别图片文字: ${logUrl}`);

  const result = await analyzeImageWithText({
    imageUrl,
    message: OCR_PROMPT,
  });

  if (!result.success) {
    const errorMsg = result.error || 'OCR识别失败';
    // 如果是远程图片下载失败，给出更友好的提示
    if (errorMsg === '无法读取图片文件' && imageUrl.startsWith('http')) {
      return {
        success: false,
        error: '无法下载远程图片，请尝试将图片保存到本地后上传，或检查图片链接是否可公开访问',
      };
    }
    return { success: false, error: errorMsg };
  }

  const description = result.description || '';
  const jsonStr = extractJson(description);

  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      console.log(`[OCR] 识别成功: ${parsed.language || '?'} | ${parsed.totalChars || 0}字 | ${parsed.tables?.length || 0}个表格`);
      return { success: true, result: parsed, model: 'glm-4v-flash' };
    } catch (parseErr) {
      console.warn('[OCR] JSON解析失败，尝试修复:', (parseErr as Error).message);
    }
  }

  // 回退：返回纯文本
  return {
    success: true,
    result: {
      hasText: true,
      language: 'auto',
      fullText: description || '未能识别文字内容',
      textBlocks: [],
      tables: [],
      totalChars: (description || '').length,
      summary: 'OCR识别结果（纯文本格式）',
    },
    model: 'glm-4v-flash',
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
