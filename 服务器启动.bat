@echo off
chcp 65001 >nul
title AI Studio Server - 启动

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

echo ============================================
echo   AI Creative Studio - 服务器启动
echo ============================================
echo.

REM 检查 Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 ( echo [错误] 请先安装 Node.js && pause && exit /b 1 )

REM ===== 1. 启动后端 (PM2守护) =====
echo [1/4] 启动后端 (端口 3001)...

REM 检查 PM2
call pm2 --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   首次使用，安装 PM2...
    call npm install -g pm2
)

REM 停止旧实例
call pm2 delete ai-backend 2>nul

REM 启动（PM2 守护 + 开机自启 + 崩溃自动重启）
call pm2 start "%ROOT%/api/server.ts" ^
    --name ai-backend ^
    --interpreter node ^
    --node-args "--import tsx/esm" ^
    --cwd "%ROOT%" ^
    --max-memory-restart 2G ^
    --restart-delay 5000

echo   后端 PM2 已注册

REM ===== 2. 设置 PM2 开机自启 =====
echo [2/4] 配置开机自启...
call pm2 save
call pm2 startup | findstr "Administrator" >nul 2>&1
if %errorlevel% equ 0 (
    echo   已复制开机启动命令，请手动执行
    echo   ----------------------------------------
    call pm2 startup
    echo   ----------------------------------------
)
echo   PM2 开机自启已配置

REM ===== 3. Nginx =====
echo [3/4] 启动 Nginx (端口 80)...

if not exist C:\nginx\nginx.exe (
    echo   [错误] 未找到 C:\nginx\nginx.exe，请先安装 Nginx
    echo   下载: http://nginx.org/download/nginx-1.26.2.zip
    echo   解压到: C:\nginx\
    pause
    exit /b 1
)

REM 复制配置
copy /Y "%ROOT%\nginx.win.conf" "C:\nginx\conf\nginx.conf" >nul

REM 重载或启动
tasklist /FI "IMAGENAME eq nginx.exe" 2>nul | find /I "nginx.exe" >nul
if %errorlevel% equ 0 (
    C:\nginx\nginx.exe -s reload
    echo   Nginx 已重载
) else (
    start "" /MIN C:\nginx\nginx.exe
    echo   Nginx 已启动
)

REM ===== 4. 防火墙 =====
echo [4/4] 配置防火墙...
netsh advfirewall firewall add rule name="HTTP_80" dir=in action=allow protocol=TCP localport=80 >nul 2>&1
netsh advfirewall firewall add rule name="API_3001" dir=in action=allow protocol=TCP localport=3001 >nul 2>&1
echo   防火墙已配置

echo.
echo ============================================
echo   服务器启动完成!
echo ============================================
echo.
echo   外网访问: http://你的服务器IP
echo   API健康:  http://你的服务器IP:3001/api/health
echo.
echo   管理命令:
echo     查看日志:  pm2 logs ai-backend
echo     重启后端:  pm2 restart ai-backend
echo     停止后端:  pm2 stop ai-backend
echo     PM2面板:   pm2 monit
echo.
pause
