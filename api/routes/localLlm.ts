/**
 * 本地 LLM 路由
 *
 * 提供本地模型状态查询、加载/卸载、推理测试等端点。
 * 所有推理走 localLlmService，不经过云端。
 */

import { Router, type Request, type Response } from 'express';
import { localLlmService } from '../services/localLlmService.js';

const router = Router();

/** GET /api/local-llm/status — 本地模型状态 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await localLlmService.healthCheck();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/local-llm/load — 加载模型到内存 */
router.post('/load', async (req: Request, res: Response) => {
  try {
    const { model } = req.body;
    if (!model) {
      res.status(400).json({ success: false, error: 'model 是必填项' });
      return;
    }
    await localLlmService.loadModel(model);
    res.json({ success: true, message: `模型 ${model} 已加载` });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/local-llm/unload — 卸载模型释放内存 */
router.post('/unload', async (req: Request, res: Response) => {
  try {
    const { model } = req.body;
    if (!model) {
      localLlmService.unloadAll();
      res.json({ success: true, message: '所有模型已卸载' });
      return;
    }
    localLlmService.unloadModel(model);
    res.json({ success: true, message: `模型 ${model} 已卸载` });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/local-llm/generate — 本地推理 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const {
      prompt,
      model,
      systemPrompt,
      maxTokens,
      temperature,
      history,
    } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ success: false, error: 'prompt 是必填项且为字符串' });
      return;
    }

    const result = await localLlmService.generate(prompt, {
      model,
      systemPrompt,
      maxTokens,
      temperature,
      history,
    });

    if (result.success) {
      res.json({
        success: true,
        text: result.text,
        tokensUsed: result.tokensUsed,
        durationMs: result.durationMs,
        model: result.modelName,
      });
    } else {
      res.status(503).json({
        success: false,
        error: result.error,
        model: result.modelName,
      });
    }
  } catch (error) {
    console.error('[LocalLLM Route] Error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** POST /api/local-llm/chat — 多轮对话 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { messages, model, systemPrompt } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ success: false, error: 'messages 必须是非空数组' });
      return;
    }

    // 提取最后一条用户消息作为 prompt
    const lastUserMsg = [...messages].reverse().find(
      (m: any) => m.role === 'user',
    );
    if (!lastUserMsg) {
      res.status(400).json({ success: false, error: '没有找到用户消息' });
      return;
    }

    const history = messages.slice(0, -1).map((m: any) => ({
      role: m.role,
      content: m.content,
    }));

    const result = await localLlmService.generate(lastUserMsg.content, {
      model,
      systemPrompt,
      history,
      maxTokens: req.body.maxTokens,
      temperature: req.body.temperature,
    });

    if (result.success) {
      res.json({
        success: true,
        message: {
          role: 'assistant',
          content: result.text,
        },
        tokensUsed: result.tokensUsed,
        durationMs: result.durationMs,
      });
    } else {
      res.status(503).json({ success: false, error: result.error });
    }
  } catch (error) {
    console.error('[LocalLLM Chat Route] Error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
