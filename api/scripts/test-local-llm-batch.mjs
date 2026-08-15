#!/usr/bin/env node
/**
 * 本地小模型批量测试脚本
 * 测试视频参数分析的理解能力、成功率、效率
 *
 * 用法: npx tsx scripts/test-local-llm-batch.mjs
 */

const TEST_CASES = [
  {
    name: '樱花女孩',
    script: '一个女孩在樱花树下跳舞，阳光透过花瓣洒下，镜头从远景推到特写',
    expectKeywords: ['girl', 'cherry', 'blossom', 'danc', 'sun', 'light'],
  },
  {
    name: '城市夜景',
    script: '城市夜景延时摄影，车流光轨，霓虹灯倒映在湿漉漉的街道上',
    expectKeywords: ['city', 'night', 'neon', 'light', 'car', 'street'],
  },
  {
    name: '海洋日落',
    script: '海浪拍打沙滩，夕阳西下，金色的光芒洒在海面上，海鸥飞过',
    expectKeywords: ['ocean', 'wave', 'sunset', 'golden', 'beach', 'sun'],
  },
  {
    name: '奥特曼战斗',
    script: '奥特曼与怪兽在城市中战斗，建筑倒塌，激光交错，爆炸四起',
    expectKeywords: ['ultraman', 'hero', 'city', 'monster', 'battle', 'fight'],
  },
  {
    name: '雪山探险',
    script: '登山者在暴风雪中攀登雪山，镜头航拍，展现壮丽的山脉全景',
    expectKeywords: ['mountain', 'snow', 'climb', 'storm', 'peak', 'landscape'],
  },
  {
    name: '猫咪日常',
    script: '一只橘猫在窗台上晒太阳，懒洋洋地打哈欠，阳光温暖',
    expectKeywords: ['cat', 'sun', 'warm', 'window', 'light'],
  },
];

async function runBatchTest() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  本地小模型视频分析批量测试');
  console.log('  模型: Qwen3-4B-Instruct-2507 Q4_K_M | 少样本提示');
  console.log('═══════════════════════════════════════════════════\n');

  const results = [];
  let totalTime = 0;

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    console.log(`\n[${i + 1}/${TEST_CASES.length}] 测试: ${tc.name}`);
    console.log(`  输入: ${tc.script}`);

    const startTime = Date.now();
    try {
      const body = JSON.stringify({
        script: tc.script,
        originalMessage: tc.script,
      });

      const response = await fetch('http://localhost:3001/api/agents/video/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(120000),
      });

      const elapsed = Date.now() - startTime;
      totalTime += elapsed;

      if (!response.ok) {
        console.log(`  ❌ HTTP ${response.status}`);
        results.push({ name: tc.name, success: false, elapsed, error: `HTTP ${response.status}` });
        continue;
      }

      const data = await response.json();

      if (!data.success) {
        console.log(`  ❌ 分析失败: ${data.error || '未知错误'}`);
        results.push({ name: tc.name, success: false, elapsed, error: data.error });
        continue;
      }

      const usedLocal = data.modelUsed === 'local-qwen3-4b';
      const prompt = data.result?.prompt || '';
      const style = data.result?.style || '';
      const duration = data.result?.duration || '?';

      // 检查关键词匹配
      const promptLower = prompt.toLowerCase();
      const matchedKeywords = tc.expectKeywords.filter(kw => promptLower.includes(kw));
      const keywordScore = matchedKeywords.length / tc.expectKeywords.length;

      // 判断成功标准
      const isRelevant = keywordScore >= 0.2;
      const passed = usedLocal && isRelevant && prompt.length > 20;

      if (passed) {
        console.log(`  ✅ 成功 (${elapsed}ms) | 模型: ${data.modelUsed}`);
        console.log(`  关键词命中: ${matchedKeywords.join(', ')} (${(keywordScore * 100).toFixed(0)}%)`);
        console.log(`  风格: ${style} | 时长: ${duration}s`);
        console.log(`  Prompt: ${prompt.substring(0, 120)}...`);
      } else if (usedLocal && !isRelevant) {
        console.log(`  ⚠️ 本地模型输出但相关性不足 (${elapsed}ms)`);
        console.log(`  关键词命中: ${matchedKeywords.join(', ')} (${(keywordScore * 100).toFixed(0)}%)`);
        console.log(`  Prompt: ${prompt.substring(0, 120)}...`);
      } else {
        console.log(`  🔄 本地模型降级到云端 (${elapsed}ms) | 模型: ${data.modelUsed}`);
        console.log(`  Prompt: ${prompt.substring(0, 120)}...`);
      }

      results.push({
        name: tc.name,
        success: passed,
        usedLocal,
        relevant: isRelevant,
        keywordScore,
        elapsed,
        prompt: prompt.substring(0, 100),
        modelUsed: data.modelUsed,
      });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      totalTime += elapsed;
      console.log(`  ❌ 异常: ${error.message}`);
      results.push({ name: tc.name, success: false, elapsed, error: error.message });
    }
  }

  // 汇总报告
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  测试报告汇总');
  console.log('═══════════════════════════════════════════════════\n');

  const localUsed = results.filter(r => r.usedLocal).length;
  const localSuccess = results.filter(r => r.usedLocal && r.success).length;
  const localRelevant = results.filter(r => r.usedLocal && r.relevant).length;
  const avgTime = (totalTime / results.length / 1000).toFixed(1);

  console.log(`  总测试数:     ${results.length}`);
  console.log(`  本地模型使用: ${localUsed}/${results.length} (${((localUsed / results.length) * 100).toFixed(0)}%)`);
  console.log(`  本地模型成功: ${localSuccess}/${localUsed} (${localUsed > 0 ? ((localSuccess / localUsed) * 100).toFixed(0) : 0}%)`);
  console.log(`  本地相关性:   ${localRelevant}/${localUsed} (${localUsed > 0 ? ((localRelevant / localUsed) * 100).toFixed(0) : 0}%)`);
  console.log(`  平均耗时:     ${avgTime}s/次`);
  console.log(`  总耗时:       ${(totalTime / 1000).toFixed(1)}s`);

  console.log('\n  ┌────────────┬────────┬──────────┬───────────┬────────┐');
  console.log('  │ 测试用例   │ 模型   │ 相关性   │ 耗时(ms)  │ 结果   │');
  console.log('  ├────────────┼────────┼──────────┼───────────┼────────┤');
  for (const r of results) {
    const model = r.usedLocal ? '本地' : '云端';
    const rel = r.keywordScore !== undefined ? `${(r.keywordScore * 100).toFixed(0)}%` : '-';
    const time = r.elapsed.toString().padStart(6);
    const status = r.success ? '✅' : (r.usedLocal ? '⚠️' : '🔄');
    console.log(`  │ ${r.name.padEnd(10)} │ ${model.padEnd(6)} │ ${rel.padEnd(8)} │ ${time} │ ${status}     │`);
  }
  console.log('  └────────────┴────────┴──────────┴───────────┴────────┘');

  console.log('\n完成！');
}

runBatchTest().catch(console.error);
