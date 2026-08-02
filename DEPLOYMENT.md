# AI 创意工坊 — 完整部署指南

## 一、项目组件与部署位置

| 组件 | 端口 | 技术栈 | 部署位置 |
|------|------|--------|----------|
| **前端 (Web)** | 80 | Vite/React (静态) | Nginx → `/usr/share/nginx/html` |
| **后端 API** | 3001 | Express/TypeScript (tsx) | Docker 容器 `backend` 或 PM2 进程 |
| **LTX 视频** | 8000 | Python/FastAPI | Docker 容器 `ltx-server`（需 GPU） |
| **Redis** | 6379 | Redis 7 | Docker 容器 `redis` |
| **静态资源** | 通过 Nginx | 图片/视频/上传 | `api/public/**` |

## 二、打包上传

```bash
# 1. 构建前端
npm run build          # → dist/

# 2. 打包（不含 node_modules 和模型权重）
tar -czf ai-studio.tar.gz \
  --exclude=node_modules \
  --exclude=LTX-Video/LTX-Video-weights \
  --exclude=ltx-video-server/outputs \
  --exclude=.codebuddy \
  --exclude=dist-electron \
  --exclude=release* \
  api/ src/ dist/ public/ data/ .env \
  package.json pnpm-lock.yaml \
  vite.config.ts tsconfig.json index.html \
  postcss.config.js tailwind.config.js \
  nginx.docker.conf nginx.conf redis.conf \
  docker-compose.yml Dockerfile.backend \
  ltx-video-server/ \
  hermes.toml nodemon.json

# 3. 上传到服务器
scp ai-studio.tar.gz administrator@120.26.240.66:C:/ai-project/

# 4. 服务器解压
ssh administrator@120.26.240.66
cd C:/ai-project && tar -xzf ai-studio.tar.gz
```

## 三、Docker 部署（推荐，一行启动）

```bash
# 在服务器项目目录
cd C:/ai-project

# 修改 .env 中的 REDIS_URL 为 Docker 内部地址
# REDIS_URL=redis://:ai-studio-redis@redis:6379

# 启动所有服务（前端+后端+Redis）
docker-compose up -d

# 只启动 LTX（需要 GPU）
docker-compose --profile gpu up -d

# 查看日志
docker-compose logs -f backend

# 停止
docker-compose down
```

### 服务验证

```bash
# 访问前端
curl http://localhost

# 检查后端健康
curl http://localhost/api/health

# 检查 Redis
docker exec ai-studio-redis redis-cli -a ai-studio-redis ping
```

## 四、传统部署（不用 Docker）

```bash
# 1. 安装 Node.js 22+
# 2. 安装 pnpm
npm install -g pnpm

# 3. 安装依赖 + 构建
pnpm install
npm run build

# 4. 配置 Nginx（复制 nginx.conf 到 /etc/nginx/）
# 修改 Nginx 配置指向 dist/ 和 localhost:3001

# 5. 启动后端（PM2 守护进程）
npm install -g pm2
pm2 start api/server.ts --name ai-studio --interpreter tsx
pm2 save
pm2 startup

# 6. 启动 Redis（可选）
docker run -d --name redis -p 6379:6379 redis:7-alpine redis-server --requirepass ai-studio-redis

# 7. 重载 Nginx
nginx -s reload
```

## 五、Redis 集成方案

### 为什么需要 Redis

| 场景 | 当前实现 | Redis 改造后 |
|------|----------|-------------|
| 视频任务进度 | `api/data/videoTaskProgress.json` JSON 读写 | `HSET/HGET` 原子操作 |
| 用户会话 | `api/data/sessions/*.json` 文件存储 | `HSET key:session:userId` |
| API 限流 | 无 | `INCR + EXPIRE` 滑动窗口 |
| Agent 记忆 | `api/data/agent_memory.json` | `HSET + TTL` 自动过期 |
| 审核缓存 | 无 | `GET/SET key:review:hash` |

### Redis Key 设计

```
# 任务进度
video:task:{taskId}:progress    → HASH { status, progress, resultUrl }
video:task:{taskId}:expire      → EXPIRE 7200  (2小时)

# 用户会话
session:{userId}:messages        → LIST  (最近50条)
session:{userId}:context         → STRING (JSON)

# API 限流
ratelimit:{ip}:{endpoint}:minute → STRING (INCR + TTL 60s)

# Agent 自学习记忆
memory:pattern:{hash}            → HASH { action, params, hitCount }
memory:pattern:{hash}:expire     → EXPIRE 604800  (7天)

# 审核缓存
review:cache:{md5}               → STRING (JSON) + EXPIRE 3600
```

### 集成代码示例

```typescript
// api/services/redisClient.ts
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL || 'redis://:ai-studio-redis@localhost:6379',
});

redis.on('error', (err) => console.warn('Redis:', err));
await redis.connect();

// 替代 JSON 文件
export async function getTaskProgress(taskId: string) {
  const data = await redis.hGetAll(`video:task:${taskId}`);
  return Object.keys(data).length ? data : null;
}

export async function setTaskProgress(taskId: string, progress: any) {
  await redis.hSet(`video:task:${taskId}`, progress);
  await redis.expire(`video:task:${taskId}`, 7200);
}
```

### .env 追加

```env
REDIS_URL=redis://:ai-studio-redis@localhost:6379
```

## 六、Docker 架构图

```
┌──────────────────────────────────────────────┐
│                   Nginx :80                   │
│  / → dist/   /api → backend:3001             │
│  /images /uploads /videos → backend:3001     │
└──────────────────┬───────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
   ┌────▼────┐          ┌────▼────┐
   │ backend │          │  Redis  │
   │  :3001  │──────────│  :6379  │
   │ tsx+Exp │ 会话/缓存 │ 数据存储 │
   └────┬────┘          └─────────┘
        │ (API调用)
   ┌────▼────┐ (可选)
   │  ltx    │  GPU 模式
   │  :8000  │  --profile gpu
   └─────────┘
```

## 七、验证清单

- [ ] `curl http://120.26.240.66/api/health` → `{"success":true}`
- [ ] 浏览器打开 `http://120.26.240.66` → 前端页面正常
- [ ] 图片生成测试 → 成功
- [ ] 视频历史加载 → 正常
- [ ] Redis 连接 → `docker exec ai-studio-redis redis-cli -a ai-studio-redis ping`
