$SERVER="120.26.240.66"
$USER="administrator"
$PASSWORD="huang123"
$APP_DIR="C:\ai-project"

echo "=========================================="
echo "  AI 作图项目 - Windows服务器部署脚本"
echo "=========================================="

echo ""
echo "1. 创建项目目录..."
ssh $USER@$SERVER "if not exist $APP_DIR mkdir $APP_DIR"
ssh $USER@$SERVER "if not exist $APP_DIR\api mkdir $APP_DIR\api"
ssh $USER@$SERVER "if not exist $APP_DIR\dist mkdir $APP_DIR\dist"
ssh $USER@$SERVER "if not exist $APP_DIR\api\public\images mkdir $APP_DIR\api\public\images"
ssh $USER@$SERVER "if not exist $APP_DIR\api\data mkdir $APP_DIR\api\data"

echo ""
echo "2. 上传后端文件..."
scp -r api/dist/* $USER@$SERVER:$APP_DIR/api/

echo ""
echo "3. 上传前端文件..."
scp -r dist/* $USER@$SERVER:$APP_DIR/dist/

echo ""
echo "4. 上传 package.json..."
scp api/package.json $USER@$SERVER:$APP_DIR/api/

echo ""
echo "5. ⚠️ 请手动上传 .env 文件到服务器 $APP_DIR/api/"
echo "   或通过 scp .env $USER@$SERVER:$APP_DIR/api/ 上传"
echo "   注意：.env 包含 API Key，请勿通过公网暴露"

echo ""
echo "6. 安装后端依赖..."
ssh $USER@$SERVER "cd $APP_DIR\api && npm install"

echo ""
echo "7. 配置 Nginx..."
$nginxConfig = @"
server {
    listen 80;
    server_name _;

    root C:/ai-project/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /images/ {
        proxy_pass http://localhost:3001/images/;
    }
}
"@

ssh $USER@$SERVER "[System.IO.File]::WriteAllText('C:\nginx\conf\conf.d\ai-project.conf', @'" + $nginxConfig + "@')"

echo ""
echo "8. 重启 Nginx..."
ssh $USER@$SERVER "C:\nginx\nginx.exe -s reload"

echo ""
echo "9. 启动后端服务..."
ssh $USER@$SERVER "cd $APP_DIR\api && node server.js"

echo ""
echo "=========================================="
echo "  部署完成！"
echo ""
echo "  前端地址: http://$SERVER"
echo "  后端地址: http://$SERVER:3001/api"
echo "=========================================="