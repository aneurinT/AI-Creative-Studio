# 🎨 AI 创意工坊 (AI Creative Studio)

基于多 Agent 协作的 AI 图片/视频创意生成平台。支持文生图、文生视频、智能抠图、OCR 识别、图片合成等全链路创意工作流，同时提供多人协同、配额管理、高并发保护等企业级能力。

> **技术栈**: React 18 + TypeScript + Express + TailwindCSS + Vite 6 + pnpm  
> **Agent 架构**: 5 Agent 链式协作 + 编排器 + MCP 协议 + 长短记忆系统  
> **模型引擎**: 8 引擎（智谱/DeepSeek/万相/火山方舟/Seedance/Agnes/LTX/Trae AI）

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
- [智能模型路由](#-智能模型路由)
- [多人协同](#-多人协同)
- [高并发保护](#-高并发保护)
- [部署方式](#-部署方式)
- [环境变量](#-环境变量)

---

## ✨ 功能特性

### 核心功能

| 功能 | 描述 | 状态 |
|------|------|:---:|
| 🤖 **AI 助手** | 多 Agent 协作对话，自动识别意图并分发任务，SSE 流式输出 | ✅ |
| 🖼️ **文生图** | 支持 4 个模型引擎（Trae AI / 万相 / CogView-4 / 火山方舟） | ✅ |
| 🎬 **文生视频** | 支持 Agnes / CogVideoX / Seedance / 万相 / LTX，自动分镜脚本 | ✅ |
| ✂️ **智能抠图** | 一键移除图片背景，保留主体 | ✅ |
| 📝 **OCR 识别** | 大模型优先 + 本地 OCR 降级，支持文本/表格/JSON 输出 | ✅ |
| 🖼️➡️🖼️ **图片合成** | 提取主体并合成到新背景 | ✅ |
| 🔄 **图片修改** | 修改已生成图片的背景/人物/风格 | ✅ |
| 📝 **图片描述** | 为图片生成文字描述（Image Caption） | ✅ |
| 📚 **知识库** | RAG 检索增强（向量 + 关键词混合），12 个端点 | ✅ |
| 👥 **多人协同** | 协作房间、消息广播、操作互斥锁、在线状态追踪 | ✅ |

### Agent 特性

| 特性 | 描述 |
|------|------|
| 🧠 **意图识别** | Hermes Agent 自动分析用户需求，推理模型优先 |
| 🔗 **上下文关联** | 自动关联历史对话，识别指代词和延续性指令 |
| 📊 **思考流程可视化** | 每个 Agent 的思考步骤默认展开展示 |
| 🗂️ **编排调度** | 并行判断（sequential/parallel/hybrid）+ 动态 Agent 调度 + 重试回退 |
| 🧩 **共享上下文** | 所有 Agent 共享 session 上下文，互相感知 |
| 💾 **长短记忆** | 短期记忆（会话级自动压缩）+ 长期记忆（向量检索跨会话） |
| 🔧 **MCP 协议** | 8 个标准化工具，支持 MCP `tools/list` 和 `tools/call` |
| ✅ **审核机制** | 三级审核（脚本 → 参数 → 最终结果）+ 自学习记忆 |
| 🧭 **智能模型路由** | 4 级路由（local/small/large/vision），6 维度自动决策 |

### 企业级特性

| 特性 | 描述 |
|------|------|
| 🛡️ **高并发保护** | 滑动窗口限流 + LLM 调用队列 + 熔断器 + 请求超时 |
| 📊 **配额管理** | 按模型每日/总限额，支持查询、重置、开关 |
| 🎬 **视频拆分** | 长视频自动拆分为多段，并行生成后拼接 |
| 🔗 **视频拼接** | 手动选择多个视频进行拼接 |
| 🔄 **视频修改** | 基于原始描述和修改指令重新生成视频 |
| 🆓 **免费视频降级链** | Agnes 不可用时自动降级到智谱 → Seedance（免费优先） |
| 💾 **持久化任务进度** | 视频任务进度持久化到磁盘，服务器重启后可恢复 |
| 🎞️ **分镜脚本检测** | 三层判断（正则快速检测 → AI 语义判断 → 结构化解析） |

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
│  │ 模型路由  │ │ 协同服务  │ │ 高并发保护             │  │
│  │4 级路由  │ │ 房间/锁  │ │ 限流/熔断/超时         │  │
│  └──────────┘ └──────────┘ └───────────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────────┐  │
│  │ JSON DB  │ │ 日志系统  │ │ JWT 鉴权               │  │
│  │8+ 张表   │ │ 按日分文件 │ │ 白名单+路由守卫         │  │
│  └──────────┘ └──────────┘ └───────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                            │
┌─────────────────────────────────────────────────────────┐
│                    外部 AI 模型引擎                        │
│  智谱 GLM-4V │ DeepSeek V4 │ 万相 │ 火山方舟 │ Seedance │
│      Agnes │ LTX │ CogView-4 │ Trae AI │ ocr.space    │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18
- **pnpm** >= 8（推荐）
- **FFmpeg**（视频处理需要，会自动通过 `@ffmpeg-installer` 安装）
- **Python 3.10+**（仅 LTX 本地视频推理需要）

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

# 方式二：同时启动前后端（推荐）
pnpm dev

# 方式三：分别启动
# 终端1 - 启动后端
pnpm server:dev

# 终端2 - 启动前端
pnpm client:dev
```

启动后访问：
- **前端页面**: http://localhost:5173
- **后端 API**: http://localhost:3001
- **默认账号**: admin / admin123

### 启动脚本

| 脚本 | 用途 |
|------|------|
| `pnpm dev` | 同时启动前端 + 后端（concurrently） |
| `pnpm client:dev` | 启动 Vite 前端开发服务器 |
| `pnpm server:dev` | 启动 Express 后端（nodemon） |
| `pnpm build` | 构建生产版本 |
| `pnpm preview` | 预览生产构建 |
| `pnpm electron:dev` | 启动 Electron 桌面端开发模式 |
| `pnpm electron:build` | 构建 Electron 桌面端安装包 |
| `pnpm dist` | 构建前端 + 打包后端发布包 |
| `pnpm check` | TypeScript 类型检查 |
| `pnpm lint` | ESLint 代码检查 |

---

## 📁 项目结构

```
aiProject/
├── api/                          # 后端代码
│   ├── app.ts                    # Express 应用入口
│   ├── server.ts                 # 服务器启动
│   ├── index.ts                  # 导出入口
│   ├── routes/                   # API 路由（17 个文件）
│   │   ├── agents.ts             # Agent 调度路由（story/video/image + 编排）
│   │   ├── hermes.ts             # Hermes Agent（意图识别 + 审核 + 流式对话）
│   │   ├── generate.ts           # 图片生成路由
│   │   ├── video.ts              # 视频生成路由
│   │   ├── ocr.ts                # OCR 识别路由
│   │   ├── auth.ts               # 认证路由（登录/注册/登出/用户信息）
│   │   ├── chat.ts               # 聊天会话管理
│   │   ├── collaboration.ts      # 多人协同（房间/锁/广播）
│   │   ├── config.ts             # 模型配置读写
│   │   ├── history.ts            # 图片生成历史
│   │   ├── knowledge.ts          # 知识库 CRUD + 搜索（12 个端点）
│   │   ├── ltx.ts                # LTX 本地视频推理代理
│   │   ├── mock.ts               # Mock 数据生成
│   │   ├── quota.ts              # 配额管理
│   │   ├── removeBg.ts           # 智能抠图
│   │   ├── storyboard.ts         # 分镜脚本检测与审核
│   │   ├── test.ts               # 模型测试
│   │   └── upload.ts             # 文件上传（图片/视频/图生视频）
│   ├── services/                 # 核心服务（26 个文件）
│   │   ├── toolRegistry.ts       # MCP 协议 + Tool Calling 注册中心
│   │   ├── orchestrator.ts       # Agent 调度编排器
│   │   ├── agentMemory.ts        # 长短记忆系统
│   │   ├── llmConfig.ts          # LLM 模型统一配置
│   │   ├── modelRouter.ts        # 智能模型路由器（4 级路由）
│   │   ├── imageService.ts       # 图片/视频模型服务
│   │   ├── embeddingService.ts   # 向量嵌入服务（智谱 Embedding-2）
│   │   ├── vectorStore.ts        # 向量存储（CRUD + 余弦相似度）
│   │   ├── ragKnowledge.ts       # RAG 知识检索（10 类 prompt 模板）
│   │   ├── ocrService.ts         # OCR 识别服务
│   │   ├── reviewAgent.ts        # 内容审核 Agent + 自学习记忆
│   │   ├── videoReviewAgent.ts   # 视频三级审核
│   │   ├── database.ts           # JSON 文件数据库（WAL 写入）
│   │   ├── sseService.ts         # SSE 流式输出服务
│   │   ├── chatSessionService.ts # 聊天会话管理
│   │   ├── collaborationService.ts # 多人协同服务
│   │   ├── concurrencyService.ts # 高并发保护（限流/熔断/超时）
│   │   ├── quotaService.ts       # 配额管理
│   │   ├── videoTaskService.ts   # 视频任务队列管理
│   │   ├── videoSplitService.ts  # 长视频拆分生成 + 拼接
│   │   ├── videoHistoryService.ts # 视频生成历史
│   │   ├── videoTaskProgressService.ts # 持久化任务进度
│   │   ├── storyboardDetectorService.ts # 分镜脚本检测
│   │   ├── freeVideoService.ts   # 免费视频降级链
│   │   ├── ltxVideoService.ts    # LTX 本地视频推理客户端
│   │   ├── fetchUtils.ts         # HTTP 请求工具
│   │   ├── loggerService.ts      # 结构化日志服务
│   │   └── historyService.ts     # 图片历史服务
│   ├── middleware/
│   │   └── auth.ts               # JWT 鉴权中间件
│   └── data/                     # 数据存储（运行时生成）
│       ├── chat_sessions.json
│       ├── agent_long_memory.json
│       ├── history.json
│       ├── videoHistory.json
│       ├── quotas.json
│       ├── task_progress.json
│       └── logs/                 # 操作日志（按日分文件）
├── src/                          # 前端代码
│   ├── App.tsx                   # 路由配置（9 个路由）
│   ├── main.tsx                  # 入口
│   ├── components/               # 公共组件
│   │   ├── AIAssistant.tsx       # AI 助手主组件（3000+ 行）
│   │   ├── Navbar.tsx            # 导航栏
│   │   ├── ChatHistory.tsx       # 聊天历史侧边栏
│   │   ├── Hero.tsx              # 首页 Hero 区域
│   │   ├── Empty.tsx             # 空状态占位
│   │   ├── ImageUploader.tsx     # 图片上传（拖拽 + 图生视频）
│   │   └── ModelSelector.tsx     # 模型选择器
│   ├── pages/                    # 页面组件（9 个）
│   │   ├── AssistantPage.tsx     # AI 助手页（多 Agent 协作主入口）
│   │   ├── Home.tsx              # 一键生图
│   │   ├── NewHome.tsx           # 新版首页（开发中）
│   │   ├── VideoGenerator.tsx    # 视频生成
│   │   ├── RemoveBg.tsx          # 智能抠图
│   │   ├── OcrPage.tsx           # OCR 识别
│   │   ├── ImageComposer.tsx     # 图片合成
│   │   ├── Settings.tsx          # 模型配置
│   │   └── Login.tsx             # 登录
│   ├── hooks/
│   │   ├── useSSE.ts             # SSE 流式 Hook
│   │   └── useTheme.ts           # 主题 Hook
│   ├── contexts/
│   │   └── AuthContext.tsx        # 认证上下文
│   ├── store/
│   │   └── imageStore.ts         # 图片状态管理 (Zustand)
│   └── lib/
│       └── utils.ts              # 工具函数
├── electron/                     # Electron 桌面端
│   ├── main.ts                   # 主进程
│   ├── preload.ts                # 预加载脚本
│   └── tsconfig.json
├── ltx-video-server/             # Python LTX 视频微服务
│   ├── server.py                 # FastAPI 服务
│   ├── requirements.txt
│   └── Dockerfile.ltx
├── server-deploy/                # 简化部署方案
├── docker-compose.yml            # Docker 编排
├── Dockerfile.backend            # 后端 Docker 镜像
├── Dockerfile.frontend           # 前端 Docker 镜像
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
| POST | `/api/auth/logout` | 用户登出 | ❌ |
| GET | `/api/auth/me` | 获取当前用户信息 | ✅ |

### AI 助手

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| GET | `/api/hermes/health` | Hermes 健康检查 | ❌ |
| POST | `/api/hermes/chat` | 对话接口 | ❌ |
| POST | `/api/hermes/chat/stream` | SSE 流式对话 | ❌ |
| POST | `/api/hermes/chat-with-image` | 图片对话 | ❌ |
| POST | `/api/hermes/review` | 内容审核 | ❌ |
| POST | `/api/hermes/video-review` | 视频审核 | ❌ |
| POST | `/api/hermes/failure-analysis` | 失败分析 | ❌ |
| POST | `/api/hermes/learn` | 自学习（记录用户修正） | ❌ |

### Agent 编排

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| GET | `/api/agents/health` | Agent 系统健康检查 | ❌ |
| POST | `/api/agents/orchestrate` | 并行判断 + 生成执行计划 | ❌ |
| POST | `/api/agents/execute-plan` | 执行调度计划 | ❌ |
| GET | `/api/agents/context/:sessionId` | 获取 Agent 上下文 | ❌ |
| GET | `/api/agents/context/:sessionId/thoughts` | 获取 Agent 思考过程 | ❌ |
| POST | `/api/agents/story/write` | 故事创作 | ❌ |
| POST | `/api/agents/video/analyze` | 视频参数分析 | ❌ |
| POST | `/api/agents/image/analyze` | 图像参数分析 | ❌ |
| POST | `/api/agents/video/generate` | 视频生成 | ❌ |

### 图片生成

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| POST | `/api/generate` | 图片生成 | ✅ |
| GET | `/api/generate/models` | 模型列表 | ❌ |
| POST | `/api/generate/modify` | 图片修改 | ✅ |
| POST | `/api/generate/caption` | 图片描述生成 | ✅ |

### 视频生成

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| GET | `/api/video/health-check` | 视频服务健康检查 | ❌ |
| GET | `/api/video/pending` | 视频任务列表 | ❌ |
| POST | `/api/video/generate` | 视频生成 | ✅ |
| GET | `/api/video/status/:taskId` | 视频任务状态 | ✅ |
| DELETE | `/api/video/pending` | 删除视频任务 | ✅ |
| PUT | `/api/video/pending/:taskId/stats` | 更新任务统计 | ✅ |
| POST | `/api/video/pending/clean` | 清理已完成任务 | ✅ |
| POST | `/api/video/cancel/:taskId` | 取消视频任务 | ✅ |
| POST | `/api/video/modify` | 视频修改 | ✅ |
| POST | `/api/video/merge` | 视频拼接 | ✅ |
| POST | `/api/video/free` | 免费视频生成 | ✅ |
| GET | `/api/video/free/status/:taskId` | 免费视频状态 | ✅ |
| POST | `/api/video/storyboard` | 分镜脚本处理 | ✅ |
| GET | `/api/video/history` | 视频生成历史 | ✅ |
| DELETE | `/api/video/history` | 删除视频历史 | ✅ |

### 聊天会话

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| POST | `/api/chat/sessions` | 创建会话 | ❌ |
| GET | `/api/chat/sessions` | 获取会话列表 | ❌ |
| GET | `/api/chat/sessions/:id` | 获取单个会话 | ❌ |
| PUT | `/api/chat/sessions/:id` | 更新会话 | ❌ |
| DELETE | `/api/chat/sessions/:id` | 删除会话 | ❌ |
| POST | `/api/chat/sessions/:id/messages` | 添加消息 | ❌ |

### 多人协同

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| POST | `/api/collaboration/rooms` | 创建协作房间 | ❌ |
| GET | `/api/collaboration/rooms` | 获取房间列表 | ❌ |
| POST | `/api/collaboration/rooms/:id/join` | 加入房间 | ❌ |
| POST | `/api/collaboration/rooms/:id/leave` | 离开房间 | ❌ |
| GET | `/api/collaboration/rooms/:id` | 获取房间详情 | ❌ |
| POST | `/api/collaboration/rooms/:id/messages` | 发送消息 | ❌ |
| GET | `/api/collaboration/rooms/:id/messages` | 获取消息 | ❌ |
| POST | `/api/collaboration/rooms/:id/lock` | 获取操作锁 | ❌ |
| POST | `/api/collaboration/rooms/:id/unlock` | 释放操作锁 | ❌ |
| GET | `/api/collaboration/rooms/:id/online` | 在线用户列表 | ❌ |

### 知识库

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| GET | `/api/knowledge/status` | 知识库状态 | ❌ |
| POST | `/api/knowledge/search` | 搜索知识库 | ❌ |
| POST | `/api/knowledge/documents` | 添加文档 | ❌ |
| GET | `/api/knowledge/documents` | 文档列表 | ❌ |
| GET | `/api/knowledge/documents/:id` | 获取文档 | ❌ |
| PUT | `/api/knowledge/documents/:id` | 更新文档 | ❌ |
| DELETE | `/api/knowledge/documents/:id` | 删除文档 | ❌ |
| POST | `/api/knowledge/seed` | 初始化种子数据 | ❌ |
| GET | `/api/knowledge/stats` | 知识库统计 | ❌ |

### OCR 识别

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| POST | `/api/ocr/recognize` | 单张识别 | ❌ |
| POST | `/api/ocr/recognize-batch` | 批量识别 | ❌ |

### 智能抠图

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| POST | `/api/remove-bg` | 移除背景 | ✅ |

### 文件上传

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| POST | `/api/upload/image` | 上传图片 | ✅ |
| POST | `/api/upload/video` | 上传视频 | ✅ |
| POST | `/api/upload/image-to-video` | 图生视频上传 | ✅ |

### 配额管理

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| GET | `/api/quota` | 查询配额 | ❌ |
| GET | `/api/quota/:model` | 按模型查询配额 | ❌ |
| POST | `/api/quota/reset` | 重置配额 | ✅ |
| POST | `/api/quota/toggle` | 开关配额 | ✅ |

### LTX 本地视频

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| GET | `/api/ltx/health` | LTX 服务健康检查 | ❌ |
| GET | `/api/ltx/models` | 可用模型列表 | ❌ |
| POST | `/api/ltx/generate` | LTX 视频生成 | ✅ |
| GET | `/api/ltx/status/:taskId` | LTX 任务状态 | ✅ |

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
  │      ├─ 推理模型优先（DeepSeek-V4-Pro / GLM-Z1）
  │      ├─ 指令模型降级（GLM-4-Flash）
  │      └─ 本地 fallback 兜底
  │
  ├─ 2. 审核 Agent（质量检查）
  │      ├─ 脚本审核（video-review）— 5 项检查清单
  │      ├─ 参数审核（review）— 推理模型 chain-of-thought
  │      └─ 结果审核（final）— 最终质量把关
  │
  ├─ 3. 编排器（Orchestrator）
  │      ├─ 并行判断（sequential / parallel / hybrid）
  │      ├─ 动态调度（按依赖关系）
  │      └─ 重试回退（指数退避 1s→2s→4s，最多 3 次）
  │
  └─ 4. 执行 Agent
         ├─ StoryWriter（故事创作 → 视频脚本）
         ├─ VideoMaker（参数提取 → 分镜生成，单段 ≤18 秒）
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

项目实现了 MCP (Model Context Protocol) 协议兼容层，注册了 8 个标准化工具，同时兼容 LLM Function Calling 格式：

| 工具名 | 类别 | 描述 |
|--------|------|------|
| `generate_image` | 图片 | 根据文本描述生成图片，支持 4 种风格 |
| `generate_video` | 视频 | 根据文本描述生成视频，支持 4 种风格 |
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

- 向量嵌入（智谱 Embedding-2）+ 余弦相似度检索
- 重要性评分（0-1）+ 访问频率加权
- 自动去重（内容比对）
- 低分记忆自动衰减清理

### 审核 Agent 自学习记忆

- 推理模型优先（DeepSeek-V4-Pro / GLM-Z1 chain-of-thought）
- 4 步推理流程：提取意图 → 对比理解 → 判定偏差 → 输出修正
- 信任度评分 0-1 + 记录用户修正
- 7 天有效期

### 数据库表

| 表名 | 文件 | 用途 |
|------|------|------|
| `chat_sessions` | `data/chat_sessions.json` | 聊天会话 |
| `chat_messages` | `data/chat_messages.json` | 聊天消息 |
| `agent_short_memory` | `data/agent_short_memory.json` | 短期记忆 |
| `agent_long_memory` | `data/agent_long_memory.json` | 长期记忆 |
| `video_tasks` | `data/video_tasks.json` | 视频任务 |
| `history` | `data/history.json` | 图片生成历史 |
| `videoHistory` | `data/videoHistory.json` | 视频生成历史 |
| `quotas` | `data/quotas.json` | 配额数据 |
| `task_progress` | `data/task_progress.json` | 任务进度持久化 |

---

## 🧭 智能模型路由

4 级路由策略，6 维度自动决策（Agent 类型、用户意图、消息长度、历史长度、是否多模态、是否长视频）：

| 复杂度 | 模型 | 场景 |
|--------|------|------|
| **simple** | 本地 RAG | 简单问答、关键词匹配 |
| **medium** | GLM-4-Flash (智谱) | 意图识别、参数提取、审核 |
| **complex** | DeepSeek-V4-Pro | 多轮上下文融合、深度推理、编排调度 |
| **vision** | GLM-4V-Flash (智谱) | 多模态视觉理解 |

---

## 👥 多人协同

- 协作房间（创建/加入/离开）
- 消息广播
- 操作互斥锁（30 秒 TTL，可重入）
- 在线状态追踪
- 定期清理过期锁（60 秒间隔）

---

## 🛡️ 高并发保护

- 滑动窗口限流（全局 200 req/min，LLM 20 req/min）
- LLM 调用队列（排队等待）
- 熔断器（连续失败自动熔断）
- 请求超时保护（60 秒）
- 连接追踪

---

## 🐳 部署方式

### Docker Compose

```bash
docker-compose up -d

# 如需启用 LTX 本地视频推理（需 GPU）
docker-compose --profile gpu up -d
```

服务包含：
- **Nginx** — 前端静态文件 + API 反向代理
- **Backend** — Express 后端
- **LTX Server** — Python 视频微服务（可选，需 GPU）

### Electron 桌面端

```bash
pnpm electron:build
```

构建 Windows x64 便携版，输出目录 `release-new/`。

### Vercel Serverless

```bash
pnpm dist
```

---

## 🔐 环境变量

```bash
# 必需
ZHIPU_API_KEY=your_zhipu_api_key              # 智谱 AI API Key（主模型）

# 可选 - 模型引擎
DEEPSEEK_API_KEY=your_deepseek_api_key        # DeepSeek V4 API Key（推理模型）
DASHSCOPE_API_KEY=your_dashscope_api_key      # 通义万相 API Key（图片/视频）
DASHSCOPE_BASE_URL=your_dashscope_base_url    # 万相 API 地址
VOLCENGINE_API_KEY=your_volcengine_api_key    # 火山方舟 API Key（Seedream 图片）
VOLCENGINE_MODEL_ID=your_volcengine_model_id  # 火山方舟模型 ID
SEEDANCE_API_KEY=your_seedance_api_key        # Seedance 2.0 视频生成
AGNES_VIDEO_API_KEY=your_agnes_video_api_key  # Agnes Video V2.0
LTX_SERVER_URL=http://localhost:8765          # LTX 本地视频推理服务地址

# 可选 - 系统配置
JWT_SECRET=your_jwt_secret                    # JWT 密钥（默认有开发值）
CORS_ORIGIN=http://localhost:5173             # CORS 允许的源
SKIP_AUTH=true                                # 开发环境跳过鉴权
NODE_ENV=development                          # 运行环境
OCR_SPACE_API_KEY=your_ocr_key                # ocr.space API Key（OCR 降级用）
```

---

## 📊 技术指标

| 指标 | 数据 |
|------|------|
| **前端路由** | 9 个 |
| **页面文件** | 9 个 |
| **前端组件** | 7 个 |
| **API 端点** | 85+ 个 |
| **路由文件** | 17 个 |
| **服务文件** | 26 个 |
| **Agent 数量** | 5 个 + 1 编排器 |
| **AI 模型引擎** | 8 个 |
| **MCP 工具** | 8 个 |
| **数据库表** | 9 张 |
| **部署形态** | 4 种（Docker / Electron / Vercel / 传统） |
| **编译错误** | 0 |
| **TypeScript** | 严格模式 |

---

## 📝 更新日志

### v2.0 (2026-08)

- ✨ 新增 Agent 调度编排器（并行判断 + 动态调度 + 重试回退）
- ✨ 新增 MCP 协议兼容层（8 个标准化工具）
- ✨ 新增 Agent 长短记忆系统（向量检索 + 自动压缩）
- ✨ 新增 智能模型路由器（4 级路由 + 6 维度决策）
- ✨ 新增 SSE 流式对话
- ✨ 新增 OCR 大模型 + 本地降级双通道
- ✨ 新增 多人协同系统（房间/消息广播/互斥锁/在线状态）
- ✨ 新增 高并发保护（限流/熔断/超时/连接追踪）
- ✨ 新增 配额管理系统（按模型每日/总限额）
- ✨ 新增 视频拆分/拼接/修改功能
- ✨ 新增 免费视频降级链（Agnes → 智谱 → Seedance）
- ✨ 新增 分镜脚本检测（三层判断）
- ✨ 新增 持久化任务进度（磁盘存储，重启恢复）
- ✨ 新增 思考流程可视化（默认展开）
- ✨ 新增 JSON 文件数据库（9 张表）
- ✨ 新增 操作日志系统（按日分文件）
- ✨ 新增 Electron 桌面端构建支持
- 🔧 模型升级：DeepSeek-R1 → DeepSeek-V4-Pro，deepseek-chat → DeepSeek-V4-Flash
- 🔧 新增引擎：Trae AI（内置图片生成）、火山方舟（Seedream）
- 🔧 优化 Agent 上下文关联（指代词 + 延续性指令）
- 🔧 优化 AI 回复自然度

### v1.0 (2026-07)

- 🎉 初始版本发布
- 文生图（4 引擎）、文生视频（4 引擎）
- 智能抠图、图片合成、知识库
- 多 Agent 协作（Hermes + Story + Video + Image + Review）
- Docker + Electron + Vercel 部署