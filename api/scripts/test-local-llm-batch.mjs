#!/usr/bin/env node
/**
 * 本地小模型批量测试脚本
 * 测试所有 4 个 Agent 的本地模型接入稳定性
 *
 * 用法: npx tsx scripts/test-local-llm-batch.mjs
 */

// ======================== 测试用例 ========================

const TEST_CASES = [
  // --- StoryWriter (story/write) ---
  {
    agent: 'story/write',
    endpoint: '/api/agents/story/write',
    name: '故事-樱花女孩',
    input: { message: '一个女孩在樱花树下跳舞，阳光透过花瓣洒下' },
    validate: (d) => {
      const script = d.result?.script || '';
      const hasScenes = /场景[123]/.test(script);
      const hasKeywords = /女孩|樱花|跳舞|阳光/.test(script);
      return { pass: hasScenes && hasKeywords && script.length > 50, detail: `场景:${hasScenes}, 关键词:${hasKeywords}, ${script.length}字` };
    },
  },
  {
    agent: 'story/write',
    endpoint: '/api/agents/story/write',
    name: '故事-猫咪日常',
    input: { message: '一只橘猫在窗台上晒太阳，懒洋洋地打哈欠' },
    validate: (d) => {
      const script = d.result?.script || '';
      const hasScenes = /场景[123]/.test(script);
      const hasKeywords = /猫|窗台|太阳|哈欠/.test(script);
      return { pass: hasScenes && hasKeywords && script.length > 50, detail: `场景:${hasScenes}, 关键词:${hasKeywords}, ${script.length}字` };
    },
  },

  // --- VideoMaker (video/analyze) ---
  {
    agent: 'video/analyze',
    endpoint: '/api/agents/video/analyze',
    name: '视频-海洋日落',
    input: { script: '海浪拍打沙滩，夕阳西下，金色的光芒洒在海面上 10秒' },
    validate: (d) => {
      const prompt = (d.result?.prompt || '').toLowerCase();
      const keywords = ['ocean', 'wave', 'sunset', 'golden', 'beach', 'sun'];
      const matched = keywords.filter(kw => prompt.includes(kw));
      const score = matched.length / keywords.length;
      return { pass: score >= 0.2 && prompt.length > 20, detail: `关键词:${matched.join(',')} (${(score * 100).toFixed(0)}%)` };
    },
  },
  {
    agent: 'video/analyze',
    endpoint: '/api/agents/video/analyze',
    name: '视频-城市夜景',
    input: { script: '城市夜景延时摄影，车流光轨，霓虹灯倒映在湿漉漉的街道上 15秒' },
    validate: (d) => {
      const prompt = (d.result?.prompt || '').toLowerCase();
      const keywords = ['city', 'night', 'neon', 'light', 'car', 'street'];
      const matched = keywords.filter(kw => prompt.includes(kw));
      const score = matched.length / keywords.length;
      return { pass: score >= 0.2 && prompt.length > 20, detail: `关键词:${matched.join(',')} (${(score * 100).toFixed(0)}%)` };
    },
  },

  // --- ImageCreator (image/analyze) ---
  {
    agent: 'image/analyze',
    endpoint: '/api/agents/image/analyze',
    name: '图像-赛博朋克',
    input: { message: '赛博朋克风格的城市夜景' },
    validate: (d) => {
      const prompt = (d.result?.prompt || '').toLowerCase();
      const style = d.result?.style || '';
      const keywords = ['city', 'night', 'neon', 'cyberpunk', 'light'];
      const matched = keywords.filter(kw => prompt.includes(kw) || style.toLowerCase().includes(kw));
      const score = matched.length / keywords.length;
      return { pass: score >= 0.2 && prompt.length > 20, detail: `关键词:${matched.join(',')} (${(score * 100).toFixed(0)}%), style=${style}` };
    },
  },
  {
    agent: 'image/analyze',
    endpoint: '/api/agents/image/analyze',
    name: '图像-雪山风景',
    input: { message: '雪山下的湖泊倒影，清晨薄雾' },
    validate: (d) => {
      const prompt = (d.result?.prompt || '').toLowerCase();
      const keywords = ['mountain', 'snow', 'lake', 'mist', 'reflection', 'peak'];
      const matched = keywords.filter(kw => prompt.includes(kw));
      const score = matched.length / keywords.length;
      return { pass: score >= 0.2 && prompt.length > 20, detail: `关键词:${matched.join(',')} (${(score * 100).toFixed(0)}%)` };
    },
  },

  // --- VideoEditor (video/edit) ---
  {
    agent: 'video/edit',
    endpoint: '/api/agents/video/edit',
    name: '剪辑-裁剪开头',
    input: { message: '把前5秒剪掉' },
    validate: (d) => {
      const action = d.editPlan?.action;
      const params = d.editPlan?.params || {};
      const pass = action === 'trim' && params.trimStart === 0 && params.trimEnd === 5;
      return { pass, detail: `action=${action}, params=${JSON.stringify(params)}` };
    },
  },
  {
    agent: 'video/edit',
    endpoint: '/api/agents/video/edit',
    name: '剪辑-添加字幕',
    input: { message: '给视频加字幕，内容是：大家好欢迎来到我的频道' },
    validate: (d) => {
      const action = d.editPlan?.action;
      const params = d.editPlan?.params || {};
      const pass = action === 'subtitle' && params.subtitleText;
      return { pass, detail: `action=${action}, text=${params.subtitleText?.substring(0, 30)}` };
    },
  },
];

// ======================== 测试执行 ========================

async function runBatchTest() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  本地小模型全 Agent 批量测试');
  console.log('  模型: Qwen3-4B-Instruct-2507 Q4_K_M');
  console.log(`  测试: ${TEST_CASES.length} 个用例, 覆盖 4 个 Agent`);
  console.log('═══════════════════════════════════════════════════\n');

  const results = [];
  let totalTime = 0;

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    console.log(`[${i + 1}/${TEST_CASES.length}] ${tc.agent} → ${tc.name}`);
    console.log(`  输入: ${JSON.stringify(tc.input).substring(0, 80)}`);

    const startTime = Date.now();
    try {
      const response = await fetch(`http://localhost:3001${tc.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tc.input),
        signal: AbortSignal.timeout(180000), // 3 分钟超时（CPU 推理慢）
      });

      const elapsed = Date.now() - startTime;
      totalTime += elapsed;

      if (!response.ok) {
        console.log(`  ❌ HTTP ${response.status} (${elapsed}ms)`);
        results.push({ ...tc, success: false, usedLocal: false, elapsed, error: `HTTP ${response.status}` });
        continue;
      }

      const data = await response.json();
      const usedLocal = data.modelUsed === 'local-qwen3-4b';
      const validation = tc.validate(data);

      if (usedLocal && validation.pass) {
        console.log(`  ✅ 成功 (${(elapsed / 1000).toFixed(1)}s) | 模型: ${data.modelUsed}`);
        console.log(`  ${validation.detail}`);
      } else if (usedLocal && !validation.pass) {
        console.log(`  ⚠️ 本地模型输出但验证未通过 (${(elapsed / 1000).toFixed(1)}s)`);
        console.log(`  ${validation.detail}`);
      } else {
        console.log(`  🔄 降级到云端 (${(elapsed / 1000).toFixed(1)}s) | 模型: ${data.modelUsed}`);
        console.log(`  ${validation.detail}`);
      }

      results.push({
        ...tc,
        success: usedLocal && validation.pass,
        usedLocal,
        relevant: validation.pass,
        elapsed,
        detail: validation.detail,
        modelUsed: data.modelUsed,
      });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      totalTime += elapsed;
      console.log(`  ❌ 异常: ${error.message} (${(elapsed / 1000).toFixed(1)}s)`);
      results.push({ ...tc, success: false, usedLocal: false, elapsed, error: error.message });
    }
  }

  // ======================== 汇总报告 ========================
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  测试报告汇总');
  console.log('═══════════════════════════════════════════════════\n');

  const total = results.length;
  const localUsed = results.filter(r => r.usedLocal).length;
  const localSuccess = results.filter(r => r.usedLocal && r.success).length;
  const fallback = results.filter(r => !r.usedLocal).length;
  const failed = results.filter(r => !r.success && !r.usedLocal).length;
  const avgTime = (totalTime / total / 1000).toFixed(1);

  // 按 Agent 分组统计
  const agentGroups = {};
  for (const r of results) {
    if (!agentGroups[r.agent]) agentGroups[r.agent] = { total: 0, local: 0, success: 0 };
    agentGroups[r.agent].total++;
    if (r.usedLocal) agentGroups[r.agent].local++;
    if (r.success) agentGroups[r.agent].success++;
  }

  console.log(`  总测试数:       ${total}`);
  console.log(`  本地模型使用:   ${localUsed}/${total} (${((localUsed / total) * 100).toFixed(0)}%)`);
  console.log(`  本地模型成功:   ${localSuccess}/${localUsed} (${localUsed > 0 ? ((localSuccess / localUsed) * 100).toFixed(0) : 0}%)`);
  console.log(`  降级到云端:     ${fallback}/${total}`);
  console.log(`  异常失败:       ${failed}/${total}`);
  console.log(`  平均耗时:       ${avgTime}s/次`);
  console.log(`  总耗时:         ${(totalTime / 1000).toFixed(1)}s`);

  console.log('\n  按 Agent 分组:');
  for (const [agent, stats] of Object.entries(agentGroups)) {
    const rate = ((stats.success / stats.total) * 100).toFixed(0);
    const localRate = ((stats.local / stats.total) * 100).toFixed(0);
    console.log(`    ${agent.padEnd(16)} → 本地 ${stats.local}/${stats.total} (${localRate}%), 成功 ${stats.success}/${stats.total} (${rate}%)`);
  }

  console.log('\n  ┌──────────────┬────────────────┬────────┬──────────┬──────────┐');
  console.log('  │ Agent        │ 用例           │ 模型   │ 耗时(s)  │ 结果     │');
  console.log('  ├──────────────┼────────────────┼────────┼──────────┼──────────┤');
  for (const r of results) {
    const agent = r.agent.padEnd(12);
    const name = r.name.padEnd(14);
    const model = r.usedLocal ? '本地' : '云端';
    const time = (r.elapsed / 1000).toFixed(1).padStart(6);
    const status = r.success ? '✅ 成功' : (r.usedLocal ? '⚠️ 验证失败' : '🔄 降级');
    console.log(`  │ ${agent} │ ${name} │ ${model.padEnd(6)} │ ${time} │ ${status} │`);
  }
  console.log('  └──────────────┴────────────────┴────────┴──────────┴──────────┘');

  // 稳定性结论
  const stability = localUsed > 0 ? ((localSuccess / localUsed) * 100).toFixed(0) : 0;
  console.log(`\n  稳定性评估: 本地模型成功率 ${stability}%`);
  if (Number(stability) >= 80) {
    console.log('  结论: ✅ 稳定 — 本地模型接入可靠，可放心使用');
  } else if (Number(stability) >= 50) {
    console.log('  结论: ⚠️ 基本可用 — 部分场景需优化提示模板');
  } else {
    console.log('  结论: ❌ 不稳定 — 建议检查模型配置或提示模板');
  }

  console.log('\n完成！');
}

runBatchTest().catch(console.error);
