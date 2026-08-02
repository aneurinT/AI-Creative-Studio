# AI Creative Studio（AI 创意工坊）

[![React](https://img.shields.io/badge/React-18-blue)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-purple)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-4-green)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

> 多人协作 AI 创意平台 — 对话式 AI 助手 + 图片生成 + 视频生成 + 智能审核 + 配额管理

---

## ✨ 功能特性

### 🤖 AI 智能助手（首页）
- 自然语言对话式交互，输入一句话即可生成图片或视频
- **多 Agent 协作**：意图识别 → 脚本创作 → 视频分析 → 审核 Agent 全流程
- **RAG 知识增强**：向量知识库增强 prompt 质量，支持混合搜索
- 审核 Agent：生成前审核脚本、生成后检查质量、**失败时分析原因并给出优化建议**

### 🎨 图片生成
- 多模型支持：**Trae AI**（内置免费）、智谱 CogView-4、火山方舟 Seedream
- 自动降级链：模型不可用/额度耗尽时自动切换备用引擎
- 支持 prompt 优化、图片描述分析、修改图片

### 🎬 视频生成
- **智谱 CogVideoX-Flash**：完全免费，默认引擎
- **智能拆分拼接**：长视频自动分段生成 + ffmpeg 无损拼接
  - 智谱最大 6 秒/段，15 秒 → 3 段 × 5 秒，30 秒 → 5 段 × 6 秒
- 分镜脚本检测：正则 → AI 语义 → 结构化，逐段生成后拼接
- 降级链：智谱 → Seedance
- 视频修改、视频历史管理

### 🖼️ 其他工具
| 工具 | 功能 |
|------|------|
| **智能抠图** | 本地 AI 去背景（@imgly/background-removal） |
| **图片合成** | 上传两张图片，提取主体合成到新背景 |
| **图转视频** | 上传图片自动生成视频 |

### 🔐 用户系统
- JWT 认证 + bcrypt 密码加密
- 注册/登录，多用户数据隔离
- 默认管理员账号

### 📊 配额管理
- 按模型追踪每日/总调用次数
- 免费额度用完自动阻止 + 提示
- 管理员可查看/重置配额、启用/禁用模型

### ⚙️ 可视化配置
- `/settings` 页面统一管理所有模型 API Key
- 一键测试连接验证 Key 有效性
- Key 加密存储在服务器端

### 🖥️ 部署方式
- 浏览器 Web 应用（Vite 开发服务器 / Nginx 静态文件）
- Electron 桌面端（Windows 便携版 .exe）
- Docker 容器化部署（Nginx + Node + Redis + LTX）
- LTX-Video GPU 本地推理（可选，5 秒视频约 20 秒生成）

---

## 🚀 快速开始

### 环境要求

| 工具 | 最低版本 |
|------|----------|
| Node.js | >= 18 |
| pnpm（推荐）或 npm | - |
| ffmpeg（视频拼接需要） | 可选，项目内置 `@ffmpeg-installer` |

### 安装

```bash
git clone https://gitee.com/aneurin-tao/agent-video.git
cd agent-video
pnpm install
cd api && pnpm install && cd ..
```

### 配置

```bash
cp .env.example .env
# 编辑 .env，填入你的 API Key
```

| 配置项 | 说明 | 必填 |
|--------|------|------|
| `ZHIPU_API_KEY` | 智谱 AI（LLM + 视频 + 图片） | ✅ |
| `DASHSCOPE_API_KEY` | 通义万相图片/视频（可选） | ❌ |
| `VOLCENGINE_API_KEY` | 火山方舟（可选） | ❌ |
| `DEEPSEEK_API_KEY` | DeepSeek 对话 | ❌ |
| `JWT_SECRET` | JWT 密钥（生产环境请修改） | ✅ |

> 也可以在启动后通过 `http://localhost:5173/settings` 在线配置 API Key。

### 启动

```bash
# Windows 一键启动
双击 启动项目.bat

# 或手动启动
npx tsx api/server.ts      # 终端 1：后端 → http://localhost:3001
npx vite --host 0.0.0.0    # 终端 2：前端 → http://localhost:5173
```

### Docker 部署

```bash
docker-compose up -d                    # 基础部署
docker-compose --profile gpu up -d      # 含 LTX GPU 推理
```

### Electron 打包

```bash
npm run dist          # 打包为 Windows 便携版 .exe
npm run dist:dir      # 打包为目录（调试用）
```

---

## 📁 项目结构

```
aiProject/
├── src/                          # 前端 React
│   ├── pages/                    # 页面
│   │   ├── Login.tsx             # 登录/注册
│   │   ├── AssistantPage.tsx     # AI 助手（首页）
│   │   ├── Home.tsx              # 图片生成
│   │   ├── VideoGenerator.tsx    # 视频生成
│   │   ├── Settings.tsx          # 模型配置
│   │   ├── RemoveBg.tsx          # 抠图
│   │   └── ImageComposer.tsx     # 图片合成
│   ├── components/               # 组件（Navbar/AIAssistant/ModelSelector...）
│   ├── contexts/AuthContext.tsx   # JWT 认证上下文
│   └── store/imageStore.ts       # Zustand 状态管理
├── api/                          # 后端 Express
│   ├── routes/                   # 16 个路由文件
│   │   ├── auth.ts               # 用户认证
│   │   ├── generate.ts           # 图片生成
│   │   ├── video.ts              # 视频生成（拆分拼接核心）
│   │   ├── chat.ts               # 会话 CRUD
│   │   ├── agents.ts             # Agent 协作引擎
│   │   ├── hermes.ts             # 审核 Agent
│   │   ├── config.ts             # 模型配置
│   │   ├── test.ts               # Key 测试
│   │   ├── quota.ts              # 配额管理
│   │   ├── ltx.ts                # LTX 本地推理
│   │   ├── storyboard.ts         # 分镜检测
│   │   └── knowledge.ts          # 知识库
│   ├── services/                 # 18 个服务文件
│   │   ├── imageService.ts       # 图片/视频生成
│   │   ├── freeVideoService.ts   # 免费视频引擎
│   │   ├── videoSplitService.ts  # 视频拆分
│   │   ├── videoReviewAgent.ts   # 视频审核
│   │   ├── ragKnowledge.ts       # RAG 知识检索
│   │   ├── vectorStore.ts        # 向量存储
│   │   └── quotaService.ts       # 配额管理
│   └── middleware/auth.ts        # JWT 鉴权中间件
├── ltx-video-server/             # Python LTX 推理服务
│   ├── server.py                 # FastAPI 服务
│   └── start.bat                 # 启动脚本
├── electron/                     # Electron 桌面端
├── .env.example                  # 环境变量模板
├── 启动项目.bat                   # Windows 一键启动
├── Dockerfile.backend            # 后端镜像
├── docker-compose.yml            # Docker 编排
└── package.json
```

---

## 🧠 AI 模型支持

### 图片生成

| 模型 | 供应商 | 配置项 | 类型 |
|------|--------|--------|------|
| Trae AI | 内置 | 无需配置 | 免费 |
| 智谱 CogView-4 | 智谱 AI | `ZHIPU_API_KEY` | 限量免费 |
| 火山方舟 Seedream | 火山引擎 | `VOLCENGINE_API_KEY` | 付费 |

### 视频生成

| 模型 | 供应商 | 单次最大 | 配置项 | 类型 |
|------|--------|----------|--------|------|
| 智谱 CogVideoX-Flash | 智谱 AI | 6 秒 | `ZHIPU_API_KEY` | **免费** |
| Seedance 2.0 | 火山引擎 | 10 秒 | `SEEDANCE_API_KEY` | 付费 |
| LTX-Video 本地 | 本地 GPU | 可配置 | 无需 Key | 本地 |

### LLM 对话

| 用途 | 模型 | 供应商 |
|------|------|--------|
| 意图识别 | `deepseek-chat` | DeepSeek |
| 脚本/审核/分镜 | `glm-4-flash` | 智谱 AI（免费） |
| 图片理解 | `glm-4v-flash` | 智谱 AI（免费） |

---

## 🔑 默认账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123 | 管理员 |

首次启动自动创建，请在首次登录后修改密码。

---

## 📡 API 端点概览

| 前缀 | 说明 | 端点数量 |
|------|------|----------|
| `/api/auth` | 用户认证 | 3 |
| `/api/generate` | 图片生成 | 4 |
| `/api/video` | 视频生成 | 10+ |
| `/api/chat` | 会话管理 | 7 |
| `/api/hermes` | 审核 Agent | 4 |
| `/api/agents` | 多 Agent 协作 | 10+ |
| `/api/upload` | 文件上传 | 3 |
| `/api/remove-bg` | 抠图 | 1 |
| `/api/history` | 历史记录 | 3 |
| `/api/config` | 模型配置 | 3 |
| `/api/test` | Key 测试 | 1 |
| `/api/quota` | 配额管理 | 4 |
| `/api/ltx` | LTX 推理 | 4 |
| `/api/knowledge` | 知识库 | 10+ |
| `/api/storyboard` | 分镜检测 | 2 |
| `/api/health` | 健康检查 | 1 |

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite 6 + Tailwind CSS 3 |
| 状态管理 | Zustand 5 |
| 后端 | Express 4 + TypeScript (tsx 运行时) |
| 认证 | JWT + bcryptjs + jsonwebtoken |
| AI 模型 | DeepSeek / 智谱 GLM-4-Flash / CogVideoX / CogView-4 |
| 视频处理 | ffmpeg (@ffmpeg-installer) |
| 向量存储 | 内存向量库 + JSON 持久化 + 智谱 Embedding-2 |
| Python 服务 | FastAPI + uvicorn (LTX 推理) |
| 桌面端 | Electron 43 |
| 容器化 | Docker + Docker Compose |

---

## 📄 License

MIT
