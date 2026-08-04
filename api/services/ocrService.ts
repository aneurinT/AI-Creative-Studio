import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchWithTimeout } from './fetchUtils.js';
import { VISION_MODEL, VISION_API } from './llmConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface OcrRequest {
  imageUrl: string;
  format?: 'text' | 'json' | 'table';
}

export interface OcrResponse {
  success: boolean;
  text?: string;
  jsonResult?: Record<string, any>;
  tableData?: string[][];
  format: string;
  method: 'llm' | 'ocr-tool';
  error?: string;
}

/**
 * 方式一：大模型识别（智谱 glm-4v-flash 视觉模型）
 * 直接分析图片中的文字并返回结构化结果
 */
async function ocrWithLLM(imageUrl: string, format: string): Promise<OcrResponse> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    console.log('[OCR] No Zhipu API key, skipping LLM OCR');
    return { success: false, format, method: 'llm', error: '未配置 API Key' };
  }

  try {
    const formatInstructions: Record<string, string> = {
      text: '请识别图片中的所有文字，直接返回纯文本内容，不要添加任何额外说明。',
      json: '请识别图片中的所有文字，返回严格的JSON格式：{"texts":[{"content":"识别到的文字","position":"位置描述"}]}。不要添加任何额外说明。',
      table: '请识别图片中的表格，返回严格的JSON格式：{"tableData":[["列1标题","列2标题"],["数据1","数据2"]]}。如果图片中没有表格，请尝试将文字按表格形式整理。不要添加任何额外说明。',
    };

    const instruction = formatInstructions[format] || formatInstructions.text;

    const response = await fetchWithTimeout(VISION_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl } },
              { type: 'text', text: instruction },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    }, 30000);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`[OCR] LLM API failed: ${response.status} ${errText.substring(0, 100)}`);
      return { success: false, format, method: 'llm', error: `大模型调用失败: ${response.status}` };
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { success: false, format, method: 'llm', error: '大模型返回空结果' };
    }

    console.log(`[OCR] LLM success, format=${format}, content length=${content.length}`);

    const result: OcrResponse = { success: true, format, method: 'llm', text: '' };

    if (format === 'text') {
      result.text = content;
    } else if (format === 'json') {
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result.jsonResult = JSON.parse(jsonMatch[0]);
          result.text = content;
        } else {
          result.jsonResult = { texts: [{ content, position: '全文' }] };
          result.text = content;
        }
      } catch {
        result.jsonResult = { rawText: content };
        result.text = content;
      }
    } else if (format === 'table') {
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          result.tableData = parsed.tableData || [];
          result.text = content;
        } else {
          result.text = content;
        }
      } catch {
        result.text = content;
      }
    }

    return result;
  } catch (error) {
    console.error('[OCR] LLM exception:', (error as Error).message);
    return { success: false, format, method: 'llm', error: `大模型调用异常: ${(error as Error).message}` };
  }
}

/**
 * 方式二：OCR 工具降级方案
 * 使用 Tesseract.js 或简单的图片文字提取
 * 这里用 base64 编码通过免费 OCR API 实现
 */
async function ocrWithTool(imageUrl: string, format: string): Promise<OcrResponse> {
  try {
    // 方案1：尝试使用 free OCR API (ocr.space)
    const ocrApiKey = process.env.OCR_SPACE_API_KEY || 'helloworld'; // free tier key
    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: {
        'apikey': ocrApiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        url: imageUrl,
        language: 'chs,eng',
        isOverlayRequired: 'false',
        OCREngine: '2',
      }).toString(),
    });

    if (!response.ok) {
      // 方案2：回退到使用 fetch 获取图片后再用其他方式
      return await fallbackOcr(imageUrl, format);
    }

    const data = await response.json() as any;
    const parsedText = data?.ParsedResults?.[0]?.ParsedText || '';

    if (!parsedText.trim()) {
      return await fallbackOcr(imageUrl, format);
    }

    console.log(`[OCR] Tool success, text length=${parsedText.length}`);

    const result: OcrResponse = { success: true, format, method: 'ocr-tool', text: parsedText };

    if (format === 'json') {
      const lines = parsedText.split('\n').filter((l: string) => l.trim());
      result.jsonResult = { texts: lines.map((l: string, i: number) => ({ content: l, position: `行${i + 1}` })) };
    } else if (format === 'table') {
      const lines = parsedText.split('\n').filter((l: string) => l.trim());
      result.tableData = lines.map((l: string) => l.split(/\s{2,}|\t|,/).map((c: string) => c.trim()));
    }

    return result;
  } catch (error) {
    console.error('[OCR] Tool exception:', (error as Error).message);
    return await fallbackOcr(imageUrl, format);
  }
}

/** 兜底方案：使用 fetch 下载图片后做基本分析 */
async function fallbackOcr(imageUrl: string, format: string): Promise<OcrResponse> {
  try {
    // 如果图片是本地路径，尝试读取文件
    if (imageUrl.startsWith('/images/') || imageUrl.startsWith('data:')) {
      return { success: false, format, method: 'ocr-tool', error: 'OCR 工具无法识别该图片中的文字，请尝试使用大模型模式' };
    }
    return { success: false, format, method: 'ocr-tool', error: 'OCR 识别失败，请检查图片是否包含清晰文字' };
  } catch {
    return { success: false, format, method: 'ocr-tool', error: 'OCR 服务不可用' };
  }
}

/**
 * 主入口：OCR 文字识别
 * 策略：先走大模型（智谱视觉），失败后降级到 OCR 工具
 */
export async function recognizeText(request: OcrRequest): Promise<OcrResponse> {
  const { imageUrl, format = 'text' } = request;

  console.log(`[OCR] Request: imageUrl=${imageUrl?.substring(0, 50)}..., format=${format}`);

  if (!imageUrl) {
    return { success: false, format, method: 'ocr-tool', error: 'imageUrl is required' };
  }

  // 策略1：先走大模型
  const llmResult = await ocrWithLLM(imageUrl, format);
  if (llmResult.success) {
    return llmResult;
  }

  console.log('[OCR] LLM failed, falling back to OCR tool...');

  // 策略2：降级到 OCR 工具
  const toolResult = await ocrWithTool(imageUrl, format);
  return toolResult;
}

/**
 * 批量 OCR：多张图片并行识别
 */
export async function batchRecognizeText(requests: OcrRequest[]): Promise<OcrResponse[]> {
  console.log(`[OCR] Batch: ${requests.length} images`);
  const results = await Promise.allSettled(
    requests.map(req => recognizeText(req))
  );
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return { success: false, format: requests[i].format || 'text', method: 'ocr-tool' as const, error: `识别异常: ${r.reason}` };
  });
}
