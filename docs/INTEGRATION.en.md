# AI Creative Studio - Integration Guide

> Version: v2.0 | Updated: 2026-08-11

---

## Table of Contents

1. [A2A Protocol Integration](#1-a2a-protocol-integration)
2. [Social Media Publishing](#2-social-media-publishing)
3. [Office Tools Integration](#3-office-tools-integration)
4. [API Reference](#4-api-reference)
5. [Environment Variables](#5-environment-variables)

---

## 1. A2A Protocol Integration

### 1.1 Overview

AI Creative Studio now implements the [Google A2A (Agent-to-Agent) v1.0](https://a2a-mcp.org/) protocol. Through A2A, your agents can:

- Publish an **Agent Card** to let other agents discover and invoke your creative generation capabilities
- Receive creative task requests from external agents via the **Task API**
- Act as an **A2A ecosystem node**, interoperating with agents from LangGraph, CrewAI, Google ADK, and other frameworks

### 1.2 Agent Card

Every A2A-compliant agent publishes an Agent Card describing its identity and capabilities.

**Get Agent Card**:

```bash
# Standard A2A discovery endpoint
curl http://localhost:3001/.well-known/agent-card.json

# Alias endpoint
curl http://localhost:3001/api/a2a/agent-card
```

**Agent Card Structure**:

```json
{
  "name": "AI Creative Studio",
  "description": "Multi-agent AI image/video creative generation platform",
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
      "description": "Generate images from text descriptions with multiple styles",
      "tags": ["image", "ai-creative-studio", "mcp"],
      "examples": ["Generate a cyberpunk cityscape at night"]
    }
  ],
  "protocolVersion": "1.0"
}
```

### 1.3 Task API

#### Create Task

```bash
curl -X POST http://localhost:3001/api/a2a/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "messageId": "msg-001",
      "role": "user",
      "parts": [
        {"type": "text", "text": "Generate a sunset beach photo"}
      ]
    },
    "sessionId": "session-123",
    "acceptedOutputModes": ["image/png"]
  }'
```

#### Query Task Status

```bash
curl http://localhost:3001/api/a2a/tasks/{taskId}
```

#### Cancel Task

```bash
curl -X DELETE http://localhost:3001/api/a2a/tasks/{taskId}
```

#### List All Tasks

```bash
# List all tasks
curl http://localhost:3001/api/a2a/tasks

# Filter by state
curl "http://localhost:3001/api/a2a/tasks?state=completed"

# Filter by session
curl "http://localhost:3001/api/a2a/tasks?sessionId=session-123"
```

### 1.4 Task State Transitions

```
submitted → working → completed
                   → failed
                   → input-required → working
submitted → canceled
```

### 1.5 Integrating with External Agent Frameworks

#### LangGraph Integration

```python
# Call AI Creative Studio's A2A endpoint from LangGraph
import requests

agent_card = requests.get("http://localhost:3001/.well-known/agent-card.json").json()
print(f"Discovered Agent: {agent_card['name']}")

# Create a creative task
task = requests.post("http://localhost:3001/api/a2a/tasks", json={
    "message": {
        "messageId": "lg-001",
        "role": "user",
        "parts": [{"type": "text", "text": "Generate a product promo video script"}]
    }
}).json()
```

#### CrewAI Integration

```python
# Register AI Creative Studio as an external tool in CrewAI
from crewai import Agent, Task

creative_agent = Agent(
    role="Creative Generator",
    goal="Generate visual content via A2A protocol from AI Creative Studio",
    backstory="I bridge CrewAI agents with AI Creative Studio",
    tools=[],
)
```

---

## 2. Social Media Publishing

### 2.1 Overview

AI Creative Studio now integrates with **Douyin, Kuaishou, and Xiaohongshu** for content publishing. Combined with AI creative generation, this enables the complete workflow: "AI Generate Content → One-Click Publish to All Platforms".

### 2.2 Supported Platforms

| Platform | Icon | Max Video | Title Length | Max Tags |
|----------|:----:|:---------:|:------------:|:--------:|
| Douyin | 🎵 | 15 min | 55 chars | 10 |
| Kuaishou | 📷 | 10 min | 50 chars | 8 |
| Xiaohongshu | 📕 | 5 min | 20 chars | 10 |

### 2.3 Authorization Flow

```bash
# 1. Get authorization URL
curl "http://localhost:3001/api/social/auth/douyin?redirectUri=https://your-app.com/callback&state=random123"

# 2. Handle OAuth callback after user authorization
curl -X POST http://localhost:3001/api/social/auth/douyin/callback \
  -H "Content-Type: application/json" \
  -d '{"code": "auth_code_from_platform", "openId": "user_open_id"}'

# 3. Check authorization status
curl "http://localhost:3001/api/social/auth/douyin/status?userId=user_open_id"
```

### 2.4 Content Publishing

#### Publish to Single Platform

```bash
curl -X POST http://localhost:3001/api/social/publish/douyin \
  -H "Content-Type: application/json" \
  -d '{
    "content": {
      "title": "AI Generated Cyberpunk Night 🏙️",
      "content": "Generated with AI Creative Studio! #AIGenerated #Cyberpunk",
      "tags": ["AIGenerated", "Cyberpunk", "NightCity"],
      "media": [
        {"type": "image", "url": "http://localhost:3001/images/generated_001.png"}
      ],
      "allowComment": true,
      "visibility": "public"
    }
  }'
```

#### One-Click Multi-Platform Publishing

```bash
curl -X POST http://localhost:3001/api/social/publish \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["douyin", "kuaishou", "xiaohongshu"],
    "content": {
      "title": "AI Video: Spring Cherry Blossoms",
      "content": "Beautiful AI-generated cherry blossom video! 🌸",
      "tags": ["AIVideo", "CherryBlossom", "Spring"],
      "media": [
        {"type": "video", "url": "http://localhost:3001/videos/sakura.mp4", "duration": 15}
      ]
    }
  }'
```

### 2.5 AI Generate + One-Click Publish Workflow

```bash
# Complete workflow:
# 1. AI generates video
# 2. Auto-publish to Douyin + Kuaishou + Xiaohongshu

# Step 1: Generate video via AI assistant
curl -X POST http://localhost:3001/api/hermes/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "workflow-001",
    "message": "Generate a 15-second cherry blossom falling video"
  }'

# Step 2: One-click publish after generation
curl -X POST http://localhost:3001/api/social/publish \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["douyin", "kuaishou", "xiaohongshu"],
    "content": {
      "title": "🌸 AI Cherry Blossoms",
      "content": "AI-generated cherry blossom video, dreamy beauty!",
      "tags": ["AIVideo", "CherryBlossom", "Spring"],
      "media": [{"type": "video", "url": "generated_video_url", "duration": 15}]
    }
  }'
```

---

## 3. Office Tools Integration

### 3.1 Overview

AI Creative Studio now integrates with **DingTalk, Feishu (Lark), and WeCom** for office collaboration. Features include:

- Task completion notifications (auto-notify when AI generates images/videos)
- Custom message sending
- Multi-platform batch sending
- Markdown formatted messages

### 3.2 Supported Platforms

| Platform | Icon | Max Text | Supported Message Types |
|----------|:----:|:--------:|:------------------------|
| DingTalk | 📌 | 20,000 | text, markdown, link, actionCard |
| Feishu (Lark) | 🕊️ | 30,000 | text, markdown, image, news, file, template_card |
| WeCom | 💼 | 2,048 | text, markdown, image, news, file |

### 3.3 Webhook Configuration

#### DingTalk

1. Open DingTalk group → Settings → Smart Group Assistant → Add Bot → Custom
2. Copy the `access_token` from the Webhook URL
3. Set env: `DINGTALK_WEBHOOK_TOKEN=your_token`

#### Feishu (Lark)

1. Open Feishu group → Settings → Group Bot → Add Bot → Custom Bot
2. Copy the Webhook URL
3. Set env: `FEISHU_WEBHOOK_TOKEN=your_token`

#### WeCom

1. Open WeCom group → Group Bot → Add Bot
2. Copy the `key` from the Webhook URL
3. Set env: `WECOM_WEBHOOK_TOKEN=your_key`

### 3.4 Sending Messages

#### Send Text Message

```bash
curl -X POST http://localhost:3001/api/office/send/dingtalk \
  -H "Content-Type: application/json" \
  -d '{
    "target": {"type": "webhook"},
    "message": {
      "msgType": "text",
      "content": {"text": "🎨 New creative task completed!"}
    }
  }'
```

#### Send Markdown Message

```bash
curl -X POST http://localhost:3001/api/office/send/feishu \
  -H "Content-Type: application/json" \
  -d '{
    "target": {"type": "webhook"},
    "message": {
      "msgType": "markdown",
      "content": {
        "title": "🎨 AI Creative Studio - Task Complete",
        "text": "### 🎉 Video Generation Complete\n\n**Task**: Product Promo\n**Duration**: 30s\n**Status**: ✅ Done\n\n> Generated by AI Creative Studio multi-agent pipeline"
      }
    }
  }'
```

#### Batch Send to Multiple Platforms

```bash
curl -X POST http://localhost:3001/api/office/send \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["dingtalk", "feishu", "wecom"],
    "target": {"type": "webhook"},
    "message": {
      "msgType": "text",
      "content": {"text": "📢 Announcement: System upgrade complete"}
    }
  }'
```

### 3.5 AI Task Completion Auto-Notification

Auto-notify office platforms when AI Creative Studio completes image/video generation:

```bash
curl -X POST http://localhost:3001/api/office/notify/task-complete \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["dingtalk", "feishu"],
    "taskInfo": {
      "taskType": "video",
      "taskId": "task-001",
      "title": "Cherry Blossom Video",
      "resultUrl": "http://localhost:3001/videos/sakura.mp4",
      "duration": "45s"
    }
  }'
```

---

## 4. API Reference

### 4.1 A2A API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/.well-known/agent-card.json` | Agent discovery |
| GET | `/api/a2a/agent-card` | Agent Card |
| POST | `/api/a2a/tasks` | Create task |
| GET | `/api/a2a/tasks` | List tasks |
| GET | `/api/a2a/tasks/:id` | Get task |
| DELETE | `/api/a2a/tasks/:id` | Cancel task |
| POST | `/api/a2a/tasks/:id/messages` | Append message |
| GET | `/api/a2a/tasks/:id/artifacts` | Get artifacts |
| GET | `/api/a2a/stats` | Service stats |
| GET | `/api/a2a/health` | Health check |

### 4.2 Social Media API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/social/config` | Platform configs |
| GET | `/api/social/auth/:platform` | Auth URL |
| POST | `/api/social/auth/:platform/callback` | Auth callback |
| GET | `/api/social/auth/:platform/status` | Auth status |
| POST | `/api/social/publish/:platform` | Publish single |
| POST | `/api/social/publish` | Multi-publish |
| GET | `/api/social/history` | Publish history |
| GET | `/api/social/health` | Health check |

### 4.3 Office Tools API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/office/config` | Platform configs |
| POST | `/api/office/send/:platform` | Send single |
| POST | `/api/office/send` | Batch send |
| POST | `/api/office/notify/task-complete` | Task notification |
| POST | `/api/office/preview` | Message preview |
| GET | `/api/office/history` | Send history |
| GET | `/api/office/health` | Health check |

---

## 5. Environment Variables

```bash
# ========================
# Social Media Integration
# ========================
DOUYIN_CLIENT_KEY=your_key          # Douyin Open Platform Client Key
DOUYIN_CLIENT_SECRET=your_secret    # Douyin Open Platform Client Secret
KUAISHOU_CLIENT_KEY=your_key        # Kuaishou Open Platform Client Key
KUAISHOU_CLIENT_SECRET=your_secret  # Kuaishou Open Platform Client Secret
XIAOHONGSHU_CLIENT_KEY=your_key     # Xiaohongshu Open Platform Client Key
XIAOHONGSHU_CLIENT_SECRET=your_secret # Xiaohongshu Open Platform Client Secret

# ========================
# Office Tools Integration
# ========================
DINGTALK_WEBHOOK_TOKEN=your_token   # DingTalk Bot Webhook Token
FEISHU_WEBHOOK_TOKEN=your_token     # Feishu Bot Webhook Token
WECOM_WEBHOOK_TOKEN=your_key        # WeCom Bot Webhook Key
```

---

## 6. Notes

1. **A2A Protocol**: Current v1.0 implementation, fully compatible with Google A2A spec. Agent Card auto-generates skill list from the MCP tool registry.
2. **Social Media Publishing**: Actual publishing requires platform-approved app permissions. The current implementation provides a complete API framework with mock implementations; replace with real API calls for production.
3. **Office Tools**: Webhook method requires no complex OAuth flow — just configure the token. Feishu is recommended (richest features, supports 30,000 char Markdown messages).
4. **Security**: Always configure HTTPS in production and keep API keys and webhook tokens secure.