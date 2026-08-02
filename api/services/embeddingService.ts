/**
 * Embedding 服务
 * 使用智谱 Embedding-2 API（项目已有 key），零原生依赖
 * 带 LRU 缓存 + 超时保护，避免请求挂起
 */
import { fetchJSON } from './fetchUtils.js';

const ZHIPU_EMBED_URL = 'https://open.bigmodel.cn/api/paas/v4/embeddings';
const EMBED_MODEL = 'embedding-2';
const TIMEOUT_MS = 10_000; // 10秒超时

// 简单 LRU 缓存
const cache = new Map<string, { vector: number[]; ts: number }>();
const MAX_CACHE = 500;

function cacheGet(text: string): number[] | null {
  const entry = cache.get(text);
  if (entry && Date.now() - entry.ts < 3600_000) { return entry.vector; }
  return null;
}

function cacheSet(text: string, vector: number[]): void {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(text, { vector, ts: Date.now() });
}

/** 单条文本 → 向量，10秒超时 */
export async function embedText(text: string): Promise<number[]> {
  const cached = cacheGet(text);
  if (cached) return cached;

  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) throw new Error('ZHIPU_API_KEY not configured');

  const data = await fetchJSON<{ data: { embedding: number[] }[] }>(
    ZHIPU_EMBED_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: text }),
    },
    TIMEOUT_MS,
  );

  const vector = data.data?.[0]?.embedding;
  if (!vector || !Array.isArray(vector)) {
    throw new Error('Embedding API returned invalid response');
  }

  cacheSet(text, vector);
  return vector;
}

/** 批量文本 → 向量，15秒超时 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) throw new Error('ZHIPU_API_KEY not configured');

  const uncached: { idx: number; text: string }[] = [];
  const results: number[][] = new Array(texts.length);

  for (let i = 0; i < texts.length; i++) {
    const cached = cacheGet(texts[i]);
    if (cached) { results[i] = cached; }
    else { uncached.push({ idx: i, text: texts[i] }); }
  }

  if (uncached.length === 0) return results;

  const data = await fetchJSON<{ data: { embedding: number[] }[] }>(
    ZHIPU_EMBED_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: uncached.map(u => u.text) }),
    },
    TIMEOUT_MS + 5_000, // 批量多5秒
  );

  for (let i = 0; i < uncached.length; i++) {
    const vector = data.data[i]?.embedding;
    if (vector) { results[uncached[i].idx] = vector; cacheSet(uncached[i].text, vector); }
  }

  return results;
}

/** 余弦相似度 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return (na === 0 || nb === 0) ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 服务是否可用 */
export function isEmbeddingReady(): boolean {
  return !!process.env.ZHIPU_API_KEY;
}
