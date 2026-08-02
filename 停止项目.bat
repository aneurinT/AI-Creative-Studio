@echo off
chcp 65001 >nul
title AI Creative Studio - 停止所有服务

echo ============================================
echo   正在停止所有服务...
echo ============================================
echo.

echo [1/3] 停止 Express 后端 (端口 3001)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1 && echo   已停止 PID %%a
)

echo [2/3] 停止 Vite 前端 (端口 5173)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1 && echo   已停止 PID %%a
)

echo [3/3] 停止 Python LTX (端口 8000)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1 && echo   已停止 PID %%a
)

echo.
echo ============================================
echo   全部已停止
echo ============================================
echo.
pause
