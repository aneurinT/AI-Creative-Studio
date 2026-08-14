#!/usr/bin/env node
/**
 * GGUF 模型下载脚本（支持 ModelScope 和 HuggingFace）
 *
 * 用法：
 *   node scripts/download-gguf-models.mjs [model-name]
 *   node scripts/download-gguf-models.mjs qwen3-0.6b
 *   node scripts/download-gguf-models.mjs all
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const MODELS_DIR = path.join(projectRoot, 'data', 'gguf_models');

fs.mkdirSync(MODELS_DIR, { recursive: true });

const MODELS = {
  'qwen3-0.6b': {
    displayName: 'Qwen3-0.6B-Q8_0',
    source: 'modelscope',
    repo: 'unsloth/Qwen3-0.6B-GGUF',
    file: 'Qwen3-0.6B-Q8_0.gguf',
    destFile: 'qwen3-0.6b-q8_0.gguf',
    sizeGb: 0.61,
  },
  'qwen3-4b': {
    displayName: 'Qwen3-4B-Instruct (Q4_K_M)',
    source: 'huggingface',
    repo: 'lmstudio-community/Qwen3-4B-Instruct-GGUF',
    file: 'qwen3-4b-instruct-q4_k_m.gguf',
    destFile: 'qwen3-4b-instruct-q4_k_m.gguf',
    sizeGb: 2.5,
  },
};

async function downloadFromModelScope(repo, file, destPath) {
  const cloneDir = path.join(MODELS_DIR, '_modelscope_clone');

  // 清理旧的克隆
  fs.rmSync(cloneDir, { recursive: true, force: true });

  console.log('  克隆仓库 (git clone)...');
  const cloneUrl = `https://www.modelscope.cn/${repo}.git`;

  try {
    execSync(`git clone --depth 1 ${cloneUrl} "${cloneDir}"`, {
      stdio: 'inherit',
      timeout: 300000,
      cwd: MODELS_DIR,
    });

    const srcFile = path.join(cloneDir, file);
    if (!fs.existsSync(srcFile)) {
      throw new Error(`文件 ${file} 不在仓库中`);
    }

    fs.copyFileSync(srcFile, destPath);
    console.log('  复制完成');
  } finally {
    fs.rmSync(cloneDir, { recursive: true, force: true });
  }
}

async function downloadFromHuggingFace(repo, file, destPath) {
  const https = await import('https');

  const hfEndpoint = process.env.HF_ENDPOINT || 'https://huggingface.co';
  const url = `${hfEndpoint}/${repo}/resolve/main/${file}`;

  console.log(`  URL: ${url}`);

  return new Promise((resolve, reject) => {
    let currentUrl = url;
    let redirectCount = 0;

    function doDownload() {
      const req = https.get(currentUrl, { timeout: 300000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          redirectCount++;
          if (redirectCount > 10) {
            reject(new Error('重定向次数过多'));
            return;
          }
          currentUrl = res.headers.location;
          res.resume();
          doDownload();
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        const outFile = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalSize > 0) {
            const pct = ((downloaded / totalSize) * 100).toFixed(1);
            process.stdout.write(`\r  进度: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB)`);
          } else {
            process.stdout.write(`\r  已下载: ${(downloaded / 1024 / 1024).toFixed(1)}MB`);
          }
        });

        res.pipe(outFile);

        outFile.on('finish', () => {
          outFile.close();
          console.log('');
          resolve();
        });

        outFile.on('error', (err) => {
          fs.unlink(destPath, () => { });
          reject(err);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });
    }

    doDownload();
  });
}

async function downloadModel(name) {
  const cfg = MODELS[name];
  if (!cfg) {
    console.error(`未知模型: ${name}`);
    console.log(`可用: ${Object.keys(MODELS).join(', ')}`);
    process.exit(1);
  }

  const destPath = path.join(MODELS_DIR, cfg.destFile);

  if (fs.existsSync(destPath)) {
    const size = (fs.statSync(destPath).size / 1024 / 1024 / 1024).toFixed(2);
    console.log(`[SKIP] ${name} 已存在 (${size}GB): ${destPath}`);
    return;
  }

  console.log(`\n[下载] ${cfg.displayName}`);
  console.log(`  仓库: ${cfg.repo}`);
  console.log(`  文件: ${cfg.file}`);
  console.log(`  来源: ${cfg.source}`);
  console.log(`  预估: ~${cfg.sizeGb}GB`);
  console.log(`  目标: ${destPath}`);

  const startTime = Date.now();
  try {
    if (cfg.source === 'modelscope') {
      await downloadFromModelScope(cfg.repo, cfg.file, destPath);
    } else {
      await downloadFromHuggingFace(cfg.repo, cfg.file, destPath);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const size = (fs.statSync(destPath).size / 1024 / 1024 / 1024).toFixed(2);
    console.log(`[完成] ${name}: ${size}GB in ${elapsed}s`);
  } catch (error) {
    console.error(`[失败] ${name}: ${error.message}`);
    try { fs.unlinkSync(destPath); } catch { }
    process.exit(1);
  }
}

// 主入口
const target = process.argv[2] || 'all';

if (target === 'all') {
  for (const name of Object.keys(MODELS)) {
    await downloadModel(name);
  }
} else {
  await downloadModel(target);
}

console.log('\n全部完成！');
console.log(`模型目录: ${MODELS_DIR}`);
console.log('在 .env 中设置 LOCAL_LLM_ENABLED=true 启用本地推理');
