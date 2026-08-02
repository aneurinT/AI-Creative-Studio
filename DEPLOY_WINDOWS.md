# Windows 服务器部署指南

> 服务器 IP: 120.26.240.66  
> 环境: Windows Server

## 零、服务器前置准备

```powershell
# 1. 安装 Node.js 22+
winget install OpenJS.NodeJS.LTS

# 2. 安装 pnpm
npm install -g pnpm

# 3. 安装 Docker Desktop (可选，推荐)
winget install Docker.DockerDesktop

# 4. 安装 Nginx for Windows
# 下载 http://nginx.org/download/nginx-1.26.2.zip
# 解压到 C:\nginx

# 5. 安装 Git (用于版本管理)
winget install Git.Git
```

## 一、上传项目（本地执行）

```powershell
# 打包项目（排除 node_modules 和大文件）
Remove-Item ai-project.zip -ErrorAction SilentlyContinue
Compress-Archive -Path (
  "api", "src", "dist", "public", "data",
  ".env", "package.json", "pnpm-lock.yaml",
  "vite.config.ts", "tsconfig.json", "index.html",
  "postcss.config.js", "tailwind.config.js",
  "nodemon.json", "hermes.toml",
  "docker-compose.yml", "Dockerfile.backend",
  "nginx.docker.conf", "nginx.conf", "redis.conf",
  "DEPLOYMENT.md", "DEPLOY_WINDOWS.md"
) -DestinationPath ai-project.zip -Force

# 上传到服务器
scp ai-project.zip administrator@120.26.240.66:C:\temp\
```

## 二、服务器端解压安装

```powershell
# SSH 登录服务器后
cd C:\
Expand-Archive -Force C:\temp\ai-project.zip C:\ai-project
cd C:\ai-project

# 安装依赖
pnpm install

# 构建前端
pnpm run build

# 创建数据目录
New-Item -ItemType Directory -Force -Path api\data,api\public\images,api\public\uploads,api\public\videos,api\data\temp_videos
```

## 三、启动服务（三选一）

### 方案 A: Docker Compose（推荐）

```powershell
cd C:\ai-project
docker-compose up -d

# 查看日志
docker-compose logs -f backend

# 停止
docker-compose down
```

### 方案 B: PM2 进程守护

```powershell
npm install -g pm2

# 启动后端
pm2 start api/server.ts --name ai-backend --interpreter tsx --node-args="--import tsx/esm"

# 启动 Nginx
C:\nginx\nginx.exe

# 保存进程列表
pm2 save
pm2 startup
```

### 方案 C: NSSM 服务注册（开机自启）

```powershell
# 下载 nssm.exe https://nssm.cc/download
nssm install ai-backend "C:\Program Files\nodejs\node.exe" "C:\ai-project\node_modules\.bin\tsx" "C:\ai-project\api\server.ts"
nssm set ai-backend AppDirectory "C:\ai-project"
nssm start ai-backend
```

## 四、Nginx Windows 配置

```powershell
# 复制配置
Copy-Item nginx.conf C:\nginx\conf\nginx.conf

# 创建前端目录软链接（或直接复制）
New-Item -ItemType Junction -Path C:\nginx\html\dist -Target C:\ai-project\dist

# 启动 Nginx
C:\nginx\nginx.exe

# 重载配置
C:\nginx\nginx.exe -s reload
```

`nginx.conf` 内容：

```nginx
worker_processes auto;
events { worker_connections 1024; }

http {
    include mime.types;
    client_max_body_size 100M;

    server {
        listen 80;
        server_name _;

        location / {
            root C:/ai-project/dist;
            index index.html;
            try_files $uri $uri/ /index.html;
        }

        location /api/ {
            proxy_pass http://localhost:3001;
            proxy_set_header Host $host;
            proxy_read_timeout 600s;
        }

        location /images/ { proxy_pass http://localhost:3001; }
        location /uploads/ { proxy_pass http://localhost:3001; }
        location /videos/ { proxy_pass http://localhost:3001; }
    }
}
```

## 五、Windows 防火墙开放端口

```powershell
New-NetFirewallRule -Name "HTTP" -DisplayName "HTTP 80" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 80
New-NetFirewallRule -Name "API" -DisplayName "API 3001" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 3001
New-NetFirewallRule -Name "Redis" -DisplayName "Redis 6379" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 6379
```

## 六、Redis Windows 安装

```powershell
# 方式1: Docker（推荐）
docker run -d --name redis -p 6379:6379 redis:7-alpine redis-server --requirepass ai-studio-redis

# 方式2: Memurai (Windows 原生 Redis 替代)
# 下载 https://www.memurai.com/
# 或下载 Redis for Windows: https://github.com/tporadowski/redis/releases

# 方式3: WSL
wsl --install
wsl -d Ubuntu
sudo apt install redis-server
```

## 七、验证部署

```powershell
# 本地测试
curl http://localhost:3001/api/health

# 外网测试
curl http://120.26.240.66/api/health

# 前端测试
Start-Process http://120.26.240.66
```

## 八、日常运维命令

```powershell
# 查看后端日志
Get-Content C:\ai-project\api\logs.txt -Tail 50

# 重启后端 (PM2)
pm2 restart ai-backend

# 重启后端 (NSSM)
nssm restart ai-backend

# 重载 Nginx
C:\nginx\nginx.exe -s reload

# 更新代码
cd C:\ai-project
git pull
pnpm run build
pm2 restart ai-backend
```
