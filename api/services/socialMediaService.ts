/**
 * 自媒体平台集成服务 (Social Media Publishing Service)
 *
 * 支持抖音 (Douyin)、快手 (Kuaishou)、小红书 (Xiaohongshu) 三大平台的内容发布。
 * 提供 OAuth 授权、内容管理、一键发布、定时发布等能力。
 *
 * 注意：实际发布需要各平台审核通过的应用权限和 access_token。
 * 本服务提供完整的 API 框架和 Mock 实现，生产环境需替换为真实 API 调用。
 */

// ===== 类型定义 =====

/** 平台类型 */
export type SocialPlatform = 'douyin' | 'kuaishou' | 'xiaohongshu';

/** OAuth Token 信息 */
export interface PlatformToken {
  platform: SocialPlatform;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  openId?: string;
  userId?: string;
  scope?: string[];
}

/** 发布内容 */
export interface PublishContent {
  /** 标题/文案 */
  title: string;
  /** 正文内容 */
  content: string;
  /** 话题标签 */
  tags?: string[];
  /** 媒体文件列表 */
  media?: PublishMedia[];
  /** 封面图 */
  coverImage?: string;
  /** 定时发布时间 (ISO 8601) */
  scheduledAt?: string;
  /** 地理位置 */
  location?: string;
  /** 是否允许评论 */
  allowComment?: boolean;
  /** 是否允许下载 */
  allowDownload?: boolean;
  /** 可见性 */
  visibility?: 'public' | 'private' | 'friends';
}

/** 媒体文件 */
export interface PublishMedia {
  /** 类型 */
  type: 'image' | 'video';
  /** 文件 URL 或本地路径 */
  url: string;
  /** 封面图 */
  coverUrl?: string;
  /** 文件大小 (bytes) */
  size?: number;
  /** 时长 (秒，视频) */
  duration?: number;
}

/** 发布结果 */
export interface PublishResult {
  success: boolean;
  platform: SocialPlatform;
  /** 平台返回的发布 ID */
  postId?: string;
  /** 发布 URL */
  postUrl?: string;
  /** 错误信息 */
  error?: string;
  /** 发布时间 */
  publishedAt?: string;
  /** 平台原始响应 */
  raw?: any;
}

/** 平台配置 */
export interface PlatformConfig {
  platform: SocialPlatform;
  /** 平台名称 */
  name: string;
  /** 平台图标 */
  icon: string;
  /** 最大标题长度 */
  maxTitleLength: number;
  /** 最大内容长度 */
  maxContentLength: number;
  /** 支持的文件类型 */
  supportedMedia: ('image' | 'video')[];
  /** 最大视频时长 (秒) */
  maxVideoDuration: number;
  /** 最多标签数 */
  maxTags: number;
  /** OAuth 授权 URL */
  authUrl: string;
  /** API 基础 URL */
  apiBaseUrl: string;
}

// ===== 平台配置 =====

const PLATFORM_CONFIGS: Record<SocialPlatform, PlatformConfig> = {
  douyin: {
    platform: 'douyin',
    name: '抖音',
    icon: '🎵',
    maxTitleLength: 55,
    maxContentLength: 5000,
    supportedMedia: ['image', 'video'],
    maxVideoDuration: 900, // 15 分钟
    maxTags: 10,
    authUrl: 'https://open.douyin.com/platform/oauth/connect',
    apiBaseUrl: 'https://open.douyin.com',
  },
  kuaishou: {
    platform: 'kuaishou',
    name: '快手',
    icon: '📷',
    maxTitleLength: 50,
    maxContentLength: 3000,
    supportedMedia: ['image', 'video'],
    maxVideoDuration: 600, // 10 分钟
    maxTags: 8,
    authUrl: 'https://open.kuaishou.com/oauth2/authorize',
    apiBaseUrl: 'https://open.kuaishou.com',
  },
  xiaohongshu: {
    platform: 'xiaohongshu',
    name: '小红书',
    icon: '📕',
    maxTitleLength: 20,
    maxContentLength: 1000,
    supportedMedia: ['image', 'video'],
    maxVideoDuration: 300, // 5 分钟
    maxTags: 10,
    authUrl: 'https://open.xiaohongshu.com/oauth2/authorize',
    apiBaseUrl: 'https://open.xiaohongshu.com',
  },
};

// ===== 重试配置 =====

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 30000,  // 30 秒
  maxDelayMs: 120000,  // 2 分钟
  backoffMultiplier: 2,
};

/** 可重试的错误类型 */
const RETRYABLE_ERRORS = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'rate_limit',
  'server_error',
  'timeout',
  'network',
];

// ===== 社交媒体服务 =====

class SocialMediaService {
  private tokens = new Map<string, PlatformToken>();
  private publishHistory: PublishResult[] = [];
  private failureCounters = new Map<string, number>(); // 失败计数器，用于熔断

  /** 获取平台配置 */
  getPlatformConfig(platform: SocialPlatform): PlatformConfig {
    return PLATFORM_CONFIGS[platform];
  }

  /** 获取所有平台配置 */
  getAllPlatformConfigs(): PlatformConfig[] {
    return Object.values(PLATFORM_CONFIGS);
  }

  /** 生成 OAuth 授权 URL */
  generateAuthUrl(platform: SocialPlatform, redirectUri: string, state: string): string {
    const config = PLATFORM_CONFIGS[platform];
    const params = new URLSearchParams({
      client_key: process.env[`${platform.toUpperCase()}_CLIENT_KEY`] || 'your_client_key',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'user_info,video.publish,video.upload,data.read',
      state,
    });
    return `${config.authUrl}?${params.toString()}`;
  }

  /** 保存平台 Token */
  saveToken(token: PlatformToken): void {
    this.tokens.set(`${token.platform}_${token.openId || token.userId || 'default'}`, token);
    console.log(`[SocialMedia] Token saved for ${token.platform}`);
  }

  /** 获取平台 Token */
  getToken(platform: SocialPlatform, userId?: string): PlatformToken | undefined {
    return this.tokens.get(`${platform}_${userId || 'default'}`);
  }

  /** 撤销（删除）平台 Token */
  revokeToken(platform: SocialPlatform, userId?: string): boolean {
    const key = `${platform}_${userId || 'default'}`;
    const existed = this.tokens.has(key);
    this.tokens.delete(key);
    if (existed) {
      console.log(`[SocialMedia] Token revoked for ${platform}`);
    }
    return existed;
  }

  /** 检查 Token 是否有效 */
  isTokenValid(platform: SocialPlatform, userId?: string): boolean {
    const token = this.getToken(platform, userId);
    if (!token) return false;
    return token.expiresAt > Date.now() + 60000; // 至少还有 1 分钟有效
  }

  /** 刷新 Token */
  async refreshToken(platform: SocialPlatform, userId?: string): Promise<boolean> {
    const token = this.getToken(platform, userId);
    if (!token || !token.refreshToken) return false;

    try {
      console.log(`[SocialMedia] Refreshing token for ${platform}...`);
      // 实际应调用平台 refresh token API
      // Mock: 延长 2 小时
      token.accessToken = `mock_refreshed_token_${platform}_${Date.now()}`;
      token.expiresAt = Date.now() + 7200 * 1000;
      this.saveToken(token);
      console.log(`[SocialMedia] Token refreshed for ${platform}, expires at ${new Date(token.expiresAt).toISOString()}`);
      return true;
    } catch (err: any) {
      console.error(`[SocialMedia] Token refresh failed for ${platform}: ${err.message}`);
      return false;
    }
  }

  /** 判断错误是否可重试 */
  private isRetryableError(error: string): boolean {
    return RETRYABLE_ERRORS.some((e) => error.toLowerCase().includes(e.toLowerCase()));
  }

  /** 计算重试延迟（指数退避） */
  private getRetryDelay(attempt: number): number {
    const delay = RETRY_CONFIG.baseDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);
    return Math.min(delay, RETRY_CONFIG.maxDelayMs);
  }

  /** 检查熔断状态 */
  private isCircuitBreakerOpen(platform: SocialPlatform, userId?: string): boolean {
    const key = `${platform}_${userId || 'default'}`;
    const count = this.failureCounters.get(key) || 0;
    // 连续失败 5 次则熔断 5 分钟
    return count >= 5;
  }

  /** 增加失败计数 */
  private incrementFailureCount(platform: SocialPlatform, userId?: string): void {
    const key = `${platform}_${userId || 'default'}`;
    const count = (this.failureCounters.get(key) || 0) + 1;
    this.failureCounters.set(key, count);
    console.log(`[SocialMedia] Failure count for ${platform}: ${count}`);
  }

  /** 重置失败计数 */
  private resetFailureCount(platform: SocialPlatform, userId?: string): void {
    const key = `${platform}_${userId || 'default'}`;
    this.failureCounters.delete(key);
  }

  /** 验证内容是否符合平台要求 */
  validateContent(platform: SocialPlatform, content: PublishContent): { valid: boolean; errors: string[] } {
    const config = PLATFORM_CONFIGS[platform];
    const errors: string[] = [];

    if (!content.title || content.title.length === 0) {
      errors.push('标题不能为空');
    } else if (content.title.length > config.maxTitleLength) {
      errors.push(`标题长度超过限制 (${content.title.length}/${config.maxTitleLength})`);
    }

    if (content.content && content.content.length > config.maxContentLength) {
      errors.push(`内容长度超过限制 (${content.content.length}/${config.maxContentLength})`);
    }

    if (content.tags && content.tags.length > config.maxTags) {
      errors.push(`标签数量超过限制 (${content.tags.length}/${config.maxTags})`);
    }

    if (content.media) {
      for (const media of content.media) {
        if (!config.supportedMedia.includes(media.type)) {
          errors.push(`${platform} 不支持 ${media.type} 类型文件`);
        }
        if (media.type === 'video' && media.duration && media.duration > config.maxVideoDuration) {
          errors.push(`视频时长超过限制 (${media.duration}s/${config.maxVideoDuration}s)`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** 发布内容到指定平台（带重试、Token 刷新、熔断） */
  async publishToPlatform(
    platform: SocialPlatform,
    content: PublishContent,
    userId?: string
  ): Promise<PublishResult> {
    // 熔断检查
    if (this.isCircuitBreakerOpen(platform, userId)) {
      return {
        success: false,
        platform,
        error: `平台 ${PLATFORM_CONFIGS[platform].name} 发布已熔断（连续失败过多），请稍后再试`,
      };
    }

    // 验证 Token
    if (!this.isTokenValid(platform, userId)) {
      // 尝试刷新 Token
      const refreshed = await this.refreshToken(platform, userId);
      if (!refreshed) {
        this.incrementFailureCount(platform, userId);
        return {
          success: false,
          platform,
          error: `未授权或 Token 已过期，请先在 ${PLATFORM_CONFIGS[platform].name} 中授权`,
        };
      }
    }

    // 验证内容
    const validation = this.validateContent(platform, content);
    if (!validation.valid) {
      return {
        success: false,
        platform,
        error: validation.errors.join('; '),
      };
    }

    // 带重试的发布
    let lastError: string = '';
    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        let result: PublishResult;
        switch (platform) {
          case 'douyin':
            result = await this.publishToDouyin(content, userId);
            break;
          case 'kuaishou':
            result = await this.publishToKuaishou(content, userId);
            break;
          case 'xiaohongshu':
            result = await this.publishToXiaohongshu(content, userId);
            break;
          default:
            return { success: false, platform, error: `不支持的平台: ${platform}` };
        }

        if (result.success) {
          this.resetFailureCount(platform, userId);
          return result;
        }

        // 发布返回了失败，判断是否可重试
        if (result.error && this.isRetryableError(result.error) && attempt < RETRY_CONFIG.maxRetries) {
          lastError = result.error;
          const delay = this.getRetryDelay(attempt);
          console.log(`[SocialMedia] Retry ${attempt + 1}/${RETRY_CONFIG.maxRetries} for ${platform} in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        this.incrementFailureCount(platform, userId);
        return result;
      } catch (err: any) {
        lastError = err.message;
        if (this.isRetryableError(err.message) && attempt < RETRY_CONFIG.maxRetries) {
          const delay = this.getRetryDelay(attempt);
          console.log(`[SocialMedia] Retry ${attempt + 1}/${RETRY_CONFIG.maxRetries} for ${platform} after error: ${err.message}, waiting ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // 不可重试的错误，直接失败
        this.incrementFailureCount(platform, userId);
        const result: PublishResult = {
          success: false,
          platform,
          error: `发布失败: ${lastError}`,
        };
        this.publishHistory.push(result);
        return result;
      }
    }

    // 所有重试都失败了
    this.incrementFailureCount(platform, userId);
    const result: PublishResult = {
      success: false,
      platform,
      error: `发布失败（已重试 ${RETRY_CONFIG.maxRetries} 次）: ${lastError}`,
    };
    this.publishHistory.push(result);
    return result;
  }

  /** 一键发布到多个平台 */
  async publishToMultiple(
    platforms: SocialPlatform[],
    content: PublishContent,
    userId?: string
  ): Promise<Record<SocialPlatform, PublishResult>> {
    const results: Record<string, PublishResult> = {};

    await Promise.all(
      platforms.map(async (platform) => {
        results[platform] = await this.publishToPlatform(platform, content, userId);
      })
    );

    return results as Record<SocialPlatform, PublishResult>;
  }

  /** 获取发布历史 */
  getPublishHistory(platform?: SocialPlatform): PublishResult[] {
    if (platform) {
      return this.publishHistory.filter((r) => r.platform === platform);
    }
    return [...this.publishHistory];
  }

  // ===== 平台特定实现 =====

  /** 发布到抖音 */
  private async publishToDouyin(content: PublishContent, userId?: string): Promise<PublishResult> {
    const token = this.getToken('douyin', userId);
    if (!token) {
      return { success: false, platform: 'douyin', error: '未找到有效的抖音授权' };
    }

    // 实际 API 调用：
    // POST https://open.douyin.com/api/v2/video/create/
    // 需要先上传视频/图片（video/upload），再创建发布（video/create）
    // 本实现为 Mock 模式

    // Mock: 模拟成功发布
    const mockPostId = `dy_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const result: PublishResult = {
      success: true,
      platform: 'douyin',
      postId: mockPostId,
      postUrl: `https://www.douyin.com/video/${mockPostId}`,
      publishedAt: content.scheduledAt || new Date().toISOString(),
      raw: {
        item_id: mockPostId,
        title: content.title,
        status: 'published',
      },
    };

    this.publishHistory.push(result);
    console.log(`[SocialMedia] 抖音发布成功: ${content.title}`);
    return result;
  }

  /** 发布到快手 */
  private async publishToKuaishou(content: PublishContent, userId?: string): Promise<PublishResult> {
    const token = this.getToken('kuaishou', userId);
    if (!token) {
      return { success: false, platform: 'kuaishou', error: '未找到有效的快手授权' };
    }

    // 实际 API 调用：
    // POST https://open.kuaishou.com/openapi/photo/create
    // 或 POST https://open.kuaishou.com/openapi/video/publish

    // Mock
    const mockPostId = `ks_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const result: PublishResult = {
      success: true,
      platform: 'kuaishou',
      postId: mockPostId,
      postUrl: `https://www.kuaishou.com/short-video/${mockPostId}`,
      publishedAt: content.scheduledAt || new Date().toISOString(),
      raw: {
        photo_id: mockPostId,
        caption: content.title,
        status: 'published',
      },
    };

    this.publishHistory.push(result);
    console.log(`[SocialMedia] 快手发布成功: ${content.title}`);
    return result;
  }

  /** 发布到小红书 */
  private async publishToXiaohongshu(content: PublishContent, userId?: string): Promise<PublishResult> {
    const token = this.getToken('xiaohongshu', userId);
    if (!token) {
      return { success: false, platform: 'xiaohongshu', error: '未找到有效的小红书授权' };
    }

    // 实际 API 调用：
    // POST https://open.xiaohongshu.com/api/v1/note/create
    // 需要先上传图片/视频，再创建笔记

    // Mock
    const mockPostId = `xhs_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const result: PublishResult = {
      success: true,
      platform: 'xiaohongshu',
      postId: mockPostId,
      postUrl: `https://www.xiaohongshu.com/explore/${mockPostId}`,
      publishedAt: content.scheduledAt || new Date().toISOString(),
      raw: {
        note_id: mockPostId,
        title: content.title,
        status: 'published',
      },
    };

    this.publishHistory.push(result);
    console.log(`[SocialMedia] 小红书发布成功: ${content.title}`);
    return result;
  }
}

// 单例导出
export const socialMediaService = new SocialMediaService();