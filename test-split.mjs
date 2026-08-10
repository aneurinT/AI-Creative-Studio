/**
 * 直接测试视频拆分 + 拼接流程
 * 用法：node test-split.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 手动加载 .env
const dotenvPath = path.join(__dirname, '.env');
try {
  if (fs.existsSync(dotenvPath)) {
    const content = fs.readFileSync(dotenvPath, 'utf-8');
    content.split('\n').forEach(line => {
      const m = line.match(/^\s*([^#\s=]+)\s*=\s*(.+)/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim();
      }
    });
    console.log('[Test] .env loaded');
  }
} catch (e) { /* ok */ }

// 动态导入 TS 模块（需要 tsx 运行时）
async function main() {
  const { generateSplitVideo } = await import('./api/services/videoSplitService.js');

  const prompt = `一只白色的小狗在春天的草地上快乐奔跑，追逐飞舞的蝴蝶，阳光从树叶缝隙洒下，温暖治愈的画面。
开场：小狗从远处跑来，耳朵随风飘动，广角镜头。
发展：小狗发现蝴蝶，兴奋地跳跃追逐，中景跟踪拍摄。
高潮：小狗在花丛中转圈，蝴蝶在它头顶飞舞，特写镜头。
收尾：小狗累了趴下，蝴蝶停在它鼻尖上，画面温暖渐暗。
整体风格：明亮温暖治愈，柔和自然光，电影质感`;

  const style = '温暖治愈';
  const duration = '25';

  console.log('=== 开始测试拆分视频生成 ===');
  console.log(`Prompt: ${prompt.substring(0, 80)}...`);
  console.log(`Duration: ${duration}s`);
  console.log('');

  const startTime = Date.now();

  const result = await generateSplitVideo(prompt, style, duration, (progress, status) => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[${elapsed}s] ${progress}% - ${status}`);
  });

  const totalTime = Math.round((Date.now() - startTime) / 1000);
  console.log('');
  console.log(`=== 总耗时: ${totalTime}s ===`);
  console.log(`成功: ${result.success}`);
  console.log(`视频URL: ${result.videoUrl || 'N/A'}`);
  console.log(`错误: ${result.error || 'N/A'}`);

  process.exit(0);
}

main().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
