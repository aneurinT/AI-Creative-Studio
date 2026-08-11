@echo off
chcp 65001 >nul
title AI Creative Studio - Docker 一键部署

echo ============================================
echo   AI Creative Studio - Docker 部署
echo ============================================
echo.

REM 检测 Docker
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Docker，请先安装 Docker Desktop
    echo 下载: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('docker --version') do echo Docker: %%i

REM 检测 docker-compose
docker compose version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 docker compose 插件
    echo 请升级 Docker Desktop 到最新版
    pause
    exit /b 1
)
echo.

REM 检测 .env
if not exist .env (
    echo [错误] .env 文件不存在！
    echo 请复制 .env.example 为 .env 并配置 API Key 后重试
    pause
    exit /b 1
)
echo [OK] .env 配置文件存在

echo.
echo ============================================
echo   选择部署模式
echo ============================================
echo   [1] 基础模式（后端 + 前端 Nginx）
echo   [2] GPU 模式（含 LTX 本地推理，需 NVIDIA GPU）
echo   [3] 停止并清理所有容器
echo   [4] 查看运行状态
echo   [5] 查看日志
echo   [0] 退出
echo.
set /p choice="请选择 [1-5]: "

if "%choice%"=="1" goto deploy_basic
if "%choice%"=="2" goto deploy_gpu
if "%choice%"=="3" goto stop_clean
if "%choice%"=="4" goto show_status
if "%choice%"=="5" goto show_logs
if "%choice%"=="0" goto end
echo 无效选择，退出...
goto end

:deploy_basic
echo.
echo [部署] 基础模式：构建并启动...
docker compose up -d --build
if %errorlevel% neq 0 (
    echo [错误] 部署失败，请检查日志
    pause
    exit /b 1
)
echo.
echo ============================================
echo   部署成功！
echo ============================================
echo   访问地址: http://localhost
echo   API健康:  http://localhost:3001/api/health
echo.
echo   管理命令:
echo     查看状态: docker compose ps
echo     查看日志: docker compose logs -f
echo     停止服务: docker compose down
echo.
goto end

:deploy_gpu
echo.
echo [部署] GPU 模式：构建并启动（含 LTX 本地推理）...
docker compose --profile gpu up -d --build
if %errorlevel% neq 0 (
    echo [错误] 部署失败，请检查日志
    pause
    exit /b 1
)
echo.
echo ============================================
echo   部署成功！（GPU 模式）
echo ============================================
echo   访问地址: http://localhost
echo   LTX API:  http://localhost:8000
echo.
goto end

:stop_clean
echo.
echo [停止] 停止所有容器并清理...
docker compose --profile gpu down -v
echo 已停止并清理
goto end

:show_status
echo.
docker compose ps
goto end

:show_logs
echo.
echo 按 Ctrl+C 停止查看日志
docker compose logs -f --tail 50
goto end

:end
pause
