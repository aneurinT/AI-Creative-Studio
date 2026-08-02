/**
 * fetch 超时包装
 * 所有外部 API 调用统一走这里，避免请求无限挂起
 */
import fetch from 'node-fetch';
import type { RequestInit, Response } from 'node-fetch';

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 15000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/** 带超时和默认错误处理 */
export async function fetchJSON<T = any>(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 15000,
): Promise<T> {
  const resp = await fetchWithTimeout(url, options, timeoutMs);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json() as Promise<T>;
}
