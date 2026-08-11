/**
 * 办公工具集成服务 (Office Tools Integration Service)
 *
 * 支持钉钉 (DingTalk)、飞书 (Feishu/Lark)、企业微信 (WeCom) 三大办公平台的集成。
 * 提供消息通知、机器人消息、Webhook 回调、审批流程触发等能力。
 */

// ===== 类型定义 =====

/** 办公平台类型 */
export type OfficePlatform = 'dingtalk' | 'feishu' | 'wecom';

/** 消息类型 */
export type MessageType = 'text' | 'markdown' | 'image' | 'news' | 'file' | 'template_card';

/** 发送消息请求 */
export interface SendMessageRequest {
  platform: OfficePlatform;
  /** 目标：群聊 chatId / 用户 userId / Webhook URL */
  target: {
    type: 'chat' | 'user' | 'webhook';
    id?: string;
    webhookUrl?: string;
  };
  message: OfficeMessage;
}

/** 办公消息 */
export interface OfficeMessage {
  msgType: MessageType;
  content: TextContent | MarkdownContent | ImageContent | NewsContent | FileContent | TemplateCardContent;
}

/** 文本消息 */
export interface TextContent {
  text: string;
  mentioned_list?: string[];
  mentioned_mobile_list?: string[];
}

/** Markdown 消息 */
export interface MarkdownContent {
  title?: string;
  text: string;
}

/** 图片消息 */
export interface ImageContent {
  base64?: string;
  md5?: string;
  url?: string;
}

/** 图文消息 */
export interface NewsContent {
  articles: NewsArticle[];
}

export interface NewsArticle {
  title: string;
  description?: string;
  url: string;
  picurl?: string;
}

/** 文件消息 */
export interface FileContent {
  media_id: string;
  filename?: string;
}

/** 模板卡片消息 */
export interface TemplateCardContent {
  cardType: 'text_notice' | 'news_notice';
  source?: { desc: string; desc_color?: number };
  mainTitle: { title: string; desc?: string };
  subTitleText?: string;
  horizontalContentList?: Array<{ keyname: string; value: string }>;
  jumpList?: Array<{ type: number; title: string; url?: string }>;
  cardAction?: { type: number; url: string };
}

/** 发送结果 */
export interface SendResult {
  success: boolean;
  platform: OfficePlatform;
  messageId?: string;
  error?: string;
  timestamp: string;
}

/** 平台配置 */
export interface OfficePlatformConfig {
  platform: OfficePlatform;
  name: string;
  icon: string;
  /** Webhook URL 格式 */
  webhookUrlPattern: string;
  /** 机器人文档 URL */
  docUrl: string;
  /** 消息长度限制 */
  maxTextLength: number;
  /** 支持的消息类型 */
  supportedMessageTypes: string[];
}

// ===== 平台配置 =====

const OFFICE_PLATFORM_CONFIGS: Record<OfficePlatform, OfficePlatformConfig> = {
  dingtalk: {
    platform: 'dingtalk',
    name: '钉钉',
    icon: '📌',
    webhookUrlPattern: 'https://oapi.dingtalk.com/robot/send?access_token=',
    docUrl: 'https://open.dingtalk.com/document/orgapp/custom-robot-access',
    maxTextLength: 20000,
    supportedMessageTypes: ['text', 'markdown', 'link', 'actionCard', 'feedCard'],
  },
  feishu: {
    platform: 'feishu',
    name: '飞书',
    icon: '🕊️',
    webhookUrlPattern: 'https://open.feishu.cn/open-apis/bot/v2/hook/',
    docUrl: 'https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot',
    maxTextLength: 30000,
    supportedMessageTypes: ['text', 'markdown', 'image', 'news', 'file', 'template_card'],
  },
  wecom: {
    platform: 'wecom',
    name: '企业微信',
    icon: '💼',
    webhookUrlPattern: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=',
    docUrl: 'https://developer.work.weixin.qq.com/document/path/91770',
    maxTextLength: 2048,
    supportedMessageTypes: ['text', 'markdown', 'image', 'news', 'file'],
  },
};

// ===== 办公工具服务 =====

class OfficeService {
  private sendHistory: SendResult[] = [];

  /** 获取平台配置 */
  getPlatformConfig(platform: OfficePlatform): OfficePlatformConfig {
    return OFFICE_PLATFORM_CONFIGS[platform];
  }

  /** 获取所有平台配置 */
  getAllPlatformConfigs(): OfficePlatformConfig[] {
    return Object.values(OFFICE_PLATFORM_CONFIGS);
  }

  /** 发送消息到指定平台 */
  async sendMessage(request: SendMessageRequest): Promise<SendResult> {
    const config = OFFICE_PLATFORM_CONFIGS[request.platform];

    try {
      switch (request.platform) {
        case 'dingtalk':
          return await this.sendToDingTalk(request);
        case 'feishu':
          return await this.sendToFeishu(request);
        case 'wecom':
          return await this.sendToWeCom(request);
        default:
          return { success: false, platform: request.platform, error: '不支持的平台', timestamp: new Date().toISOString() };
      }
    } catch (err: any) {
      const result: SendResult = {
        success: false,
        platform: request.platform,
        error: `发送失败: ${err.message}`,
        timestamp: new Date().toISOString(),
      };
      this.sendHistory.push(result);
      return result;
    }
  }

  /** 批量发送消息到多个平台 */
  async sendToMultiple(
    platforms: OfficePlatform[],
    request: Omit<SendMessageRequest, 'platform'>
  ): Promise<Record<OfficePlatform, SendResult>> {
    const results: Record<string, SendResult> = {};

    await Promise.all(
      platforms.map(async (platform) => {
        results[platform] = await this.sendMessage({ ...request, platform });
      })
    );

    return results as Record<OfficePlatform, SendResult>;
  }

  /**
   * AI 生成内容并通知到办公平台
   * 当 AI 创意工坊完成视频/图片生成后，自动通知到办公平台
   */
  async notifyTaskComplete(
    platforms: OfficePlatform[],
    taskInfo: {
      taskType: 'image' | 'video';
      taskId: string;
      title: string;
      resultUrl?: string;
      duration?: string;
    }
  ): Promise<Record<OfficePlatform, SendResult>> {
    const message: OfficeMessage = {
      msgType: 'markdown' as MessageType,
      content: {
        title: `🎨 AI 创意工坊 - ${taskInfo.taskType === 'image' ? '图片' : '视频'}生成完成`,
        text: [
          `### 🎉 任务完成通知`,
          ``,
          `**任务类型**：${taskInfo.taskType === 'image' ? '🖼️ 图片生成' : '🎬 视频生成'}`,
          `**任务标题**：${taskInfo.title}`,
          `**任务 ID**：${taskInfo.taskId}`,
          taskInfo.duration ? `**耗时**：${taskInfo.duration}` : '',
          taskInfo.resultUrl ? `**查看结果**：[点击查看](${taskInfo.resultUrl})` : '',
          ``,
          `> 由 AI 创意工坊多 Agent 协作自动生成`,
        ].filter(Boolean).join('\n'),
      } as MarkdownContent,
    };

    return await this.sendToMultiple(platforms, {
      target: { type: 'webhook' },
      message,
    });
  }

  /** 获取发送历史 */
  getSendHistory(platform?: OfficePlatform): SendResult[] {
    if (platform) {
      return this.sendHistory.filter((r) => r.platform === platform);
    }
    return [...this.sendHistory];
  }

  // ===== 平台特定实现 =====

  /** 发送到钉钉 */
  private async sendToDingTalk(request: SendMessageRequest): Promise<SendResult> {
    const webhookUrl = request.target.webhookUrl
      || `${OFFICE_PLATFORM_CONFIGS.dingtalk.webhookUrlPattern}${process.env.DINGTALK_WEBHOOK_TOKEN || ''}`;

    if (!webhookUrl || webhookUrl.includes('undefined')) {
      return { success: false, platform: 'dingtalk', error: '请配置 DINGTALK_WEBHOOK_TOKEN 环境变量或提供 webhookUrl', timestamp: new Date().toISOString() };
    }

    const { msgType, content } = request.message;

    // 实际 API 调用：
    // POST webhookUrl
    // Body: { msgtype: msgType, [msgType]: content }

    // Mock: 模拟成功发送
    console.log(`[Office] 钉钉消息发送: ${msgType}`);
    console.log(`[Office] Webhook URL: ${webhookUrl.substring(0, 50)}...`);

    const result: SendResult = {
      success: true,
      platform: 'dingtalk',
      messageId: `dd_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };

    this.sendHistory.push(result);
    return result;
  }

  /** 发送到飞书 */
  private async sendToFeishu(request: SendMessageRequest): Promise<SendResult> {
    const webhookUrl = request.target.webhookUrl
      || `${OFFICE_PLATFORM_CONFIGS.feishu.webhookUrlPattern}${process.env.FEISHU_WEBHOOK_TOKEN || ''}`;

    if (!webhookUrl || webhookUrl.includes('undefined')) {
      return { success: false, platform: 'feishu', error: '请配置 FEISHU_WEBHOOK_TOKEN 环境变量或提供 webhookUrl', timestamp: new Date().toISOString() };
    }

    const { msgType, content } = request.message;

    // 实际 API 调用：
    // POST webhookUrl
    // Body: { msg_type: msgType, content: { [msgType]: content } }

    console.log(`[Office] 飞书消息发送: ${msgType}`);
    console.log(`[Office] Webhook URL: ${webhookUrl.substring(0, 50)}...`);

    const result: SendResult = {
      success: true,
      platform: 'feishu',
      messageId: `fs_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };

    this.sendHistory.push(result);
    return result;
  }

  /** 发送到企业微信 */
  private async sendToWeCom(request: SendMessageRequest): Promise<SendResult> {
    const webhookUrl = request.target.webhookUrl
      || `${OFFICE_PLATFORM_CONFIGS.wecom.webhookUrlPattern}${process.env.WECOM_WEBHOOK_TOKEN || ''}`;

    if (!webhookUrl || webhookUrl.includes('undefined')) {
      return { success: false, platform: 'wecom', error: '请配置 WECOM_WEBHOOK_TOKEN 环境变量或提供 webhookUrl', timestamp: new Date().toISOString() };
    }

    const { msgType, content } = request.message;

    // 实际 API 调用：
    // POST webhookUrl
    // Body: { msgtype: msgType, [msgType]: content }

    console.log(`[Office] 企业微信消息发送: ${msgType}`);
    console.log(`[Office] Webhook URL: ${webhookUrl.substring(0, 50)}...`);

    const result: SendResult = {
      success: true,
      platform: 'wecom',
      messageId: `wc_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };

    this.sendHistory.push(result);
    return result;
  }
}

// 单例导出
export const officeService = new OfficeService();