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
for /f "tokens=*" %%i in ('node --version') do echo   Node.js: %%i

echo.

REM ===== 1. 安装依赖 =====
echo [1/4] 检查依赖...
if not exist "%ROOT%\node_modules" (
    echo   正在安装依赖...
    cd /d "%ROOT%"
    call npm install
    if %errorlevel% neq 0 (
        echo   [错误] 依赖安装失败
        pause
        exit /b 1
    )
)
echo   依赖检查: OK
echo.

REM ===== 2. 启动后端 (PM2守护) =====
echo [2/4] 启动后端 (端口 3001)...

REM 检查 PM2
call pm2 --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   首次使用，安装 PM2...
    call npm install -g pm2
    if %errorlevel% neq 0 (
        echo   [错误] PM2 安装失败，请手动安装: npm install -g pm2
        pause
        exit /b 1
    )
)

REM 停止旧实例
call pm2 delete ai-backend 2>nul

REM 启动（PM2 守护 + 崩溃自动重启）
call pm2 start "%ROOT%/api/server.ts" ^
    --name ai-backend ^
    --interpreter node ^
    --node-args "--import tsx/esm" ^
    --cwd "%ROOT%" ^
    --max-memory-restart 2G ^
    --restart-delay 5000

echo   后端 PM2 已注册

REM ===== 3. 设置 PM2 开机自启 =====
echo [3/4] 配置开机自启...
call pm2 save
echo   PM2 配置已保存 (如需开机自启请手动执行: pm2 startup)
echo.

REM ===== 4. Nginx =====
echo [4/4] 启动 Nginx (端口 80)...

if exist "C:\nginx\nginx.exe" (
    REM 复制配置
    copy /Y "%ROOT%\nginx.win.conf" "C:\nginx\conf\nginx.conf" >nul

    REM 检查 Nginx 是否已在运行
    tasklist /FI "IMAGENAME eq nginx.exe" 2>nul | find /I "nginx.exe" >nul
    if %errorlevel% equ 0 (
        C:\nginx\nginx.exe -s reload
        echo   Nginx 已重载
    ) else (
        start "" /MIN C:\nginx\nginx.exe
        echo   Nginx 已启动
    )
) else (
    echo   [跳过] 未找到 C:\nginx\nginx.exe
    echo   下载: http://nginx.org/download/nginx-1.26.2.zip
    echo   解压到: C:\nginx\
    echo   提示：无 Nginx 时可通过端口 3001 直接访问 API
)

echo.
echo ============================================
echo   服务器启动完成!
echo ============================================
echo.
echo   本地访问: http://localhost:3001/api/health
echo.
echo   管理命令:
echo     查看日志:  pm2 logs ai-backend
echo     重启后端:  pm2 restart ai-backend
echo     停止后端:  pm2 stop ai-backend
echo     PM2面板:   pm2 monit
echo     停止全部:  服务器停止.bat
echo.
pause
