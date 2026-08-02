# AI Studio 部署到 Windows 服务器
param(
    [string]$ServerIP = "120.26.240.66",
    [string]$User = "administrator",
    [string]$ServerPath = "C:\ai-project"
)

Write-Host "=== AI Studio 部署脚本 ===" -ForegroundColor Cyan
Write-Host "目标: $User@$ServerIP → $ServerPath`n"

# 1. 构建前端
Write-Host "[1/5] 构建前端..." -ForegroundColor Yellow
npx vite build
if ($LASTEXITCODE -ne 0) { Write-Host "构建失败!" -ForegroundColor Red; exit 1 }

# 2. 打包项目
Write-Host "[2/5] 打包项目..." -ForegroundColor Yellow
$zipFile = "deploy-$((Get-Date).ToString('yyyyMMddHHmm')).zip"
Compress-Archive -Force -Path @(
    "api", "src", "dist", "public",
    "package.json", "pnpm-lock.yaml",
    "vite.config.ts", "tsconfig.json", "index.html",
    "postcss.config.js", "tailwind.config.js",
    "nginx.win.conf",
    "启动项目.bat", "服务器启动.bat", "服务器停止.bat", "停止项目.bat"
) -DestinationPath $zipFile
# 注意：.env 不打包，需要在服务器手动配置
Write-Host "  打包完成: $zipFile ($([math]::Round((Get-Item $zipFile).Length/1MB,1)) MB)"
Write-Host "  ⚠️ .env 文件未打包，请确保服务器上已配置 API Key"

# 3. 上传
Write-Host "[3/5] 上传到服务器..." -ForegroundColor Yellow
scp $zipFile "$User@$ServerIP`:$ServerPath\"
Write-Host "  上传完成"

# 4. 服务器解压安装
Write-Host "[4/5] 服务器安装..." -ForegroundColor Yellow
ssh "$User@$ServerIP" @"
cd $ServerPath
Expand-Archive -Force $zipFile -DestinationPath .
pnpm install
New-Item -ItemType Directory -Force -Path api\data,api\public\images,api\public\uploads,api\public\videos,api\data\temp_videos | Out-Null
echo "Install OK"
"@
Write-Host "  安装完成"

# 5. 启动服务
Write-Host "[5/5] 启动服务..." -ForegroundColor Yellow
ssh "$User@$ServerIP" @"
cd $ServerPath
# 停止旧进程
taskkill /F /FI "WINDOWTITLE eq ai-backend" 2>nul
# 复制 Nginx 配置
copy /Y nginx.win.conf C:\nginx\conf\nginx.conf
# 启动后端 (PM2)
npx pm2 start api/server.ts --name ai-backend --interpreter C:\Users\$env:USERNAME\AppData\Local\pnpm\tsx --node-args "--import tsx/esm" 2>nul || npx tsx api/server.ts
# 重载 Nginx
C:\nginx\nginx.exe -s reload 2>nul || C:\nginx\nginx.exe
echo "Services started"
"@

Write-Host "`n=== 部署完成! ===" -ForegroundColor Green
Write-Host "前端: http://$ServerIP"
Write-Host "健康检查: http://$ServerIP/api/health"
