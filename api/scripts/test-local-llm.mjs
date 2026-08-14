#!/usr/bin/env node
/**
 * 本地 LLM 推理测试脚本
 * 测试 node-llama-cpp 加载 GGUF 模型并进行推理
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

process.chdir(projectRoot);

const { localLlmService } = await import('../services/localLlmService.ts');

console.log('=== 本地 LLM 推理测试 ===\n');

// 1. 检查模型状态
console.log('1. 检查模型状态...');
const models = localLlmService.listModels();
for (const m of models) {
  console.log(`   ${m.displayName}: 文件存在=${m.fileExists}, 已加载=${m.loaded}, 大小=${m.fileSizeGb || '?'}GB`);
}

const availableModel = models.find((m) => m.fileExists);
if (!availableModel) {
  console.error('\n没有可用的模型文件！请先运行: npm run download-models');
  process.exit(1);
}

console.log(`\n2. 加载模型: ${availableModel.name}...`);
const loadStart = Date.now();
try {
  await localLlmService.loadModel(availableModel.name);
  console.log(`   加载完成，耗时 ${Date.now() - loadStart}ms`);
} catch (err) {
  console.error(`   加载失败: ${err.message}`);
  process.exit(1);
}

console.log('\n3. 执行推理...');
const prompt = '你好，请用一句话介绍你自己。';
console.log(`   Prompt: ${prompt}`);

const result = await localLlmService.generate(prompt, {
  model: availableModel.name,
  maxTokens: 256,
  temperature: 0.7,
});

if (result.success) {
  console.log(`\n   响应 (耗时 ${result.durationMs}ms):`);
  console.log(`   ${result.text}`);
  console.log(`\n   模型: ${result.modelName}`);
} else {
  console.error(`\n   推理失败: ${result.error}`);
}

// 4. 测试多轮对话
console.log('\n4. 测试多轮对话...');
const chatResult = await localLlmService.generate('继续说，你能做什么？', {
  model: availableModel.name,
  systemPrompt: '你是一个乐于助人的AI助手。',
  history: [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: '你好！我是AI助手，很高兴为你服务。' },
  ],
  maxTokens: 256,
  temperature: 0.7,
});

if (chatResult.success) {
  console.log(`   响应 (耗时 ${chatResult.durationMs}ms):`);
  console.log(`   ${chatResult.text}`);
} else {
  console.error(`   失败: ${chatResult.error}`);
}

// 5. 卸载模型
console.log('\n5. 卸载模型...');
localLlmService.unloadAll();
console.log('   已卸载');

console.log('\n=== 测试完成 ===');
