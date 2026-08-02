@echo off
chcp 65001 >nul
title AI Creative Studio - 全端启动

echo ============================================
echo   AI Creative Studio
echo   正在启动所有服务...
echo ============================================
echo.

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

REM ========== 0. 环境检测 ==========
echo [0/4] 检查运行环境...

REM 检测 Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   [错误] 未检测到 Node.js，请先安装 Node.js (https://nodejs.org)
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do echo   Node.js: %%i

REM 检测 node_modules
if not exist "%ROOT%\node_modules" (
    echo   [警告] node_modules 不存在，正在安装依赖...
    cd /d "%ROOT%"
    call npm install
    if %errorlevel% neq 0 (
        echo   [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo   依赖安装完成
) else (
    echo   依赖检查: OK
)

REM 检测 .env 文件
if not exist "%ROOT%\.env" (
    echo   [警告] .env 文件不存在，请复制 .env.example 并配置 API Key
) else (
    echo   .env 配置: OK
)

echo.

REM ========== 1. Express 后端 ==========
echo [1/4] 启动 Express 后端 (端口 3001)...
start "AI Backend" /MIN cmd /c "cd /d %ROOT% && npx tsx api/server.ts"
echo   后端启动中...

REM ========== 2. Vite 前端 ==========
echo [2/4] 启动 Vite 前端 (端口 5173)...
start "AI Frontend" /MIN cmd /c "cd /d %ROOT% && npx vite --host 0.0.0.0"
echo   前端启动中...

REM ========== 3. Python LTX（可选）==========
echo [3/4] 启动 Python LTX 视频服务 (端口 8000)...

REM 检测 Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo   [跳过] 未检测到 Python，LTX 本地推理服务不会启动
    echo   提示：如需使用 LTX 本地推理，请安装 Python 并配置 ltx-video-server
    goto skip_ltx
)

REM 检测 LTX 依赖
if not exist "%ROOT%\ltx-video-server\server.py" (
    echo   [跳过] ltx-video-server/server.py 不存在
    goto skip_ltx
)

REM 检测 uvicorn
python -c "import uvicorn" >nul 2>&1
if %errorlevel% neq 0 (
    echo   [跳过] Python uvicorn 未安装，请执行: pip install uvicorn fastapi
    goto skip_ltx
)

start "AI LTX" /MIN cmd /c "cd /d %ROOT%\ltx-video-server && python server.py"
echo   LTX 启动中...
goto end_ltx

:skip_ltx
echo   LTX 服务已跳过

:end_ltx

REM ========== 4. 等待启动 ==========
echo [4/4] 等待服务启动...
timeout /t 6 /nobreak >nul

REM 检测后端是否成功启动
echo.
echo ============================================
echo   启动状态检查
echo ============================================
curl -s http://localhost:3001/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] 后端:    http://localhost:3001/api/health
) else (
    echo   [等待] 后端启动中，请稍后检查...
)

curl -s http://localhost:5173 >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] 前端:    http://localhost:5173
) else (
    echo   [等待] 前端启动中，请稍后检查...
)

echo.
echo   关闭此窗口不会影响服务运行。
echo   (每个服务在独立窗口中运行)
echo.
echo   按任意键打开前端页面...
pause >nul
start http://localhost:5173
