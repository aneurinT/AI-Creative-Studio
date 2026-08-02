# AI 创意工坊 - 服务器部署操作手册

## 目录

1. [环境要求](#1-环境要求)
2. [服务器准备](#2-服务器准备)
3. [依赖安装](#3-依赖安装)
4. [部署步骤](#4-部署步骤)
5. [配置说明](#5-配置说明)
6. [启动服务](#6-启动服务)
7. [Nginx 反向代理配置](#7-nginx-反向代理配置)
8. [Systemd 服务配置](#8-systemd-服务配置)
9. [常见问题与解决方案](#9-常见问题与解决方案)
10. [安全建议](#10-安全建议)

---

## 1. 环境要求

| 项目 | 版本要求 | 说明 |
|------|---------|------|
| 操作系统 | Ubuntu 20.04+/CentOS 7+/Debian 10+ | 推荐 Ubuntu 22.04 LTS |
| Node.js | 18.x 或 20.x | LTS 版本 |
| npm | 8.x+ | 随 Node.js 安装 |
| 内存 | ≥ 2GB | 推荐 4GB+ |
| 磁盘 | ≥ 20GB 可用空间 | 存储上传文件和生成内容 |
| 网络 | 公网 IP，开放 80/443 端口 | 如需 HTTPS，需配置证书 |

---

## 2. 服务器准备

### 2.1 更新系统

```bash
# Ubuntu/Debian
sudo apt update && sudo apt upgrade -y

# CentOS/RHEL
sudo yum update -y
```

### 2.2 安装基础工具

```bash
# Ubuntu/Debian
sudo apt install -y wget curl git unzip build-essential

# CentOS/RHEL
sudo yum install -y wget curl git unzip gcc gcc-c++ make
```

---

## 3. 依赖安装

### 3.1 安装 Node.js (Ubuntu/Debian)

```bash
# 使用 NodeSource 安装 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node --version    # 应显示 v20.x.x
npm --version     # 应显示 8.x.x 或更高
```

### 3.2 安装 Node.js (CentOS/RHEL)

```bash
# 使用 NodeSource 安装 Node.js 20.x
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# 验证安装
node --version    # 应显示 v20.x.x
npm --version     # 应显示 8.x.x 或更高
```

### 3.3 安装 FFmpeg

```bash
# Ubuntu/Debian
sudo apt install -y ffmpeg

# CentOS/RHEL (需要 EPEL)
sudo yum install -y epel-release
sudo yum install -y ffmpeg

# 验证安装
ffmpeg -version   # 应显示 ffmpeg 版本信息
```

### 3.4 安装 ImageMagick (可选，用于图像处理)

```bash
# Ubuntu/Debian
sudo apt install -y imagemagick

# CentOS/RHEL
sudo yum install -y ImageMagick

# 验证安装
convert --version
```

---

## 4. 部署步骤

### 4.1 创建项目目录

```bash
# 创建应用目录
sudo mkdir -p /var/www/ai-creative-studio

# 设置权限
sudo chown -R $USER:$USER /var/www/ai-creative-studio
```

### 4.2 上传部署包

将本地的 `server-deploy/` 目录上传到服务器：

```bash
# 方法一：使用 scp (推荐)
scp -r /本地路径/server-deploy/* username@your-server-ip:/var/www/ai-creative-studio/

# 方法二：使用 rsync
rsync -avz /本地路径/server-deploy/ username@your-server-ip:/var/www/ai-creative-studio/

# 方法三：使用 git (如果代码在仓库中)
cd /var/www/ai-creative-studio
git clone https://your-repo-url.git .
```

### 4.3 进入项目目录

```bash
cd /var/www/ai-creative-studio
```

### 4.4 安装 npm 依赖

```bash
# 使用 npm 安装依赖 (推荐使用 --legacy-peer-deps 避免版本冲突)
npm install --legacy-peer-deps

# 或使用 yarn (如果已安装)
# yarn install
```

> **注意**：安装过程可能需要几分钟，请耐心等待。如果遇到网络问题，可以考虑使用国内镜像。

### 4.5 安装国内镜像（可选）

```bash
# 使用淘宝 npm 镜像
npm config set registry https://registry.npmmirror.com/

# 或使用华为镜像
# npm config set registry https://mirrors.huaweicloud.com/repository/npm/

# 安装依赖
npm install --legacy-peer-deps
```

---

## 5. 配置说明

### 5.1 环境变量配置

编辑 `.env` 文件，配置必要的 API 密钥和参数：

```bash
nano .env
```

配置内容：

```bash
# 服务器配置
PORT=3000
HOST=0.0.0.0

# API 密钥配置 (根据需要配置)
OPENAI_API_KEY=your-openai-api-key
IMAGE_API_KEY=your-image-api-key
VIDEO_API_KEY=your-video-api-key

# 数据库配置 (当前使用文件存储，无需配置)
DB_TYPE=file

# 文件存储配置
UPLOAD_DIR=./api/public/uploads
MAX_FILE_SIZE=52428800

# 其他配置
NODE_ENV=production
LOG_LEVEL=info
```

### 5.2 端口配置

默认端口为 `3000`，如需修改，修改 `.env` 文件中的 `PORT` 字段。

---

## 6. 启动服务

### 6.1 开发模式启动（用于测试）

```bash
cd /var/www/ai-creative-studio
npm run dev
```

启动后访问：`http://服务器IP:3000`

### 6.2 生产模式启动（使用 PM2）

#### 安装 PM2

```bash
npm install -g pm2
```

#### 启动应用

```bash
cd /var/www/ai-creative-studio
pm2 start server.js --name ai-creative-studio
```

#### PM2 常用命令

```bash
# 查看进程状态
pm2 status

# 查看日志
pm2 logs ai-creative-studio

# 重启应用
pm2 restart ai-creative-studio

# 停止应用
pm2 stop ai-creative-studio

# 删除应用
pm2 delete ai-creative-studio

# 设置开机自启
pm2 startup
pm2 save
```

### 6.3 验证服务

```bash
# 检查服务是否正常运行
curl http://localhost:3000

# 检查 API 是否正常
curl http://localhost:3000/api/agents/health
```

---

## 7. Nginx 反向代理配置

### 7.1 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt install -y nginx

# CentOS/RHEL
sudo yum install -y nginx

# 启动 Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 7.2 配置反向代理

创建配置文件：

```bash
sudo nano /etc/nginx/sites-available/ai-creative-studio
```

配置内容：

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # 前端静态文件
    location / {
        root /var/www/ai-creative-studio/dist;
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api/ {
        proxy_pass http://localhost:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 支持 (如需)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 上传文件大小限制
    client_max_body_size 50M;
}
```

### 7.3 启用配置并重启 Nginx

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/ai-creative-studio /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
```

### 7.4 配置 HTTPS (使用 Let's Encrypt)

```bash
# 安装 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# 自动更新证书
sudo certbot renew --dry-run
```

---

## 8. Systemd 服务配置

### 8.1 创建 Systemd 服务文件

```bash
sudo nano /etc/systemd/system/ai-creative-studio.service
```

配置内容：

```ini
[Unit]
Description=AI Creative Studio Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/ai-creative-studio
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 8.2 启用并启动服务

```bash
# 重新加载 systemd
sudo systemctl daemon-reload

# 启动服务
sudo systemctl start ai-creative-studio

# 设置开机自启
sudo systemctl enable ai-creative-studio

# 查看服务状态
sudo systemctl status ai-creative-studio

# 查看日志
sudo journalctl -u ai-creative-studio -f
```

---

## 9. 常见问题与解决方案

### 9.1 端口被占用

```bash
# 查看端口占用
sudo lsof -i :3000

# 杀死占用进程
sudo kill -9 <PID>

# 或修改端口
nano .env
# 修改 PORT=3001
```

### 9.2 npm 安装失败

**问题**：依赖安装超时或失败

**解决方案**：

```bash
# 使用国内镜像
npm config set registry https://registry.npmmirror.com/

# 清理缓存
npm cache clean --force

# 重新安装
npm install --legacy-peer-deps
```

### 9.3 服务启动失败

**问题**：服务无法启动或崩溃

**解决方案**：

```bash
# 查看详细日志
pm2 logs ai-creative-studio --lines 100

# 或
sudo journalctl -u ai-creative-studio -f

# 常见原因：
# 1. Node.js 版本不兼容 → 升级到 Node.js 18+
# 2. 依赖缺失 → 重新运行 npm install
# 3. 端口被占用 → 修改端口
# 4. 权限问题 → 检查目录权限
```

### 9.4 上传文件失败

**问题**：上传图片或视频时失败

**解决方案**：

```bash
# 检查上传目录权限
sudo chown -R www-data:www-data /var/www/ai-creative-studio/api/public/uploads

# 检查文件大小限制
# 1. 修改 Nginx 配置中的 client_max_body_size
# 2. 修改 server.js 中的 express.json 和 express.urlencoded 的 limit 参数
```

### 9.5 FFmpeg 相关错误

**问题**：视频处理时出现 FFmpeg 错误

**解决方案**：

```bash
# 确认 FFmpeg 已安装
ffmpeg -version

# 如果未安装，重新安装
sudo apt install -y ffmpeg
```

### 9.6 内存不足

**问题**：服务因内存不足崩溃

**解决方案**：

```bash
# 查看内存使用
free -h

# 增加交换空间 (临时解决)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 永久生效
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 10. 安全建议

### 10.1 防火墙配置

```bash
# 开放必要端口
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp    # SSH

# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status
```

### 10.2 禁用 root 登录

```bash
sudo nano /etc/ssh/sshd_config

# 修改以下配置
PermitRootLogin no
PasswordAuthentication no

# 重启 SSH
sudo systemctl restart sshd
```

### 10.3 定期更新系统

```bash
# 设置自动更新 (Ubuntu)
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

### 10.4 备份数据

```bash
# 备份上传文件和数据库
sudo tar -czvf backup-$(date +%Y%m%d).tar.gz /var/www/ai-creative-studio/api/public/uploads /var/www/ai-creative-studio/api/data
```

---

## 附录：文件结构说明

```
/var/www/ai-creative-studio/
├── api/                    # 后端 API 目录
│   ├── dist/              # 编译后的 API 代码
│   │   ├── routes/        # 路由文件
│   │   ├── services/      # 服务层
│   │   ├── app.js         # Express 应用入口
│   │   └── server.js      # 独立服务器入口
│   ├── public/            # 静态资源目录
│   │   └── uploads/       # 上传文件存储
│   └── package.json       # API 依赖配置
├── dist/                  # 前端静态文件
│   ├── index.html         # 主页面
│   ├── favicon.svg        # 网站图标
│   └── assets/            # 编译后的资源文件
├── .env                   # 环境变量配置
├── package.json           # 项目依赖配置
├── server.js              # 统一入口 (前端+后端)
└── start-server.bat       # Windows 启动脚本
```

---

## 联系方式

如有问题，请联系开发团队。