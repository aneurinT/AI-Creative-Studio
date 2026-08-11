# AI 创意工坊 - 集成开发文档

> 版本：v2.0 | 更新日期：2026-08-11

---

## 目录

1. [A2A 协议集成](#1-a2a-协议集成)
2. [自媒体平台发布](#2-自媒体平台发布)
3. [办公工具集成](#3-办公工具集成)
4. [API 参考](#4-api-参考)
5. [环境变量配置](#5-环境变量配置)

---

## 1. A2A 协议集成

### 1.1 概述

AI 创意工坊现已实现 [Google A2A (Agent-to-Agent) v1.0](https://a2a-mcp.org/) 协议。通过 A2A 协议，AI 创意工坊的 Agent 可以：

- 发布 **Agent Card**，让其他 Agent 发现和调用你的创意生成能力
- 通过 **Task API** 接收外部 Agent 的创意任务请求
- 作为 **A2A 生态节点**，与 LangGraph、CrewAI、Google ADK 等框架的 Agent 互操作

### 1.2 Agent Card

每个实现 A2A 协议的 Agent 都会发布一个 Agent Card，描述其身份和能力。

**获取 Agent Card**：

```bash
# 标准 A2A 发现端点
curl http://localhost:3001/.well-known/agent-card.json

# 别名端点
curl http://localhost:3001/api/a2a/agent-card
```

**Agent Card 结构**：

```json
{
  "name": "AI创意工坊 (AI Creative Studio)",
  "description": "基于多 Agent 协作的 AI 图片/视频创意生成平台",
  "url": "http://localhost:3001/.well-known/agent-card.json",
  "version": "2.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true,
    "stateTransitionHistory": true
  },
  "skills": [
    {
      "id": "generate_image",
      "name": "Generate Image",
      "description": "根据文本描述生成图片，支持多种风格",
      "tags": ["image", "ai-creative-studio", "mcp"],
      "examples": ["生成一张赛博朋克风格的城市夜景"]
    }
  ],
  "protocolVersion": "1.0"
}
```

### 1.3 Task API

#### 创建 Task

```bash
curl -X POST http://localhost:3001/api/a2a/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "messageId": "msg-001",
      "role": "user",
      "parts": [
        {"type": "text", "text": "生成一张夕阳下的海滩照片"}
      ]
    },
    "sessionId": "session-123",
    "acceptedOutputModes": ["image/png"]
  }'
```

#### 查询 Task 状态

```bash
curl http://localhost:3001/api/a2a/tasks/{taskId}
```

#### 取消 Task

```bash
curl -X DELETE http://localhost:3001/api/a2a/tasks/{taskId}
```

#### 列出所有 Task

```bash
# 列出所有 Task
curl http://localhost:3001/api/a2a/tasks

# 按状态过滤
curl "http://localhost:3001/api/a2a/tasks?state=completed"

# 按会话过滤
curl "http://localhost:3001/api/a2a/tasks?sessionId=session-123"
```

### 1.4 Task 状态流转

```
submitted → working → completed
                   → failed
                   → input-required → working
submitted → canceled
```

### 1.5 对接外部 Agent 框架

#### LangGraph 集成

```python
# 在 LangGraph 中调用 AI 创意工坊的 A2A 接口
import requests

agent_card = requests.get("http://localhost:3001/.well-known/agent-card.json").json()
print(f"发现 Agent: {agent_card['name']}")

# 创建创意任务
task = requests.post("http://localhost:3001/api/a2a/tasks", json={
    "message": {
        "messageId": "lg-001",
        "role": "user",
        "parts": [{"type": "text", "text": "生成产品宣传视频脚本"}]
    }
}).json()
```

#### CrewAI 集成

```python
# 在 CrewAI 中将 AI 创意工坊注册为外部工具
from crewai import Agent, Task

creative_agent = Agent(
    role="创意生成器",
    goal="通过 A2A 协议调用 AI 创意工坊生产视觉内容",
    backstory="我是连接 AI 创意工坊的桥梁 Agent",
    tools=[],  # 可通过自定义工具调用 A2A API
)
```

---

## 2. 自媒体平台发布

### 2.1 概述

AI 创意工坊现已集成 **抖音、快手、小红书** 三大自媒体平台的内容发布能力。结合 AI 创意生成能力，可实现"AI 生成内容 → 一键发布到全平台"的完整工作流。

### 2.2 支持的平台

| 平台 | 图标 | 视频时长上限 | 标题长度 | 标签数量 |
|------|:----:|:-----------:|:-------:|:-------:|
| 抖音 | 🎵 | 15 分钟 | 55 字符 | 10 个 |
| 快手 | 📷 | 10 分钟 | 50 字符 | 8 个 |
| 小红书 | 📕 | 5 分钟 | 20 字符 | 10 个 |

### 2.3 授权流程

```bash
# 1. 获取授权 URL
curl "http://localhost:3001/api/social/auth/douyin?redirectUri=https://your-app.com/callback&state=random123"

# 2. 用户授权后，处理回调
curl -X POST http://localhost:3001/api/social/auth/douyin/callback \
  -H "Content-Type: application/json" \
  -d '{"code": "auth_code_from_platform", "openId": "user_open_id"}'

# 3. 检查授权状态
curl "http://localhost:3001/api/social/auth/douyin/status?userId=user_open_id"
```

### 2.4 内容发布

#### 发布到单个平台

```bash
curl -X POST http://localhost:3001/api/social/publish/douyin \
  -H "Content-Type: application/json" \
  -d '{
    "content": {
      "title": "AI 生成的赛博朋克夜景 🏙️",
      "content": "使用 AI 创意工坊生成的城市夜景，太震撼了！#AI创作 #赛博朋克",
      "tags": ["AI创作", "赛博朋克", "城市夜景"],
      "media": [
        {"type": "image", "url": "http://localhost:3001/images/generated_001.png"}
      ],
      "allowComment": true,
      "visibility": "public"
    }
  }'
```

#### 一键发布到多个平台

```bash
curl -X POST http://localhost:3001/api/social/publish \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["douyin", "kuaishou", "xiaohongshu"],
    "content": {
      "title": "AI 视频：春天的樱花",
      "content": "用 AI 生成的樱花视频，太美了！🌸",
      "tags": ["AI视频", "樱花", "春天"],
      "media": [
        {"type": "video", "url": "http://localhost:3001/videos/sakura.mp4", "duration": 15}
      ]
    }
  }'
```

### 2.5 AI 生成 + 一键发布工作流

```bash
# 完整工作流示例：
# 1. AI 生成视频
# 2. 自动发布到抖音 + 快手 + 小红书

# Step 1: 通过 AI 助手生成视频
curl -X POST http://localhost:3001/api/hermes/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "workflow-001",
    "message": "生成一段15秒的樱花飘落视频"
  }'

# Step 2: 视频生成完成后，一键发布
curl -X POST http://localhost:3001/api/social/publish \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["douyin", "kuaishou", "xiaohongshu"],
    "content": {
      "title": "🌸 AI 樱花飘落",
      "content": "AI 生成的樱花视频，梦幻般的美！",
      "tags": ["AI视频", "樱花", "春天", "AI创作"],
      "media": [{"type": "video", "url": "生成后的视频URL", "duration": 15}]
    }
  }'
```

---

## 3. 办公工具集成

### 3.1 概述

AI 创意工坊现已集成 **钉钉、飞书、企业微信** 三大办公平台。支持：

- 任务完成通知（AI 生成完图片/视频后自动发送通知）
- 自定义消息推送
- 多平台批量发送
- Markdown 格式化消息

### 3.2 支持的平台

| 平台 | 图标 | 文本长度 | 支持的消息类型 |
|------|:----:|:-------:|:-------------|
| 钉钉 | 📌 | 20,000 | text, markdown, link, actionCard |
| 飞书 | 🕊️ | 30,000 | text, markdown, image, news, file, template_card |
| 企业微信 | 💼 | 2,048 | text, markdown, image, news, file |

### 3.3 配置 Webhook

#### 钉钉

1. 打开钉钉群聊 → 群设置 → 智能群助手 → 添加机器人 → 自定义
2. 复制 Webhook URL 中的 `access_token` 参数
3. 配置环境变量：`DINGTALK_WEBHOOK_TOKEN=your_token`

#### 飞书

1. 打开飞书群聊 → 设置 → 群机器人 → 添加机器人 → 自定义机器人
2. 复制 Webhook URL
3. 配置环境变量：`FEISHU_WEBHOOK_TOKEN=your_token`

#### 企业微信

1. 打开企业微信群聊 → 群机器人 → 添加机器人
2. 复制 Webhook URL 中的 `key` 参数
3. 配置环境变量：`WECOM_WEBHOOK_TOKEN=your_key`

### 3.4 发送消息

#### 发送文本消息

```bash
curl -X POST http://localhost:3001/api/office/send/dingtalk \
  -H "Content-Type: application/json" \
  -d '{
    "target": {"type": "webhook"},
    "message": {
      "msgType": "text",
      "content": {"text": "🎨 新的创意任务已完成！"}
    }
  }'
```

#### 发送 Markdown 消息

```bash
curl -X POST http://localhost:3001/api/office/send/feishu \
  -H "Content-Type: application/json" \
  -d '{
    "target": {"type": "webhook"},
    "message": {
      "msgType": "markdown",
      "content": {
        "title": "🎨 AI 创意工坊 - 任务完成通知",
        "text": "### 🎉 视频生成完成\n\n**任务**：产品宣传片\n**时长**：30秒\n**状态**：✅ 已完成\n\n> 由 AI 创意工坊多 Agent 协作生成"
      }
    }
  }'
```

#### 批量发送到多个平台

```bash
curl -X POST http://localhost:3001/api/office/send \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["dingtalk", "feishu", "wecom"],
    "target": {"type": "webhook"},
    "message": {
      "msgType": "text",
      "content": {"text": "📢 重要通知：系统升级完成"}
    }
  }'
```

### 3.5 AI 任务完成自动通知

当 AI 创意工坊完成图片/视频生成后，自动向办公平台发送通知：

```bash
curl -X POST http://localhost:3001/api/office/notify/task-complete \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["dingtalk", "feishu"],
    "taskInfo": {
      "taskType": "video",
      "taskId": "task-001",
      "title": "樱花飘落视频",
      "resultUrl": "http://localhost:3001/videos/sakura.mp4",
      "duration": "45秒"
    }
  }'
```

---

## 4. API 参考

### 4.1 A2A API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/.well-known/agent-card.json` | Agent 发现 |
| GET | `/api/a2a/agent-card` | Agent Card |
| POST | `/api/a2a/tasks` | 创建 Task |
| GET | `/api/a2a/tasks` | 列出 Task |
| GET | `/api/a2a/tasks/:id` | 获取 Task |
| DELETE | `/api/a2a/tasks/:id` | 取消 Task |
| POST | `/api/a2a/tasks/:id/messages` | 追加消息 |
| GET | `/api/a2a/tasks/:id/artifacts` | 获取产物 |
| GET | `/api/a2a/stats` | 服务统计 |
| GET | `/api/a2a/health` | 健康检查 |

### 4.2 社交媒体 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/social/config` | 平台配置 |
| GET | `/api/social/auth/:platform` | 授权 URL |
| POST | `/api/social/auth/:platform/callback` | 授权回调 |
| GET | `/api/social/auth/:platform/status` | 授权状态 |
| POST | `/api/social/publish/:platform` | 发布到单平台 |
| POST | `/api/social/publish` | 一键多平台发布 |
| GET | `/api/social/history` | 发布历史 |
| GET | `/api/social/health` | 健康检查 |

### 4.3 办公工具 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/office/config` | 平台配置 |
| POST | `/api/office/send/:platform` | 发送到单平台 |
| POST | `/api/office/send` | 批量发送 |
| POST | `/api/office/notify/task-complete` | 任务完成通知 |
| POST | `/api/office/preview` | 消息预览 |
| GET | `/api/office/history` | 发送历史 |
| GET | `/api/office/health` | 健康检查 |

---

## 5. 环境变量配置

```bash
# ========================
# 自媒体平台集成
# ========================
DOUYIN_CLIENT_KEY=your_key          # 抖音开放平台 Client Key
DOUYIN_CLIENT_SECRET=your_secret    # 抖音开放平台 Client Secret
KUAISHOU_CLIENT_KEY=your_key        # 快手开放平台 Client Key
KUAISHOU_CLIENT_SECRET=your_secret  # 快手开放平台 Client Secret
XIAOHONGSHU_CLIENT_KEY=your_key     # 小红书开放平台 Client Key
XIAOHONGSHU_CLIENT_SECRET=your_secret # 小红书开放平台 Client Secret

# ========================
# 办公工具集成
# ========================
DINGTALK_WEBHOOK_TOKEN=your_token   # 钉钉机器人 Webhook Token
FEISHU_WEBHOOK_TOKEN=your_token     # 飞书机器人 Webhook Token
WECOM_WEBHOOK_TOKEN=your_key        # 企业微信机器人 Webhook Key
```

---

## 6. 注意事项

1. **A2A 协议**：当前为 v1.0 实现，完全兼容 Google A2A 规范。Agent Card 自动从 MCP 工具注册中心生成技能列表。
2. **自媒体发布**：实际发布需要各平台审核通过的应用权限。当前提供完整的 API 框架和 Mock 实现，生产环境需替换为真实 API 调用。
3. **办公工具**：Webhook 方式无需复杂 OAuth 流程，配置 Token 即可使用。建议使用飞书（功能最丰富，支持 30,000 字符 Markdown 消息）。
4. **安全**：生产环境务必配置 HTTPS，妥善保管 API Key 和 Webhook Token。