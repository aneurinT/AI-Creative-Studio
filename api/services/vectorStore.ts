/**
 * 向量存储服务
 * 内存向量库 + JSON 持久化，支持 CRUD 和余弦相似度检索
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { embedText, embedTexts, cosineSimilarity, isEmbeddingReady } from './embeddingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORE_PATH = path.join(__dirname, '../data/vector_store.json');
const AUTO_SAVE_INTERVAL = 30_000; // 30秒自动保存

// ========== 类型定义 ==========

export interface VectorDocument {
  id: string;
  type: 'prompt_template' | 'visual_style' | 'user_knowledge' | 'document';
  title: string;                 // 标题/名称
  content: string;               // 原文内容（用于展示）
  searchText: string;            // 用于生成向量的文本
  embedding?: number[];          // 向量（384维）
  metadata: Record<string, any>; // 扩展字段（风格参数、关键词等）
  createdAt: string;
  updatedAt: string;
}

// ========== 存储 ==========

let docs: VectorDocument[] = [];
let dirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 加载持久化数据 */
function load(): void {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      docs = JSON.parse(raw);
      console.log(`[VectorStore] 加载 ${docs.length} 条记录`);
    }
  } catch (err) {
    console.warn('[VectorStore] 加载失败，使用空库:', err);
    docs = [];
  }
}

/** 持久化 */
function scheduleSave(): void {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const dir = path.dirname(STORE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STORE_PATH, JSON.stringify(docs, null, 2), 'utf-8');
      dirty = false;
    } catch (err) {
      console.error('[VectorStore] 保存失败:', err);
    }
  }, AUTO_SAVE_INTERVAL);
}

/** 立即保存 */
export function saveNow(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!dirty && docs.length > 0) return;
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(docs, null, 2), 'utf-8');
    dirty = false;
    console.log(`[VectorStore] 已保存 ${docs.length} 条记录`);
  } catch (err) {
    console.error('[VectorStore] 保存失败:', err);
  }
}

// ========== CRUD ==========

/** 生成唯一 ID */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 添加文档（自动生成向量） */
export async function addDocument(doc: Omit<VectorDocument, 'id' | 'embedding' | 'createdAt' | 'updatedAt'>): Promise<VectorDocument> {
  const now = new Date().toISOString();
  const embedding = await embedText(doc.searchText);

  const full: VectorDocument = {
    id: uid(),
    type: doc.type,
    title: doc.title,
    content: doc.content,
    searchText: doc.searchText,
    embedding,
    metadata: doc.metadata,
    createdAt: now,
    updatedAt: now,
  };

  docs.push(full);
  scheduleSave();
  console.log(`[VectorStore] 已添加: ${doc.title} (${doc.type})`);
  return full;
}

/** 批量添加（含种子数据导入） */
export async function addDocuments(docsInput: Omit<VectorDocument, 'id' | 'embedding' | 'createdAt' | 'updatedAt'>[]): Promise<number> {
  const now = new Date().toISOString();
  const searchTexts = docsInput.map(d => d.searchText);
  const embeddings = await embedTexts(searchTexts);

  let count = 0;
  for (let i = 0; i < docsInput.length; i++) {
    const d = docsInput[i];
    // 跳过已存在的
    if (docs.some(e => e.type === d.type && e.title === d.title && e.content === d.content)) continue;

    docs.push({
      id: uid(),
      type: d.type,
      title: d.title,
      content: d.content,
      searchText: d.searchText,
      embedding: embeddings[i],
      metadata: d.metadata,
      createdAt: now,
      updatedAt: now,
    });
    count++;
  }

  if (count > 0) {
    scheduleSave();
    console.log(`[VectorStore] 批量添加 ${count} 条记录`);
  }
  return count;
}

/** 更新文档 */
export async function updateDocument(id: string, updates: Partial<Pick<VectorDocument, 'title' | 'content' | 'searchText' | 'metadata'>>): Promise<VectorDocument | null> {
  const idx = docs.findIndex(d => d.id === id);
  if (idx === -1) return null;

  const doc = docs[idx];
  if (updates.title) doc.title = updates.title;
  if (updates.content) doc.content = updates.content;
  if (updates.searchText) {
    doc.searchText = updates.searchText;
    doc.embedding = await embedText(updates.searchText);
  }
  if (updates.metadata) doc.metadata = { ...doc.metadata, ...updates.metadata };
  doc.updatedAt = new Date().toISOString();

  scheduleSave();
  return doc;
}

/** 删除文档 */
export function deleteDocument(id: string): boolean {
  const idx = docs.findIndex(d => d.id === id);
  if (idx === -1) return false;
  docs.splice(idx, 1);
  scheduleSave();
  return true;
}

/** 获取所有文档 */
export function getAllDocuments(type?: string): VectorDocument[] {
  const filtered = type ? docs.filter(d => d.type === type) : docs;
  return filtered.map(({ embedding, ...rest }) => rest as VectorDocument);
}

/** 获取文档详情 */
export function getDocument(id: string): VectorDocument | null {
  return docs.find(d => d.id === id) || null;
}

// ========== 检索 ==========

export interface SearchResult {
  document: VectorDocument;
  score: number; // 余弦相似度 [0, 1]
}

/** 语义检索（向量相似度），出错时静默返回空 */
export async function vectorSearch(query: string, topK: number = 5, minScore: number = 0.3): Promise<SearchResult[]> {
  if (!isEmbeddingReady() || docs.length === 0) return [];

  try {
    const queryVec = await embedText(query);

    const results: SearchResult[] = [];
    for (const doc of docs) {
      if (!doc.embedding) continue;
      const score = cosineSimilarity(queryVec, doc.embedding);
      if (score >= minScore) {
        results.push({ document: doc, score });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  } catch (err) {
    console.warn('[VectorStore] 向量检索失败，降级为关键词:', (err as Error).message);
    return [];
  }
}

/** 关键词检索（BM25 简化版） */
export function keywordSearch(query: string, topK: number = 5): SearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const results: SearchResult[] = [];
  for (const doc of docs) {
    const docTokens = tokenize(doc.searchText + ' ' + doc.title + ' ' + doc.content);
    let hitCount = 0;
    for (const qt of queryTokens) {
      if (docTokens.includes(qt)) hitCount++;
    }
    // 部分匹配也加分
    for (const qt of queryTokens) {
      if (qt.length < 2) continue;
      for (const dt of docTokens) {
        if (dt.length >= 2 && (dt.includes(qt) || qt.includes(dt))) {
          hitCount += 0.3;
          break;
        }
      }
    }
    const score = queryTokens.length > 0 ? hitCount / queryTokens.length : 0;
    if (score > 0.05) {
      results.push({ document: doc, score: Math.min(score, 1) });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** 混合检索（向量 + 关键词 加权融合） */
export async function hybridSearch(query: string, topK: number = 5, minScore: number = 0.2): Promise<SearchResult[]> {
  const [vecResults, kwResults] = await Promise.all([
    vectorSearch(query, topK * 2, 0.2),
    Promise.resolve(keywordSearch(query, topK * 2)),
  ]);

  // 融合分数（向量权重 0.7, 关键词权重 0.3）
  const fused = new Map<string, { document: VectorDocument; score: number }>();

  for (const r of vecResults) {
    fused.set(r.document.id, { document: r.document, score: r.score * 0.7 });
  }
  for (const r of kwResults) {
    const existing = fused.get(r.document.id);
    if (existing) {
      existing.score = existing.score + r.score * 0.3;
    } else {
      fused.set(r.document.id, { document: r.document, score: r.score * 0.3 });
    }
  }

  return Array.from(fused.values())
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ========== 工具 ==========

function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[，。,\.！!？?\s\r\n]+/g, ' ')
    .split(' ')
    .filter(t => t.length > 1);
}

/** 统计信息 */
export function getStats() {
  return {
    total: docs.length,
    byType: {
      prompt_template: docs.filter(d => d.type === 'prompt_template').length,
      visual_style: docs.filter(d => d.type === 'visual_style').length,
      user_knowledge: docs.filter(d => d.type === 'user_knowledge').length,
      document: docs.filter(d => d.type === 'document').length,
    },
    embeddingReady: isEmbeddingReady(),
  };
}

/** 清空（调试用） */
export function clearAll(): void {
  docs = [];
  scheduleSave();
}

// 启动时加载
load();
