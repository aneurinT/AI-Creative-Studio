import { Router, type Request, type Response } from 'express';
import { analyzeImageWithText } from '../services/imageService.js';

const router = Router();

/**
 * OCR 文字识别 + 文档整理
 * 使用智谱 glm-4v-flash 免费视觉模型识别图片中的文字，输出 JSON 结构化数据
 */
router.post('/recognize', async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      res.status(400).json({ success: false, error: 'imageUrl is required' });
      return;
    }

    console.log(`[OCR] glm-4v-flash 识别图片文字: ${imageUrl.substring(0, 80)}...`);

    const result = await analyzeImageWithText({
      imageUrl,
      message: `你是一个专业的OCR文字识别系统，使用智谱 glm-4v-flash 视觉模型。请仔细识别图片中的所有文字内容。

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
- 严格输出纯JSON，不要包裹在markdown代码块中`,
    });

    if (!result.success) {
      res.json({ success: false, error: result.error || 'OCR识别失败' });
      return;
    }

    // 解析 glm-4v-flash 返回的结构化 JSON
    const description = result.description || '';
    const jsonStr = extractJson(description);

    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        console.log(`[OCR] 识别成功: ${parsed.language || '?'} | ${parsed.totalChars || 0}字 | ${parsed.tables?.length || 0}个表格`);
        res.json({ success: true, result: parsed, model: 'glm-4v-flash' });
        return;
      } catch (parseErr) {
        console.warn('[OCR] JSON解析失败，尝试修复:', (parseErr as Error).message);
      }
    }

    // 回退：返回纯文本
    res.json({
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
    });
  } catch (error) {
    console.error('[OCR] Error:', error);
    res.status(500).json({
      success: false,
      error: `OCR识别服务异常: ${(error as Error).message}`,
    });
  }
});

/** 从模型返回中提取纯JSON（处理可能的markdown代码块包裹） */
function extractJson(text: string): string | null {
  // 尝试直接解析
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  // 尝试从 markdown 代码块中提取
  const mdMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch) {
    return mdMatch[1].trim();
  }

  // 尝试匹配 JSON 对象
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : null;
}

export default router;
