/**
 * SSE 流式输出服务
 * 支持 LLM API 的 streaming 模式，逐 token 推送给前端
 */
import type { Response } from 'express';
import { getChatApiKey, CHAT_API, CHAT_MODEL, CHAT_FALLBACK_API, CHAT_FALLBACK_MODEL, getChatFallbackApiKey } from './llmConfig.js';

/** SSE 响应头 */
export function setSSEHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

/** 发送 SSE 事件 */
export function sendSSEEvent(res: Response, event: string, data: any): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** 发送 SSE 结束 */
export function sendSSEEnd(res: Response): void {
  res.write('event: done\ndata: {}\n\n');
  res.end();
}

/** 发送 SSE 错误 */
export function sendSSEError(res: Response, error: string): void {
  res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);
  res.end();
}

/** 流式调用 LLM API */
export async function streamLLM(
  res: Response,
  messages: Array<{ role: string; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  const apiKey = getChatApiKey();
  const fallbackKey = getChatFallbackApiKey();

  let fullResponse = '';

  const tryStream = async (url: string, model: string, key: string): Promise<boolean> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 500,
        stream: true,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`[SSE] ${model} stream failed: ${response.status} ${errText.substring(0, 100)}`);
      return false;
    }

    const reader = response.body?.getReader();
    if (!reader) return false;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              const content = delta?.content || '';
              if (content) {
                fullResponse += content;
                sendSSEEvent(res, 'token', { content });
              }
            } catch {
              // 跳过解析失败的行
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        console.warn('[SSE] Stream aborted by timeout');
      } else {
        throw err;
      }
    }

    return true;
  };

  // 先尝试主模型
  if (apiKey) {
    const ok = await tryStream(CHAT_API, CHAT_MODEL, apiKey);
    if (ok) return fullResponse;
  }

  // 回退到备选模型
  if (fallbackKey) {
    const ok = await tryStream(CHAT_FALLBACK_API, CHAT_FALLBACK_MODEL, fallbackKey);
    if (ok) return fullResponse;
  }

  throw new Error('所有 LLM 流式调用均失败');
}

/** 流式调用 LLM + 自动解析 JSON 结果 */
export async function streamLLMWithParse<T>(
  res: Response,
  messages: Array<{ role: string; content: string }>,
  parser: (text: string) => T,
  options?: { temperature?: number; maxTokens?: number }
): Promise<{ fullText: string; parsed: T }> {
  const fullText = await streamLLM(res, messages, options);
  const parsed = parser(fullText);
  return { fullText, parsed };
}
