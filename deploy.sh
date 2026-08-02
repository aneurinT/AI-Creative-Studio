#!/bin/bash

echo "=========================================="
echo "  AI 作图项目 - 阿里云部署脚本"
echo "=========================================="

APP_DIR="/opt/ai-project"
FRONTEND_DIR="$APP_DIR/dist"
BACKEND_DIR="$APP_DIR/api"

echo ""
echo "1. 安装 Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo ""
echo "2. 安装 pnpm..."
npm install -g pnpm

echo ""
echo "3. 安装 Nginx..."
apt-get install -y nginx

echo ""
echo "4. 创建项目目录..."
mkdir -p $APP_DIR
mkdir -p $FRONTEND_DIR
mkdir -p $BACKEND_DIR

echo ""
echo "5. 解压前端文件..."
unzip -o dist.zip -d $FRONTEND_DIR

echo ""
echo "6. 解压后端文件..."
unzip -o api-dist.zip -d $BACKEND_DIR

echo ""
echo "7. 复制环境配置..."
cp .env $BACKEND_DIR/.env

echo ""
echo "8. 安装后端依赖..."
cd $BACKEND_DIR
pnpm install

echo ""
echo "9. 配置 Nginx..."
cat > /etc/nginx/sites-available/ai-project << 'EOF'
server {
    listen 80;
    server_name _;

    root /opt/ai-project/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /images/ {
        proxy_pass http://localhost:3001/images/;
    }
}
EOF

ln -sf /etc/nginx/sites-available/ai-project /etc/nginx/sites-enabled/

echo ""
echo "10. 配置 systemd 服务..."
cat > /etc/systemd/system/ai-project-api.service << 'EOF'
[Unit]
Description=AI Project API Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/ai-project/api
ExecStart=/usr/bin/node --experimental-vm-modules server.js
Restart=always
User=root
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

echo ""
echo "11. 启动服务..."
systemctl daemon-reload
systemctl enable ai-project-api
systemctl start ai-project-api

echo ""
echo "12. 启动 Nginx..."
systemctl restart nginx

echo ""
echo "=========================================="
echo "  部署完成！"
echo ""
echo "  前端地址: http://localhost"
echo "  后端地址: http://localhost:3001/api"
echo ""
echo "  日志查看:"
echo "    tail -f /var/log/nginx/access.log"
echo "    journalctl -u ai-project-api -f"
echo "=========================================="
