/**
 * 知识库管理 API
 * 支持知识库的 CRUD、搜索、统计
 */
import { Router, type Request, type Response } from 'express';
import {
  addDocument, addDocuments, updateDocument, deleteDocument,
  getAllDocuments, getDocument,
  hybridSearch, vectorSearch, keywordSearch,
  getStats, saveNow,
  type VectorDocument,
} from '../services/vectorStore.js';
import { seedKnowledgeBase } from '../services/ragKnowledge.js';
import { isEmbeddingReady } from '../services/embeddingService.js';

const router = Router();

// ========== 状态 ==========

router.get('/status', (req: Request, res: Response) => {
  res.json({
    success: true,
    embeddingReady: isEmbeddingReady(),
    stats: getStats(),
  });
});

// ========== 搜索 ==========

/** 混合搜索 */
router.get('/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const { q, topK, minScore, type } = req.query;
    if (!q || typeof q !== 'string') {
      res.status(400).json({ success: false, error: 'q (query) is required' });
      return;
    }

    const results = await hybridSearch(
      q,
      topK ? parseInt(topK as string) : 5,
      minScore ? parseFloat(minScore as string) : 0.2,
    );

    // 类型过滤
    const filtered = type ? results.filter(r => r.document.type === type) : results;

    res.json({
      success: true,
      query: q,
      count: filtered.length,
      source: isEmbeddingReady() ? 'hybrid' : 'keyword',
      results: filtered.map(r => ({
        id: r.document.id,
        type: r.document.type,
        title: r.document.title,
        content: r.document.content,
        score: Math.round(r.score * 100) / 100,
        metadata: r.document.metadata,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** 纯向量搜索 */
router.get('/vector-search', async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query.q as string;
    if (!q) { res.status(400).json({ success: false, error: 'q required' }); return; }
    const results = await vectorSearch(q, parseInt(req.query.topK as string) || 5);
    res.json({ success: true, count: results.length, results: results.map(r => ({ id: r.document.id, type: r.document.type, title: r.document.title, score: r.score })) });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** 纯关键词搜索 */
router.get('/keyword-search', (req: Request, res: Response): void => {
  try {
    const q = req.query.q as string;
    if (!q) { res.status(400).json({ success: false, error: 'q required' }); return; }
    const results = keywordSearch(q, parseInt(req.query.topK as string) || 5);
    res.json({ success: true, count: results.length, results: results.map(r => ({ id: r.document.id, type: r.document.type, title: r.document.title, score: r.score })) });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ========== CRUD ==========

/** 获取所有文档 */
router.get('/documents', (req: Request, res: Response) => {
  const type = req.query.type as string | undefined;
  const docs = getAllDocuments(type);
  res.json({ success: true, count: docs.length, documents: docs });
});

/** 获取单个文档 */
router.get('/documents/:id', (req: Request, res: Response): void => {
  const doc = getDocument(req.params.id);
  if (!doc) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  const { embedding, ...rest } = doc;
  res.json({ success: true, document: rest });
});

/** 添加文档 */
router.post('/documents', async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, title, content, searchText, metadata } = req.body;
    if (!type || !title || !content) {
      res.status(400).json({ success: false, error: 'type, title, content are required' });
      return;
    }

    const doc = await addDocument({
      type,
      title,
      content,
      searchText: searchText || `${title} ${content}`,
      metadata: metadata || {},
    });

    const { embedding, ...rest } = doc;
    res.json({ success: true, document: rest });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** 批量添加 */
router.post('/documents/batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const { documents } = req.body;
    if (!Array.isArray(documents) || documents.length === 0) {
      res.status(400).json({ success: false, error: 'documents array required' });
      return;
    }

    const count = await addDocuments(documents);
    res.json({ success: true, added: count });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** 更新文档 */
router.put('/documents/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const doc = await updateDocument(req.params.id, req.body);
    if (!doc) { res.status(404).json({ success: false, error: 'Not found' }); return; }
    const { embedding, ...rest } = doc;
    res.json({ success: true, document: rest });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** 删除文档 */
router.delete('/documents/:id', (req: Request, res: Response): void => {
  const deleted = deleteDocument(req.params.id);
  if (!deleted) { res.status(404).json({ success: false, error: 'Not found' }); return; }
  saveNow();
  res.json({ success: true });
});

// ========== 种子数据 ==========

/** 初始化种子数据 */
router.post('/seed', async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await seedKnowledgeBase();
    res.json({ success: true, seeded: count, stats: getStats() });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ========== 统计 ==========

router.get('/stats', (req: Request, res: Response) => {
  res.json({ success: true, ...getStats() });
});

export default router;
