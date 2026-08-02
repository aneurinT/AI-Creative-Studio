# AI Creative Studio

多人协作 AI 创意平台，支持文生图、文生视频、AI 助手对话、智能审核 Agent、用户认证与配额管理。

## 功能特性

### 🎨 图片生成
- 多模型支持：Trae AI（免费）、智谱 CogView-4、火山方舟 Seedream
- 自动降级链：模型不可用时自动切换备用引擎
- 支持 prompt 优化、图片描述分析

### 🎬 视频生成
- **智谱 CogVideoX-Flash**：完全免费，默认引擎
- 智能拆分：长视频自动分段生成 + ffmpeg 无损拼接
  - 15 秒 → 3 段 × 5 秒
  - 30 秒 → 5 段 × 6 秒
- 降级链：智谱 → Seedance
- 故事板生成、分镜脚本审核

### 🤖 AI 助手
- 自然语言交互，支持图片和视频生成
- 多 Agent 协作：意图识别 → 脚本创作 → 视频分析 → 审核 Agent
- 审核 Agent：生成前审核脚本，生成后检查质量，失败时分析原因
- 会话管理：多会话切换，聊天记录持久化

### 🔐 用户系统
- JWT 认证，注册/登录
- 多用户隔离：各自会话、历史记录独立
- 默认管理员账号：`admin` / `admin123`

### 📊 配额管理
- 按模型追踪每日/总调用次数
- 免费额度用完自动阻止，提示切换引擎
- 管理员可重置配额

### ⚙️ 模型配置
- 可视化设置页面，支持所有模型的 API Key 配置
- 一键测试连接验证 Key 有效性
- Key 加密存储在服务器端

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS |
| 后端 | Express.js + TypeScript (tsx) |
| 认证 | JWT + bcryptjs |
| 视频拼接 | ffmpeg (concat demuxer) |
| AI 模型 | 智谱 GLM-4-Flash / DeepSeek / CogVideoX / CogView-4 |
| 图片生成 | Trae AI / 火山方舟 Seedream |
| 包管理 | pnpm |

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm（推荐）或 npm
- ffmpeg（视频拼接需要，可选）

### 安装

```bash
# 克隆项目
git clone https://gitee.com/aneurin-tao/agent-video.git
cd agent-video

# 安装依赖
pnpm install
cd api && pnpm install && cd ..
```

### 配置

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env，填入你的 API Key
# 主要配置项：
#   ZHIPU_API_KEY    - 智谱 AI（LLM + 视频 + 图片）
#   DASHSCOPE_API_KEY - 通义万相（可选）
#   VOLCENGINE_API_KEY - 火山方舟（可选）
#   DEEPSEEK_API_KEY  - DeepSeek 对话（可选）
```

也可以在启动后通过设置页面（`/settings`）在线配置 API Key。

### 启动

```bash
# 一键启动（Windows）
双击 启动项目.bat

# 或手动启动
# 终端 1：后端
npx tsx api/server.ts

# 终端 2：前端
npx vite --host 0.0.0.0
```

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`

## 项目结构

```
├── api/                    # 后端 Express 服务
│   ├── routes/             # API 路由
│   │   ├── auth.ts         # 用户认证
│   │   ├── chat.ts         # 会话管理
│   │   ├── video.ts        # 视频生成（含拆分拼接）
│   │   ├── generate.ts     # 图片生成
│   │   ├── agents.ts       # AI 助手 Agent 编排
│   │   ├── hermes.ts       # 审核 Agent
│   │   ├── config.ts       # 模型配置
│   │   ├── test.ts         # API Key 测试
│   │   └── quota.ts        # 配额管理
│   ├── services/           # 业务逻辑
│   │   ├── imageService.ts # 图片生成服务
│   │   ├── freeVideoService.ts # 免费视频服务
│   │   ├── videoSplitService.ts # 视频拆分服务
│   │   ├── videoReviewAgent.ts # 视频审核 Agent
│   │   ├── reviewAgent.ts  # 通用审核 Agent
│   │   ├── quotaService.ts # 配额服务
│   │   └── chatSessionService.ts # 会话存储
│   ├── middleware/
│   │   └── auth.ts         # JWT 鉴权中间件
│   └── server.ts           # 入口
├── src/                    # 前端 React
│   ├── components/         # 组件
│   │   └── AIAssistant.tsx # AI 助手核心组件
│   ├── pages/              # 页面
│   │   ├── Login.tsx       # 登录/注册
│   │   ├── Settings.tsx    # 模型配置
│   │   ├── VideoGenerator.tsx # 视频生成
│   │   └── Home.tsx        # 图片生成
│   ├── contexts/
│   │   └── AuthContext.tsx # 认证上下文
│   └── store/              # 状态管理
├── .env.example            # 环境变量模板
├── 启动项目.bat             # Windows 一键启动
└── vite.config.ts          # Vite 配置
```

## 默认账号

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123 | 管理员 |

首次启动自动创建，首次使用请修改密码。

## 模型配置

启动后访问 `http://localhost:5173/settings`，可配置以下模型的 API Key：

- **图片**：Trae AI（内置免费）、智谱 CogView-4、火山方舟 Seedream
- **视频**：智谱 CogVideoX-Flash（免费）、Seedance 2.0
- **对话**：DeepSeek

每个模型支持「测试连接」验证 Key 是否有效。

## License

MIT
