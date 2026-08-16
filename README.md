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
| 🎞️ **AI 视频剪辑** | AI 字幕、AI 配音、视频片段替换，大模型优先 + 本地插件降级 | ✅ |
| 🌐 **社交媒体发布** | 抖音/快手/小红书一键发布，OAuth 授权 + 定时发布 + 熔断重试 | ✅ |
| 📊 **链路追踪** | Agent 调度调用链可视化，Span 树 + 耗时分析 + 失败归因 | ✅ |

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
| 🏠 **本地 LLM 推理** | Qwen3-4B GGUF 量化模型，node-llama-cpp v3，4 个 Agent 全接入，本地优先→云端降级 |

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
| 🗄️ **双模数据库** | JSON（开发模式）↔ SQLite（生产模式）适配器层，`DB_MODE` 一键切换 |
| 🔌 **可插拔推理后端** | LTX 抽象为标准接口的推理后端，注册表模式，可无缝替换为 SVD 等 |
| 📊 **链路追踪** | 自研轻量 tracing，Span 树持久化，HTTP → orchestrator → agent 全链路 |
| ⏰ **定时发布持久化** | 定时发布任务持久化到 DB，服务重启自动恢复，不丢失 |

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
│  │ 本地LLM  │ │ 加载锁   │ │ 推理串行队列           │  │
│  │Qwen3-4B  │ │ Promise  │ │ inferenceChain        │  │
│  └──────────┘ └──────────┘ └───────────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────────┐  │
│  │ 链路追踪  │ │ 推理后端  │ │ 社交媒体发布           │  │
│  │Span 树   │ │ 可插拔   │ │ OAuth/定时/熔断        │  │
│  └──────────┘ └──────────┘ └───────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │        DB 适配器层（JSON ↔ SQLite 双模式）         │  │
│  │  13 张表 · DB_MODE 切换 · WAL 写入 · 重启恢复      │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────────┐  │
│  │ 日志系统  │ │ JWT 鉴权  │ │ Trace 中间件           │  │
│  │ 按日分文件 │ │ 白名单   │ │ traceId 注入           │  │
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
| `pnpm llm` | 本地 LLM 交互式管理（状态/加载/对话） |
| `pnpm llm:test` | 本地 LLM 批量测试（6 场景评估） |
| `pnpm download-models` | 下载 GGUF 量化模型文件 |

---

## 📁 项目结构

```
aiProject/
├── api/                          # 后端代码
│   ├── app.ts                    # Express 应用入口
│   ├── server.ts                 # 服务器启动
│   ├── index.ts                  # 导出入口
│   ├── routes/                   # API 路由（22 个文件）
│   │   ├── agents.ts             # Agent 调度路由（story/video/image + 编排 + traceId 注入）
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
│   │   ├── ltx.ts                # LTX 本地视频推理代理（facade → inference 后端）
│   │   ├── traces.ts             # 链路追踪查询（列表/详情/Span 树）
│   │   ├── socialMedia.ts        # 社交媒体发布 + 定时任务调度
│   │   ├── videoEdit.ts          # AI 视频剪辑（字幕/配音/片段替换）
│   │   ├── office.ts             # 办公工具（钉钉/飞书/企业微信 Webhook）
│   │   ├── a2a.ts                # A2A 协议端点
│   │   ├── mock.ts               # Mock 数据生成
│   │   ├── quota.ts              # 配额管理
│   │   ├── removeBg.ts           # 智能抠图
│   │   ├── storyboard.ts         # 分镜脚本检测与审核
│   │   ├── test.ts               # 模型测试
│   │   └── upload.ts             # 文件上传（图片/视频/图生视频）
│   ├── services/                 # 核心服务
│   │   ├── toolRegistry.ts       # MCP 协议 + Tool Calling 注册中心
│   │   ├── orchestrator.ts       # Agent 调度编排器（含 tracing 埋点）
│   │   ├── tracing.ts            # 链路追踪（startSpan/endSpan/createTrace）
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
│   │   ├── ltxVideoService.ts    # LTX 推理 facade（委托 inference 后端）
│   │   ├── socialMediaService.ts # 社交媒体发布（OAuth + 重试 + 熔断）
│   │   ├── scheduledPublishService.ts # 定时发布调度（DB 持久化）
│   │   ├── videoEditService.ts   # AI 视频剪辑（字幕/配音/片段替换）
│   │   ├── localLlmService.ts    # 本地 LLM 推理服务（node-llama-cpp v3 + GGUF）
│   │   ├── officeService.ts      # 办公工具 Webhook（钉钉/飞书/企微）
│   │   ├── checkpointService.ts  # 检查点服务
│   │   ├── fetchUtils.ts         # HTTP 请求工具
│   │   ├── loggerService.ts      # 结构化日志服务
│   │   ├── historyService.ts     # 图片历史服务
│   │   ├── db/                   # 数据库适配器层（JSON ↔ SQLite 双模式）
│   │   │   ├── index.ts          # facade（DB_MODE 切换 + 自动降级）
│   │   │   ├── types.ts          # DatabaseAdapter 接口 + 13 张表行类型
│   │   │   ├── jsonAdapter.ts    # JSON 文件实现（开发模式）
│   │   │   └── sqliteAdapter.ts  # SQLite 实现（生产模式，WAL + 索引）
│   │   └── inference/            # 可插拔推理后端抽象层
│   │       ├── index.ts          # 后端初始化 + 注册
│   │       ├── types.ts          # InferenceBackend 标准接口
│   │       ├── registry.ts       # 后端注册表
│   │       └── ltxBackend.ts     # LTX 后端实现
│   ├── middleware/
│   │   ├── auth.ts               # JWT 鉴权中间件
│   │   └── trace.ts              # 链路追踪中间件（traceId 注入）
│   ├── scripts/                  # 工具脚本
│   │   ├── download-gguf-models.mjs # GGUF 模型下载（ModelScope/HF）
│   │   ├── start-local-llm.mjs   # 本地 LLM 一键启动管理工具
│   │   └── test-local-llm-batch.mjs # 本地 LLM 批量测试框架
│   └── data/                     # 数据存储（运行时生成）
│       ├── *.json                # JSON 模式数据文件（DB_MODE=json）
│       ├── app.db                # SQLite 数据库（DB_MODE=sqlite）
│       └── logs/                 # 操作日志（按日分文件）
├── src/                          # 前端代码
│   ├── App.tsx                   # 路由配置（11 个路由）
│   ├── main.tsx                  # 入口
│   ├── components/               # 公共组件
│   │   ├── AIAssistant.tsx       # AI 助手主组件（3000+ 行）
│   │   ├── Navbar.tsx            # 导航栏
│   │   ├── ChatHistory.tsx       # 聊天历史侧边栏
│   │   ├── Hero.tsx              # 首页 Hero 区域
│   │   ├── Empty.tsx             # 空状态占位
│   │   ├── ImageUploader.tsx     # 图片上传（拖拽 + 图生视频）
│   │   └── ModelSelector.tsx     # 模型选择器
│   ├── pages/                    # 页面组件（11 个）
│   │   ├── AssistantPage.tsx     # AI 助手页（多 Agent 协作主入口）
│   │   ├── Home.tsx              # 一键生图
│   │   ├── VideoGenerator.tsx    # 视频生成
│   │   ├── VideoEditor.tsx       # AI 视频剪辑
│   │   ├── RemoveBg.tsx          # 智能抠图
│   │   ├── OcrPage.tsx           # OCR 识别
│   │   ├── ImageComposer.tsx     # 图片合成
│   │   ├── Settings.tsx          # 模型配置
│   │   ├── SocialBind.tsx        # 社交账号绑定 + 定时发布管理
│   │   ├── Traces.tsx            # 链路追踪可视化（Span 树时间线）
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
| POST | `/api/agents/video/edit` | 视频剪辑方案分析 | ❌ |

### 本地 LLM 管理

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| GET | `/api/local-llm/status` | 本地模型状态（已加载/文件存在/显存） | ❌ |
| POST | `/api/local-llm/load` | 加载指定模型到内存 | ❌ |
| POST | `/api/local-llm/unload` | 卸载模型释放内存 | ❌ |
| POST | `/api/local-llm/generate` | 直接调用本地模型推理 | ❌ |

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

### 链路追踪

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| GET | `/api/traces` | Trace 列表（支持 status/limit 筛选） | ❌ |
| GET | `/api/traces/:traceId` | Trace 详情（含 Span 调用树） | ❌ |

### 社交媒体发布

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|:---:|
| POST | `/api/social/publish` | 一键多平台发布 | ❌ |
| GET | `/api/social/accounts` | 已绑定账号列表 | ❌ |
| GET | `/api/social/schedules` | 定时任务列表 | ❌ |
| POST | `/api/social/schedule` | 创建定时发布任务 | ❌ |
| GET | `/api/social/schedule/:id` | 获取单个定时任务 | ❌ |
| PATCH | `/api/social/schedule/:id` | 更新任务（启用/暂停/改间隔） | ❌ |
| DELETE | `/api/social/schedule/:id` | 删除定时任务 | ❌ |
| POST | `/api/social/schedule/:id/run` | 立即执行一次定时任务 | ❌ |

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
         ├─ ImageCreator（图像参数 → prompt 优化）
         └─ VideoEditor（剪辑方案 → action/params）
```

### 本地 LLM 优先策略

所有 4 个执行 Agent 均采用 **本地优先 → 云端降级** 双通道：

```
Agent 请求
  │
  ├─ 1. 本地模型优先（Qwen3-4B GGUF, ~30-80s/次）
  │      ├─ 少样本提示 + 关键词预翻译注入 + 相关性校验
  │      ├─ 成功 → 直接返回（modelUsed: local-qwen3-4b）
  │      └─ 失败 → 降级到云端
  │
  └─ 2. 云端 API 降级（通过 llmQueue + 熔断器保护）
         ├─ DeepSeek-V4-Pro / GLM-Z1（推理模型）
         ├─ GLM-4-Flash（指令模型）
         └─ 熔断时 → 本地模板兜底
```

| Agent | 本地处理函数 | 输出格式 |
|-------|-------------|---------|
| StoryWriter | `callLocalLlmForStoryWrite` | JSON 数组分场景脚本 |
| VideoMaker | `callLocalLlmForVideoAnalysis` | JSON prompt+style+duration |
| ImageCreator | `callLocalLlmForImageAnalysis` | JSON prompt+style+composition |
| VideoEditor | `callLocalLlmForVideoEdit` | JSON action+params+analysis |

### 稳定性测试（`pnpm llm:test`）

8 个测试用例覆盖 4 个 Agent，清理磁盘后（30GB→5.5GB）复测，全部通过：

```
总测试数:       8
本地模型使用:   8/8 (100%)
本地模型成功:   8/8 (100%)
降级到云端:     0/8
异常失败:       0/8
平均耗时:       60.6s/次（CPU 推理）
总耗时:         484.6s
```

| Agent | 用例 | 耗时 | 验证 |
|-------|------|------|------|
| StoryWriter | 樱花女孩跳舞 | 82.4s | 场景✓ 关键词✓ 128字 |
| StoryWriter | 橘猫晒太阳 | 69.4s | 场景✓ 关键词✓ 107字 |
| VideoMaker | 海洋日落 10s | 38.5s | 6/6 英文关键词 (100%) |
| VideoMaker | 城市夜景 15s | 45.8s | 5/6 英文关键词 (83%) |
| ImageCreator | 赛博朋克 | 62.7s | 5/5 关键词 (100%), style=cyberpunk |
| ImageCreator | 雪山湖泊倒影 | 75.3s | 4/6 关键词 (67%) |
| VideoEditor | 剪掉前5秒 | 59.9s | action=trim, params={0,5} |
| VideoEditor | 添加字幕 | 50.6s | action=subtitle, text=大家好... |

**结论: ✅ 稳定 — 本地模型接入可靠，可放心使用**

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

### 数据库表（JSON ↔ SQLite 双模式）

通过 `DB_MODE` 环境变量切换：`json`（默认，开发模式，每表一个 `.json` 文件）或 `sqlite`（生产模式，单文件 `app.db`，WAL + 索引）。适配器层 facade 自动选择实现，业务代码无感知。

| 表名 | 用途 |
|------|------|
| `chat_sessions` | 聊天会话 |
| `chat_messages` | 聊天消息 |
| `agent_short_memory` | 短期记忆 |
| `agent_long_memory` | 长期记忆 |
| `video_tasks` | 视频任务 |
| `history` | 图片生成历史 |
| `videoHistory` | 视频生成历史 |
| `video_task_progress` | 任务进度持久化（重启恢复） |
| `operation_logs` | 操作日志 |
| `checkpoints` | 检查点 |
| `traces` | 链路追踪根记录 |
| `trace_spans` | 链路追踪 Span（含父子关系 + 耗时 + 重试） |
| `scheduled_tasks` | 定时发布任务（持久化，重启恢复） |

> 数据迁移：`pnpm migrate:sqlite` 可将现有 JSON 数据导入 SQLite（见 `api/scripts/migrate-json-to-sqlite.ts`）。

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
- LLM 调用队列（`llmQueue`，maxConcurrent=3，排队超时 60s）
- 熔断器（`llmCircuitBreaker`，连续失败 5 次熔断，30s 恢复）
- 本地模型加载锁（`loadingPromises`，并发请求共享同一次加载，重复加载 3 次→1 次，省 22s）
- 本地推理串行队列（`inferenceChain`，解决 node-llama-cpp "No sequences left" + "DisposedError"）
- 请求超时保护：普通路由 60s，Agent 路由 180s（适配本地模型 CPU 推理 ~80s/次）
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

# 数据库配置（JSON ↔ SQLite 双模式）
DB_MODE=json                                  # json（默认）| sqlite（生产推荐）
# DB_PATH=./data/app.db                       # SQLite 文件路径（可选）

# 推理后端配置（可插拔）
INFERENCE_DEFAULT_BACKEND=ltx                 # 默认推理后端：ltx | svd（未来）
LTX_ENABLED=true                              # 是否启用 LTX 后端

# 本地 LLM 推理（Qwen3-4B GGUF, node-llama-cpp v3）
LOCAL_LLM_ENABLED=true                        # 是否启用本地模型优先
LLM_USE_CPU=true                              # 强制 CPU 推理（无 GPU 时）
MODELSCOPE_HOME=./data/modelscope_home        # ModelScope 缓存目录

# 社交媒体集成（可选）
DOUYIN_CLIENT_KEY=your_douyin_key             # 抖音开放平台
KUAISHOU_CLIENT_KEY=your_kuaishou_key         # 快手开放平台
XIAOHONGSHU_CLIENT_KEY=your_xhs_key           # 小红书开放平台
```

---

## 📊 技术指标

| 指标 | 数据 |
|------|------|
| **前端路由** | 11 个 |
| **页面文件** | 11 个 |
| **前端组件** | 7 个 |
| **API 端点** | 100+ 个 |
| **路由文件** | 22 个 |
| **服务文件** | 30+ 个 |
| **Agent 数量** | 5 个 + 1 编排器 |
| **AI 模型引擎** | 8 个云端 + 1 个本地（Qwen3-4B） |
| **MCP 工具** | 8 个 |
| **数据库表** | 13 张（JSON/SQLite 双模式） |
| **推理后端** | 可插拔（LTX 已实现，SVD 可扩展） |
| **部署形态** | 4 种（Docker / Electron / Vercel / 传统） |
| **项目体积** | 5.5 GB（优化后，含 2.3GB 本地模型 + 1.3GB node_modules） |
| **本地模型稳定性** | 8/8 (100%) 通过，4 个 Agent 全覆盖（见稳定性测试） |
| **本地模型平均耗时** | 60.6s/次（CPU 推理，i7-10875H） |
| **TypeScript** | 严格模式 |

---

## 📝 更新日志

### v2.2 (2026-08) — 本地 LLM 推理集成 + 磁盘优化

- 🏠 **本地 LLM 推理服务**：Qwen3-4B GGUF 量化模型（2.3GB），node-llama-cpp v3 引擎，CPU/GPU 混合推理
- 🤖 **4 个 Agent 全接入本地模型**：StoryWriter / VideoMaker / ImageCreator / VideoEditor 均采用本地优先→云端降级策略
- 🎯 **相关性校验机制**：84 条中文→英文关键词词典，预翻译注入提示词，`checkRelevance` 函数过滤幻觉输出（阈值 0.4）
- 🔒 **加载锁优化**：`loadingPromises` Map 让并发请求共享同一次模型加载，消除重复加载（3 次→1 次，省 22s）
- 🔗 **推理串行队列**：`inferenceChain` 链式 Promise，解决 node-llama-cpp 序列竞争（"No sequences left" + "DisposedError"）
- 🛡️ **llmQueue 队列启用**：`callReasoningAgent` / `callHermesWithContext` 通过 `llmQueue.enqueue()` + `llmCircuitBreaker.call()` 包裹云端 API 调用
- ⏱️ **Agent 路由超时延长**：普通路由 60s，Agent 路由 180s（适配本地模型 CPU 推理 ~80s/次）
- 🔧 **一键管理工具**：`pnpm llm` 交互式管理、`pnpm llm:test` 批量测试、`pnpm download-models` 模型下载
- ✅ **本地模型稳定性测试通过**：8/8 (100%) 通过，4 Agent 全覆盖，平均 60.6s/次（CPU），详见下方测试结果
- 📦 **磁盘优化 30GB → 5.5GB（省 25GB）**：
  - 删除未使用的 Qwen3-0.6B 全量化版本目录（10.4 GB）和单独的 0.6B GGUF 文件（610 MB），MODEL_REGISTRY 仅保留 Qwen3-4B
  - 清理旧生成媒体（api/public videos/images/uploads 506 MB）和临时视频（temp_videos 62 MB）
  - 删除停用的 ModelScope Python SDK（api/pylibs 62 MB），下载脚本已改用纯 HTTP
  - 清理构建产物（dist/dist-electron）、Vite 缓存（.vite）、5 个临时分析目录
  - `.gitignore` 新增排除规则：GGUF 模型、pylibs、temp_videos、public 媒体、构建产物

### v2.1 (2026-08) — 架构与性能优化

- 🏗 **数据库适配器层**：JSON（开发模式）↔ SQLite（生产模式）双模式，`DB_MODE` 一键切换，13 张表统一通过 `DatabaseAdapter` 接口访问，facade 自动降级
- 📊 **Agent 链路追踪**：自研轻量 tracing 中间件，HTTP → orchestrator → agent 全链路 Span 树持久化，前端 `/traces` 页面可视化（调用树 + 甘特时间线 + 失败归因）
- 🔌 **可插拔推理后端**：LTX 抽象为标准 `InferenceBackend` 接口（启动/查询/取消/回调），注册表模式，未来可无缝替换为 SVD 等
- ⏰ **定时发布持久化**：定时任务从内存 Map 迁移到 DB 适配器，服务重启自动恢复，`scheduled_tasks` 表 + 复合索引
- 🎞️ **AI 视频剪辑**：AI 字幕 / AI 配音 / 片段替换，大模型优先 + 本地插件（FFmpeg/Whisper/Edge-TTS）降级
- 🌐 **社交媒体一键发布**：抖音/快手/小红书 OAuth 授权 + 自动重试（指数退避）+ 熔断器 + 定时调度
- 🧭 **导航菜单整合**：9 个扁平菜单重组为 AI 助手 + 视频模块/图片模块/配置模块/运维监控 4 个下拉分组
- 🔧 迁移脚本 `migrate-json-to-sqlite.ts` 支持 JSON → SQLite 数据迁移

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