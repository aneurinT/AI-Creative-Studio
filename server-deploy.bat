@echo off
chcp 65001 >nul
title AI Studio 一键部署

echo ============================================
echo   AI Creative Studio - 一键部署
echo ============================================
echo.

REM 检查管理员权限
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 请右键以管理员身份运行!
    pause
    exit /b 1
)

set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"

echo [1/6] 检查 Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 请先安装 Node.js: https://nodejs.org/
    pause
    exit /b 1
)
echo   Node.js OK

echo [2/6] 安装依赖...
call pnpm install 2>nul || call npm install
echo   依赖安装完成

echo [3/6] 创建数据目录...
mkdir "%APP_DIR%\api\data" 2>nul
mkdir "%APP_DIR%\api\public\images" 2>nul
mkdir "%APP_DIR%\api\public\uploads" 2>nul
mkdir "%APP_DIR%\api\public\videos" 2>nul
mkdir "%APP_DIR%\api\data\temp_videos" 2>nul
echo   目录创建完成

echo [4/6] 构建前端...
call npx vite build
echo   前端构建完成

echo [5/6] 防火墙开放端口...
netsh advfirewall firewall add rule name="HTTP_80" dir=in action=allow protocol=TCP localport=80 >nul 2>&1
netsh advfirewall firewall add rule name="API_3001" dir=in action=allow protocol=TCP localport=3001 >nul 2>&1
echo   防火墙配置完成

echo [6/6] 安装并配置 Nginx...
if not exist C:\nginx (
    echo   下载 Nginx...
    powershell -Command "Invoke-WebRequest -Uri http://nginx.org/download/nginx-1.26.2.zip -OutFile C:\temp\nginx.zip"
    powershell -Command "Expand-Archive -Force C:\temp\nginx.zip -DestinationPath C:\"
    move C:\nginx-1.26.2 C:\nginx
)

REM 复制 Nginx 配置
copy /Y "%APP_DIR%\nginx.win.conf" "C:\nginx\conf\nginx.conf"

REM 启动 Nginx
taskkill /F /IM nginx.exe >nul 2>&1
start "" C:\nginx\nginx.exe
echo   Nginx 已启动

echo.
echo ============================================
echo   部署完成!
echo ============================================
echo.
echo   前端地址: http://localhost
echo   API:      http://localhost:3001/api/health
echo.
echo   启动后端: npx tsx %APP_DIR%\api\server.ts
echo   或后台运行: pm2 start %APP_DIR%\api\server.ts --name ai-backend
echo.
echo   查看日志: pm2 logs ai-backend
echo   重启后端: pm2 restart ai-backend
echo.
pause
