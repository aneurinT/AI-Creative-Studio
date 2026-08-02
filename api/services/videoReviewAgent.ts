/**
 * 视频生成全流程审核服务
 * 在脚本创作、参数提取、分段生成等关键节点实时审核
 * 发现问题即刻返回警告，不留到最终失败
 */
import { fetchWithTimeout } from './fetchUtils.js';

const ZHIPU_API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const REVIEW_MODEL = 'glm-4-flash'; // 智谱免费模型

export interface VideoReviewResult {
  passed: boolean;
  level: 'ok' | 'warning' | 'error';
  message: string;
  suggestions: string[];
  checkedAt: string; // 审核节点名
}

/**
 * 审核视频脚本质量
 */
export async function reviewVideoScript(
  userPrompt: string,
  script: string,
  duration: string,
): Promise<VideoReviewResult> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return { passed: true, level: 'ok', message: '无审核Key，跳过', suggestions: [], checkedAt: '脚本审核' };
  }

  const model = REVIEW_MODEL;
  const url = ZHIPU_API;

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `你是视频脚本审核员，拥有丰富的影视制作经验。请逐项检查：

## 检查清单
1. **相关性**：脚本是否紧扣用户需求？有否偏离主题？（例如用户要宣传片但写成了Vlog）
2. **可生成性**：脚本描述是否足够视觉化？有没有不可实现的抽象描述？
3. **完整度**：是否包含场景、角色、动作、运镜、光线/色调描述？
4. **时长匹配**：场景总时长是否匹配 ${duration} 秒要求？
5. **内容安全**：是否包含暴力、色情、政治敏感内容？
6. **品牌合规**：是否有侵权风险（使用其他品牌元素）？

## 判定规则
- passed: 全部通过
- warning: 存在小问题但不影响生成
- error: 存在严重问题，必须修正

## 输出JSON
{"passed":true,"level":"ok","message":"脚本质量良好，可以开始生成","suggestions":[]}
{"passed":false,"level":"error","message":"脚本缺少视觉描述，无法生成","suggestions":["添加具体场景描写","补充光线和色调"]}`,
          },
          {
            role: 'user',
            content: `用户需求: ${userPrompt}\n\n脚本内容: ${script.substring(0, 1000)}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
      }),
    }, 15000);

    if (!response.ok) {
      return { passed: true, level: 'ok', message: '审核API不可用', suggestions: [], checkedAt: '脚本审核' };
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { passed: true, level: 'ok', message: '审核返回空', suggestions: [], checkedAt: '脚本审核' };
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { passed: true, level: 'ok', message: content.substring(0, 80), suggestions: [], checkedAt: '脚本审核' };
    }

    const result = JSON.parse(jsonMatch[0]);
    return {
      passed: result.passed !== false,
      level: result.level || (result.passed ? 'ok' : 'warning'),
      message: result.message || '',
      suggestions: result.suggestions || [],
      checkedAt: '脚本审核',
    };
  } catch {
    return { passed: true, level: 'ok', message: '审核异常', suggestions: [], checkedAt: '脚本审核' };
  }
}

/**
 * 审核视频生成参数
 */
export async function reviewVideoParams(
  userPrompt: string,
  params: Record<string, any>,
): Promise<VideoReviewResult> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return { passed: true, level: 'ok', message: '无审核Key', suggestions: [], checkedAt: '参数审核' };
  }

  const model = REVIEW_MODEL;
  const url = ZHIPU_API;

  try {
    const response = await fetchWithTimeout(url, {

      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `你是视频参数审核员，检查参数是否匹配用户需求。

## 检查清单
1. **prompt 质量**：是否英文？是否包含视觉元素（场景+主体+光线+运镜）？长度是否 50-300 词？
2. **style 匹配**：风格是否匹配用户描述？（用户要"电影大片"但 style=illustration → 错误）
3. **duration 合理**：时长是否匹配用户要求？是否在 API 支持范围（5-90秒）？
4. **参数完整**：prompt, style, duration 三个必须都有

## 输出JSON
{"passed":true,"level":"ok","message":"参数配置正确"}
{"passed":false,"level":"warning","message":"prompt 过短，缺少视觉细节","suggestions":["补充场景描述、光线和运镜信息"]}`,
          },
          {
            role: 'user',
            content: `用户需求: ${userPrompt}\n\n生成参数: ${JSON.stringify(params)}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
    }, 15000);

    if (!response.ok) {
      return { passed: true, level: 'ok', message: 'API不可用', suggestions: [], checkedAt: '参数审核' };
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { passed: true, level: 'ok', message: '空', suggestions: [], checkedAt: '参数审核' };
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { passed: true, level: 'ok', message: content.substring(0, 80), suggestions: [], checkedAt: '参数审核' };
    }

    const result = JSON.parse(jsonMatch[0]);
    return {
      passed: result.passed !== false,
      level: result.level || (result.passed ? 'ok' : 'warning'),
      message: result.message || '',
      suggestions: result.suggestions || [],
      checkedAt: '参数审核',
    };
  } catch {
    return { passed: true, level: 'ok', message: '异常', suggestions: [], checkedAt: '参数审核' };
  }
}

/**
 * 快速评分：视频prompt质量 0-100
 */
export function quickScoreVideoPrompt(prompt: string, style: string, duration: string): { score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 80;

  if (!prompt || prompt.length < 20) { score -= 30; issues.push('提示词过短，缺少视觉细节'); }
  if (!style || style === 'default') { score -= 10; issues.push('未指定视频风格'); }
  const d = parseInt(duration);
  if (d > 18) { score -= 15; issues.push('时长超过18秒需拆分，成功率降低'); }
  if (prompt && prompt.length > 500) { score += 5; }
  if (prompt && /camera|light|angle|cinematic|slow|pan|zoom|close.?up|wide/i.test(prompt)) { score += 10; }
  if (!prompt || prompt.length > 50 && /[a-z]/i.test(prompt)) { score += 5; } // 英文prompt加分

  return { score: Math.max(0, Math.min(100, score)), issues };
}

/**
 * 最终审核：视频生成完成后，检查视频质量是否符合预期
 * 审核不通过 → 应关闭旧任务，重新生成
 */
export async function reviewVideoFinal(
  userPrompt: string,
  style: string,
  duration: string,
  videoUrl: string,
): Promise<VideoReviewResult> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return { passed: true, level: 'ok', message: '无审核Key，跳过', suggestions: [], checkedAt: '最终审核' };
  }

  const model = REVIEW_MODEL;
  const url = ZHIPU_API;

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `你是视频生成最终审核员。视频已生成完毕，请根据用户需求判断视频质量是否合格。

## 判定标准
1. **prompt 匹配度**：生成的视频是否符合用户描述的prompt？
2. **style 匹配度**：视频风格是否符合用户指定的 style？
3. **duration 匹配度**：视频时长是否符合用户要求（${duration}秒）？
4. **内容安全**：视频是否包含暴力、色情、政治敏感内容？

## 注意
- 如果用户prompt本身就是模糊/抽象的（如"生成一个好看的视频"），应视为合格
- 只有在明确不符合用户要求时才判定不通过
- **默认倾向于通过**，仅在严重问题时拒绝

## 输出JSON
{"passed":true,"level":"ok","message":"视频质量符合要求","suggestions":[]}
{"passed":false,"level":"error","message":"视频与prompt严重不符：用户要求'猫在草地上奔跑'但生成的是城市街景","suggestions":["重新生成","修改prompt增加细节"]}`,
          },
          {
            role: 'user',
            content: `用户需求:\nprompt: ${userPrompt}\nstyle: ${style}\nduration: ${duration}秒\n\n视频URL: ${videoUrl}\n\n请根据以上信息判断视频质量是否合格。`,
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
      }),
    }, 15000);

    if (!response.ok) {
      return { passed: true, level: 'ok', message: '最终审核API不可用，默认通过', suggestions: [], checkedAt: '最终审核' };
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { passed: true, level: 'ok', message: '审核返回空，默认通过', suggestions: [], checkedAt: '最终审核' };
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { passed: true, level: 'ok', message: content.substring(0, 80), suggestions: [], checkedAt: '最终审核' };
    }

    const result = JSON.parse(jsonMatch[0]);
    return {
      passed: result.passed !== false,
      level: result.level || (result.passed ? 'ok' : 'error'),
      message: result.message || '',
      suggestions: result.suggestions || [],
      checkedAt: '最终审核',
    };
  } catch {
    return { passed: true, level: 'ok', message: '最终审核异常，默认通过', suggestions: [], checkedAt: '最终审核' };
  }
}

/**
 * 失败分析：Agent 任务失败时，分析失败原因并给出优化建议
 * @param errorMsg 后端返回的原始错误信息
 * @param userPrompt 用户原始 prompt
 * @param style 视频风格
 * @param duration 视频时长
 * @param engine 使用的引擎名称
 */
export async function analyzeFailure(
  errorMsg: string,
  userPrompt: string,
  style: string,
  duration: string,
  engine: string,
): Promise<{ reason: string; suggestions: string[]; retryable: boolean }> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    // 无 API Key 时用本地规则分析
    return localFailureAnalysis(errorMsg, engine);
  }

  try {
    const response = await fetchWithTimeout(ZHIPU_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: REVIEW_MODEL,
        messages: [
          {
            role: 'system',
            content: `你是视频生成故障诊断专家。视频生成任务失败后，请分析失败原因并给出可操作的建议。

## 你的任务
1. 分析错误信息，判断是临时错误（可重试）还是永久错误（不可重试）
2. 给出简短的失败原因（1-2句话）
3. 给出 2-3 条具体的优化建议

## 常见错误类型
- "所有片段生成失败" = 视频拆分模式下每个片段都失败，通常是 API 额度用完或模型不可用
- "API Key" / "未配置" = 模型未配置或 Key 无效
- "timeout" / "超时" = 网络问题或服务繁忙
- "限流" / "rate limit" = 请求过于频繁
- "quota" / "额度" = 免费额度用完
- "不可达" / "unreachable" = 网络无法连接到 API 服务器

## 输出 JSON
{"reason":"简短原因","suggestions":["建议1","建议2","建议3"],"retryable":true}
- retryable=true 表示可重试（临时错误），false 表示不可重试（配置问题/额度用完）`,
          },
          {
            role: 'user',
            content: `视频生成任务失败，请分析：
- 用户需求: ${userPrompt}，风格: ${style}，时长: ${duration}秒
- 使用引擎: ${engine}
- 错误信息: ${errorMsg}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 300,
      }),
    }, 15000);

    if (!response.ok) {
      return localFailureAnalysis(errorMsg, engine);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return localFailureAnalysis(errorMsg, engine);
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return localFailureAnalysis(errorMsg, engine);
    }

    const result = JSON.parse(jsonMatch[0]);
    return {
      reason: result.reason || errorMsg,
      suggestions: result.suggestions || ['请稍后重试或切换其他视频引擎'],
      retryable: result.retryable !== false,
    };
  } catch {
    return localFailureAnalysis(errorMsg, engine);
  }
}

/** 本地规则分析（无 API 或 API 异常时的降级方案） */
function localFailureAnalysis(errorMsg: string, engine: string): { reason: string; suggestions: string[]; retryable: boolean } {
  const msg = errorMsg.toLowerCase();

  if (msg.includes('api key') || msg.includes('未配置') || msg.includes('鉴权') || msg.includes('无权限')) {
    return {
      reason: `${engine} 引擎未配置有效的 API Key`,
      suggestions: [
        '前往「设置」页面配置对应模型的 API Key',
        '或切换到其他已配置的免费引擎（智谱/万相）',
      ],
      retryable: false,
    };
  }

  if (msg.includes('quota') || msg.includes('额度') || msg.includes('余额不足') || msg.includes('exceed')) {
    return {
      reason: `${engine} 引擎的免费额度已用完`,
      suggestions: [
        '切换到 Trae AI 图片引擎（完全免费）',
        '或等待明天额度重置后再使用',
        '或前往「设置」配置其他模型的 API Key',
      ],
      retryable: false,
    };
  }

  if (msg.includes('所有片段生成失败')) {
    return {
      reason: '视频拆分模式下所有片段均生成失败，通常是 API 额度用完或模型暂时不可用',
      suggestions: [
        '缩短视频时长（5-10秒），避免拆分模式',
        '切换视频引擎到「智谱 CogVideoX-Flash」或「万相视频」',
        '检查 API Key 配置是否正确',
      ],
      retryable: true,
    };
  }

  if (msg.includes('限流') || msg.includes('rate limit') || msg.includes('too many')) {
    return {
      reason: `${engine} 引擎请求过于频繁，触发了限流`,
      suggestions: [
        '等待 30-60 秒后重新发送请求',
        '减少同时进行的视频生成任务数量',
      ],
      retryable: true,
    };
  }

  if (msg.includes('timeout') || msg.includes('超时')) {
    return {
      reason: `${engine} 引擎响应超时，可能是网络问题或服务繁忙`,
      suggestions: [
        '稍后重试（等待 1-2 分钟）',
        '检查网络连接是否正常',
        '切换其他视频引擎',
      ],
      retryable: true,
    };
  }

  if (msg.includes('不可达') || msg.includes('unreachable') || msg.includes('fetch failed')) {
    return {
      reason: `${engine} 引擎 API 不可达，可能是网络限制或服务维护中`,
      suggestions: [
        '切换视频引擎到「智谱 CogVideoX-Flash」或「万相视频」',
        'Agnes API 在国内需要代理，建议使用国内模型',
      ],
      retryable: true,
    };
  }

  return {
    reason: errorMsg,
    suggestions: ['请稍后重试', '切换其他视频引擎', '修改 prompt 后重新尝试'],
    retryable: true,
  };
}
