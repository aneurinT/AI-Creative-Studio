# 🎨 AI 创意工坊 (AI Creative Studio)

基于多 Agent 协作的 AI 图片/视频创意生成平台。支持文生图、文生视频、智能抠图、OCR 识别、图片合成等全链路创意工作流。

> **技术栈**: React 18 + TypeScript + Express + TailwindCSS + Vite 6 + pnpm  
> **Agent 架构**: 5 Agent 链式协作 + 编排器 + MCP 协议 + 长短记忆系统  
> **模型引擎**: 7 引擎（智谱/DeepSeek/万相/CogVideoX/Seedance/Agnes/LTX）

---

## 📋 目录

- [功能特性](#-功能特性)
- [技术架构](#-技术架构)
- [快速开始](#-快速开始)
- [项目结构](#-项目结构)
- [API 文档](#-api-文档)
- [Agent 系统](#-agent-系统)
- [MCP 工具注册](#-mcp-工具注册)
- [记忆系统](#-记忆系统)
- [部署方式](#-部署方式)
- [环境变量](#-环境变量)

---

## ✨ 功能特性

### 核心功能

| 功能 | 描述 | 状态 |
|------|------|:---:|
| 🤖 **AI 助手** | 多 Agent 协作对话，自动识别意图并分发任务 | ✅ |
| 🖼️ **文生图** | 支持 4 个模型引擎（Trae AI / 万相 / CogView-4 / 火山） | ✅ |
| 🎬 **文生视频** | 支持 CogVideoX / Seedance / Agnes / LTX，自动分镜脚本 | ✅ |
| ✂️ **智能抠图** | 一键移除图片背景，保留主体 | ✅ |
| 📝 **OCR 识别** | 大模型优先 + 本地 OCR 降级，支持文本/表格/JSON 输出 | ✅ |
| 🖼️➡️🖼️ **图片合成** | 提取主体并合成到新背景 | ✅ |
| 📚 **知识库** | RAG 检索增强（向量 + 关键词混合） | ✅ |

### Agent 特性

| 特性 | 描述 |
|------|------|
| 🧠 **意图识别** | Hermes Agent 自动分析用户需求 |
| 🔗 **上下文关联** | 自动关联历史对话，识别指代词和延续性指令 |
| 📊 **思考流程可视化** | 每个 Agent 的思考步骤默认展开展示 |
| 🗂️ **编排调度** | 并行判断 + 动态 Agent 调度 + 重试回退机制 |
| 🧩 **共享上下文** | 所有 Agent 共享 session 上下文，互相感知 |
| 💾 **长短记忆** | 短期记忆（会话级自动压缩）+ 长期记忆（向量检索跨会话） |
| 🔧 **MCP 协议** | 8 个标准化工具，支持 MCP tools/list 和 tools/call |
| ✅ **审核机制** | 三级审核（脚本 → 参数 → 最终结果） |

---

## 🏗 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    前端 (React 18 + Vite)                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │ AI助手   │ │ 一键生图  │ │ 视频生成  │ │ OCR识别    │ │
│  │(多Agent) │ │          │ │          │ │            │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │ 智能抠图  │ │ 图片合成  │ │ 知识库   │ │ 模型配置   │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘ │
└─────────────────────────────────────────────────────────┘
                            │ HTTP / SSE
┌─────────────────────────────────────────────────────────┐
│                 后端 (Express + TypeScript)               │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Agent 调度编排器 (Orchestrator)       │  │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐          │  │
│  │  │ Hermes  │→│  审核    │→│  执行    │          │  │
│  │  │(意图识别)│ │ Agent    │ │ Agent    │          │  │
│  │  └─────────┘ └──────────┘ └──────────┘          │  │
│  │       ↓              ↓              ↓             │  │
│  │  StoryWriter   VideoMaker   ImageCreator         │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────────┐  │
│  │ MCP 协议 │ │ 记忆系统  │ │ RAG 知识检索           │  │
│  │8 个工具  │ │ 短/长期  │ │ 向量+关键词混合         │  │
│  └──────────┘ └──────────┘ └───────────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────────┐  │
│  │ JSON DB  │ │ 日志系统  │ │ JWT 鉴权               │  │
│  │5 张表    │ │ 按日分文件 │ │ 白名单+路由守卫         │  │
│  └──────────┘ └──────────┘ └───────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│                    外部 AI 模型引擎                        │
│  智谱 GLM-4V │ DeepSeek │ 万相 │ CogVideoX │ Seedance  │
│         Agnes │ LTX │ CogView-4 │ ocr.space           │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18
- **pnpm** >= 8（推荐）或 npm
- **FFmpeg**（视频处理需要，会自动通过 `@ffmpeg-installer` 安装）

### 安装

```bash
# 克隆项目
git clone <your-repo-url>
cd aiProject

# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入你的 API Key
```

### 启动

```bash
# 方式一：使用启动脚本
# Windows
双击运行 启动项目.bat

# 方式二：手动启动
# 终端1 - 启动后端
pnpm run dev:server

# 终端2 - 启动前端
pnpm run dev
```

启动后访问：
- **前端页面**: http://localhost:5173
- **后端 API**: http://localhost:3001
- **默认账号**: admin / admin123

### 启动脚本

| 脚本 | 用途 |
|------|------|
| `pnpm dev` | 启动 Vite 前端开发服务器 |
| `pnpm dev:server` | 启动 Express 后端（tsx watch） |
| `pnpm build` | 构建生产版本 |
| `pnpm preview` | 预览生产构建 |

---

## 📁 项目结构

```
aiProject/
├── api/                          # 后端代码
│   ├── app.ts                    # Express 应用入口
│   ├── server.ts                 # 服务器启动
│   ├── routes/                   # API 路由（17 个文件）
│   │   ├── agents.ts             # Agent 路由（story/video/image + 编排）
│   │   ├── hermes.ts             # Hermes Agent（意图识别 + 审核 + 流式）
│   │   ├── ocr.ts                # OCR 识别路由
│   │   ├── generate.ts           # 图片生成路由
│   │   ├── video.ts              # 视频生成路由
│   │   ├── auth.ts               # 认证路由
│   │   └── ...
│   ├── services/                 # 核心服务
│   │   ├── toolRegistry.ts       # MCP 协议 + Tool Calling 注册中心
│   │   ├── orchestrator.ts       # Agent 调度编排器
│   │   ├── agentMemory.ts        # 长短记忆系统
│   │   ├── database.ts           # JSON 文件数据库
│   │   ├── llmConfig.ts          # LLM 模型配置
│   │   ├── imageService.ts       # 图片/视频模型服务
│   │   ├── embeddingService.ts   # 向量嵌入服务
│   │   ├── vectorStore.ts        # 向量存储
│   │   ├── ragKnowledge.ts       # RAG 知识检索
│   │   ├── ocrService.ts         # OCR 识别服务
│   │   ├── reviewAgent.ts        # 内容审核 Agent
│   │   └── videoReviewAgent.ts   # 视频审核 Agent
│   ├── middleware/
│   │   └── auth.ts               # JWT 鉴权中间件
│   └── data/                     # 数据存储（运行时生成）
│       ├── chat_sessions.json
│       ├── agent_long_memory.json
│       └── logs/                 # 操作日志
├── src/                          # 前端代码
│   ├── App.tsx                   # 路由配置
│   ├── main.tsx                  # 入口
│   ├── components/
│   │   ├── AIAssistant.tsx       # AI 助手主组件（3000+ 行）
│   │   └── Navbar.tsx            # 导航栏
│   ├── pages/                    # 页面组件
│   │   ├── AssistantPage.tsx     # AI 助手页
│   │   ├── Home.tsx              # 一键生图
│   │   ├── VideoGenerator.tsx    # 视频生成
│   │   ├── RemoveBg.tsx          # 智能抠图
│   │   ├── OcrPage.tsx           # OCR 识别
│   │   ├── ImageComposer.tsx     # 图片合成
│   │   ├── Settings.tsx          # 模型配置
│   │   └── Login.tsx             # 登录
│   └── hooks/
│       └── useSSE.ts             # SSE 流式 Hook
├── ltx-video-server/             # Python LTX 视频微服务
├── docker-compose.yml            # Docker 编排
├── Dockerfile.backend            # 后端 Docker 镜像
├── nginx.conf                    # Nginx 配置
├── package.json
└── README.md
```

---

## 📡 API 文档

### 基础服务

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| GET | `/api/health` | 健康检查 | ❌ |
| POST | `/api/auth/login` | 用户登录 | ❌ |
| POST | `/api/auth/register` | 用户注册 | ❌ |

### AI 助手

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| POST | `/api/hermes/chat` | 对话接口 | ❌ |
| GET | `/api/hermes/chat/stream` | SSE 流式对话 | ❌ |
| POST | `/api/hermes/chat-with-image` | 图片对话 | ❌ |
| POST | `/api/hermes/review` | 内容审核 | ❌ |
| POST | `/api/hermes/video-review` | 视频审核 | ❌ |
| POST | `/api/hermes/failure-analysis` | 失败分析 | ❌ |

### Agent 编排

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| POST | `/api/agents/orchestrate` | 并行判断 + 生成执行计划 | ❌ |
| POST | `/api/agents/execute-plan` | 执行调度计划 | ❌ |
| POST | `/api/agents/story/write` | 故事创作 | ❌ |
| POST | `/api/agents/video/analyze` | 视频参数分析 | ❌ |
| POST | `/api/agents/image/analyze` | 图像参数分析 | ❌ |
| POST | `/api/agents/video/generate` | 视频生成 | ❌ |

### 图片/视频生成

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| POST | `/api/generate` | 图片生成 | ✅ |
| GET | `/api/generate/models` | 模型列表 | ❌ |
| GET | `/api/video/pending` | 视频任务列表 | ❌ |
| POST | `/api/video/generate` | 视频生成 | ✅ |
| GET | `/api/video/status/:taskId` | 视频任务状态 | ✅ |

### OCR 识别

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| POST | `/api/ocr/recognize` | 单张识别 | ❌ |
| POST | `/api/ocr/recognize-batch` | 批量识别 | ❌ |

### MCP 协议

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| GET | `/api/mcp/tools` | 工具列表（MCP 格式） | ❌ |
| POST | `/api/mcp/tools/call` | 调用工具 | ❌ |
| GET | `/api/tools/functions` | LLM Function Calling 格式 | ❌ |
| GET | `/api/tools` | 简单工具列表 | ❌ |

---

## 🤖 Agent 系统

### Agent 架构

```
用户输入
  │
  ├─ 1. Hermes Agent（意图识别）
  │      ├─ 推理模型优先（DeepSeek-R1 / GLM-Z1）
  │      ├─ 指令模型降级（GLM-4-Flash）
  │      └─ 本地 fallback 兜底
  │
  ├─ 2. 审核 Agent（质量检查）
  │      ├─ 脚本审核（video-review）
  │      ├─ 参数审核（review）
  │      └─ 结果审核（final）
  │
  ├─ 3. 编排器（Orchestrator）
  │      ├─ 并行判断（sequential / parallel / hybrid）
  │      ├─ 动态调度（按依赖关系）
  │      └─ 重试回退（指数退避 1s→2s→4s）
  │
  └─ 4. 执行 Agent
         ├─ StoryWriter（故事创作 → 视频脚本）
         ├─ VideoMaker（参数提取 → 分镜生成）
         └─ ImageCreator（图像参数 → prompt 优化）
```

### 每个 Agent 的上下文构建

```
System Prompt（角色 + 可用工具列表）
  ├─ 长期记忆（向量召回 top-3 相关经验）
  ├─ 短期记忆（会话内最近 10 轮对话）
  ├─ 其他 Agent 上下文（共享上下文快照）
  ├─ 任务历史（上一个任务的参数和结果）
  └─ RAG 知识（向量 + 关键词混合检索）
```

---

## 🔧 MCP 工具注册

项目实现了 MCP (Model Context Protocol) 协议兼容层，注册了 8 个标准化工具：

| 工具名 | 类别 | 描述 |
|--------|------|------|
| `generate_image` | 图片 | 根据文本描述生成图片，支持多种风格 |
| `generate_video` | 视频 | 根据文本描述生成视频，可指定时长 |
| `remove_background` | 图片 | 移除图片背景，保留主体 |
| `ocr_recognize` | OCR | 识别图片文字，支持文本/表格/JSON |
| `modify_image` | 编辑 | 修改已生成的图片 |
| `search_knowledge` | 知识 | 向量 + 关键词混合检索 |
| `remember_context` | 系统 | 长期记忆存储 |
| `recall_memory` | 系统 | 长期记忆召回 |

### 新增工具

```typescript
import { toolRegistry } from './services/toolRegistry.js';

toolRegistry.register({
  name: 'my_tool',
  description: '我的自定义工具',
  category: 'image',
  parameters: [
    { name: 'prompt', type: 'string', description: '输入参数', required: true },
  ],
  handler: async (params, ctx) => {
    return { success: true, data: {}, summary: '执行完成' };
  },
});
```

---

## 💾 记忆系统

### 短期记忆（会话级）

- 每个 Agent 独立记录对话轮次
- 超过 **15 轮**自动触发 LLM 摘要压缩
- 保留最近 **5 轮**完整对话 + 摘要
- 会话结束自动清理

### 长期记忆（跨会话）

- 向量嵌入 + 余弦相似度检索
- 重要性评分（0-1）+ 访问频率加权
- 自动去重（内容比对）
- 低分记忆自动衰减清理

### 数据库表

| 表名 | 文件 | 用途 |
|------|------|------|
| `chat_sessions` | `data/chat_sessions.json` | 聊天会话 |
| `chat_messages` | `data/chat_messages.json` | 聊天消息 |
| `agent_short_memory` | `data/agent_short_memory.json` | 短期记忆 |
| `agent_long_memory` | `data/agent_long_memory.json` | 长期记忆 |
| `video_tasks` | `data/video_tasks.json` | 视频任务 |

---

## 🐳 部署方式

### Docker Compose

```bash
docker-compose up -d
```

服务包含：
- **Nginx** — 前端静态文件 + API 反向代理
- **Backend** — Express 后端
- **Redis** — 缓存 + 会话存储
- **LTX Server** — Python 视频微服务（可选，需 GPU）

### Electron 桌面端

```bash
pnpm build:electron
```

构建 Windows x64 便携版，输出目录 `release-new/`。

### Vercel Serverless

```bash
pnpm deploy:vercel
```

---

## 🔐 环境变量

```bash
# 必需
ZHIPU_API_KEY=your_zhipu_api_key          # 智谱 AI API Key（主模型）

# 可选
DEEPSEEK_API_KEY=your_deepseek_api_key    # DeepSeek API Key（推理模型）
JWT_SECRET=your_jwt_secret                # JWT 密钥（默认有开发值）
CORS_ORIGIN=http://localhost:5173         # CORS 允许的源
SKIP_AUTH=true                            # 开发环境跳过鉴权
NODE_ENV=development                      # 运行环境
OCR_SPACE_API_KEY=your_ocr_key            # ocr.space API Key（OCR 降级用）
```

---

## 📊 技术指标

| 指标 | 数据 |
|------|------|
| **前端路由** | 9 个 |
| **API 端点** | 30+ 个 |
| **Agent 数量** | 5 个 + 1 编排器 |
| **AI 模型引擎** | 7 个 |
| **MCP 工具** | 8 个 |
| **数据库表** | 5 张 |
| **页面文件** | 9 个 |
| **路由文件** | 17 个 |
| **编译错误** | 0 |
| **TypeScript** | 严格模式 |

---

## 📝 更新日志

### v2.0 (2026-08)

- ✨ 新增 Agent 调度编排器（并行判断 + 动态调度 + 重试回退）
- ✨ 新增 MCP 协议兼容层（8 个标准化工具）
- ✨ 新增 Agent 长短记忆系统（向量检索 + 自动压缩）
- ✨ 新增 SSE 流式对话
- ✨ 新增 OCR 大模型 + 本地降级双通道
- ✨ 新增思考流程可视化（默认展开）
- ✨ 新增 JSON 文件数据库（5 张表）
- ✨ 新增操作日志系统（按日分文件）
- 🔧 优化 Agent 上下文关联（指代词 + 延续性指令）
- 🔧 优化 AI 回复自然度

### v1.0 (2026-07)

- 🎉 初始版本发布
- 文生图（4 引擎）、文生视频（4 引擎）
- 智能抠图、图片合成、知识库
- 多 Agent 协作（Hermes + Story + Video + Image + Review）
- Docker + Electron + Vercel 部署
