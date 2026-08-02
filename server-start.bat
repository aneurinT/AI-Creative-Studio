@echo off
chcp 65001 >nul
title AI Studio - 启动

set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"

echo === AI Studio 启动 ===
echo.

REM 启动 Nginx
taskkill /F /IM nginx.exe >nul 2>&1
start "" /MIN C:\nginx\nginx.exe
echo Nginx :80    [OK]

REM 启动后端 (后台窗口)
start "AI Backend" /MIN cmd /c "cd /d %APP_DIR% && npx tsx api/server.ts"
echo Backend :3001 [OK]

echo.
echo 服务已启动: http://localhost
echo 健康检查:   http://localhost:3001/api/health
echo.
echo 关闭此窗口不会影响服务运行。
echo.
pause
