#!/usr/bin/env node
/**
 * 本地小模型一键启动工具
 *
 * 功能：
 * 1. 检查模型文件是否存在
 * 2. 自动加载模型到内存
 * 3. 提供交互式对话测试
 * 4. 提供视频分析测试
 * 5. 显示模型状态和性能指标
 *
 * 用法:
 *   npx tsx scripts/start-local-llm.mjs           # 交互模式
 *   npx tsx scripts/start-local-llm.mjs --status   # 仅查看状态
 *   npx tsx scripts/start-local-llm.mjs --test     # 快速测试
 *   npx tsx scripts/start-local-llm.mjs --batch    # 批量测试
 */

import readline from 'readline';
import { localLlmService } from '../services/localLlmService.ts';

const Colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

function log(icon, msg, color = '') {
  console.log(`${color}${icon} ${msg}${Colors.reset}`);
}

async function showStatus() {
  console.log(`\n${Colors.bright}═══════════════════════════════════════════════${Colors.reset}`);
  console.log(`${Colors.bright}  本地小模型状态${Colors.reset}`);
  console.log(`${Colors.bright}═══════════════════════════════════════════════${Colors.reset}\n`);

  const models = localLlmService.listModels();
  for (const m of models) {
    const status = m.loaded ? `${Colors.green}● 已加载${Colors.reset}` : `${Colors.gray}○ 未加载${Colors.reset}`;
    const fileStatus = m.fileExists ? `${Colors.green}存在${Colors.reset}` : `${Colors.red}缺失${Colors.reset}`;
    console.log(`  ${m.displayName}`);
    console.log(`    状态:     ${status}`);
    console.log(`    文件:     ${fileStatus} (${m.fileSizeGb || '?'} GB)`);
    console.log(`    最小显存: ${m.minVramGb} GB`);
    console.log(`    描述:     ${m.description}`);
    console.log('');
  }

  const envEnabled = process.env.LOCAL_LLM_ENABLED === 'true';
  const cpuMode = process.env.LLM_USE_CPU === 'true';
  console.log(`  环境配置:`);
  console.log(`    LOCAL_LLM_ENABLED: ${envEnabled ? `${Colors.green}true${Colors.reset}` : `${Colors.red}false${Colors.reset}`}`);
  console.log(`    LLM_USE_CPU:       ${cpuMode ? `${Colors.yellow}true${Colors.reset}` : 'false'}`);
  console.log('');
}

async function loadModel() {
  const models = localLlmService.listModels();
  const available = models.find(m => m.fileExists);

  if (!available) {
    log('❌', '没有可用的模型文件！请先运行: npm run download-models', Colors.red);
    return false;
  }

  if (available.loaded) {
    log('✓', `模型 ${available.name} 已在内存中`, Colors.green);
    return true;
  }

  log('⏳', `正在加载模型: ${available.displayName} ...`, Colors.yellow);
  const start = Date.now();
  try {
    await localLlmService.loadModel(available.name);
    log('✅', `模型加载成功，耗时 ${Date.now() - start}ms`, Colors.green);
    return true;
  } catch (error) {
    log('❌', `模型加载失败: ${error.message}`, Colors.red);
    return false;
  }
}

async function quickTest() {
  const ok = await loadModel();
  if (!ok) return;

  console.log(`\n${Colors.cyan}━━━ 快速测试 ━━━${Colors.reset}\n`);

  const tests = [
    { prompt: '你好，请用一句话介绍你自己', label: '基础对话' },
    { prompt: '将以下中文翻译为英文视频提示词: 一只猫在窗台上晒太阳', label: '视频提示词' },
    { prompt: '输出JSON: {"name":"test","value":1}', label: 'JSON输出' },
  ];

  for (const test of tests) {
    console.log(`${Colors.magenta}【${test.label}】${Colors.reset} ${test.prompt}`);
    const start = Date.now();
    const result = await localLlmService.generate(test.prompt, {
      model: 'qwen3-0.6b',
      maxTokens: 300,
      temperature: 0.3,
    });
    const elapsed = Date.now() - start;

    if (result.success) {
      console.log(`${Colors.green}✓${Colors.reset} (${elapsed}ms): ${result.text.substring(0, 150)}`);
    } else {
      console.log(`${Colors.red}✗${Colors.reset} (${elapsed}ms): ${result.error}`);
    }
    console.log('');
  }
}

async function videoAnalysisTest(script) {
  log('⏳', `视频分析: ${script.substring(0, 50)}...`, Colors.yellow);
  const start = Date.now();

  try {
    const response = await fetch('http://localhost:3001/api/agents/video/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, originalMessage: script }),
      signal: AbortSignal.timeout(120000),
    });

    const elapsed = Date.now() - start;
    const data = await response.json();

    if (data.success) {
      const model = data.modelUsed;
      const isLocal = model === 'local-qwen3-0.6b';
      const icon = isLocal ? '⚡' : '🔄';
      const color = isLocal ? Colors.green : Colors.yellow;

      console.log(`${color}${icon} 分析完成 (${elapsed}ms) | 模型: ${model}${Colors.reset}`);
      console.log(`   风格: ${data.result?.style || '?'}`);
      console.log(`   时长: ${data.result?.duration || '?'}s`);
      console.log(`   Prompt: ${data.result?.prompt?.substring(0, 150) || '?'}`);
      return { success: true, isLocal, elapsed, result: data.result };
    } else {
      log('❌', `分析失败 (${elapsed}ms): ${data.error}`, Colors.red);
      return { success: false, elapsed, error: data.error };
    }
  } catch (error) {
    log('❌', `请求异常: ${error.message}`, Colors.red);
    return { success: false, error: error.message };
  }
}

async function interactiveMode() {
  await showStatus();
  const ok = await loadModel();
  if (!ok) return;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${Colors.cyan}local-llm> ${Colors.reset}`,
  });

  console.log(`\n${Colors.bright}━━━ 交互模式 ━━━${Colors.reset}`);
  console.log('  命令:');
  console.log('    <文字>        直接对话');
  console.log('    /video <脚本>  视频参数分析');
  console.log('    /status        查看状态');
  console.log('    /unload        卸载模型');
  console.log('    /exit          退出');
  console.log('');

  rl.prompt();

  rl.on('line', async (input) => {
    const trimmed = input.trim();
    if (!trimmed) { rl.prompt(); return; }

    if (trimmed === '/exit' || trimmed === '/quit') {
      log('👋', '再见！', Colors.cyan);
      rl.close();
      process.exit(0);
    }

    if (trimmed === '/status') {
      await showStatus();
      rl.prompt();
      return;
    }

    if (trimmed === '/unload') {
      localLlmService.unloadAll();
      log('✓', '模型已卸载', Colors.yellow);
      rl.prompt();
      return;
    }

    if (trimmed.startsWith('/video ')) {
      const script = trimmed.substring(7);
      await videoAnalysisTest(script);
      rl.prompt();
      return;
    }

    // 普通对话
    log('⏳', '生成中...', Colors.gray);
    const start = Date.now();
    const result = await localLlmService.generate(trimmed, {
      model: 'qwen3-0.6b',
      maxTokens: 500,
      temperature: 0.5,
    });
    const elapsed = Date.now() - start;

    if (result.success) {
      console.log(`${Colors.green}✓${Colors.reset} (${elapsed}ms):\n  ${result.text}\n`);
    } else {
      log('❌', result.error, Colors.red);
    }
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// 主入口
const mode = process.argv[2] || '--interactive';

switch (mode) {
  case '--status':
    await showStatus();
    break;
  case '--test':
    await quickTest();
    break;
  case '--batch':
    log('⏳', '启动批量测试（需要后端运行中）...', Colors.yellow);
    await import('./test-local-llm-batch.mjs');
    break;
  default:
    await interactiveMode();
    break;
}
