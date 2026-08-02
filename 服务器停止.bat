@echo off
chcp 65001 >nul
title AI Studio Server - 停止

echo 正在停止所有服务...

REM PM2 停止后端
call pm2 stop ai-backend 2>nul && echo 后端已停止

REM 停止 Nginx
taskkill /F /IM nginx.exe >nul 2>&1 && echo Nginx 已停止

echo.
echo 全部已停止。
pause
