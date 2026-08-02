@echo off
chcp 65001 >nul
title LTX-Video 本地推理服务

echo ========================================
echo   LTX-Video 本地推理服务启动脚本
echo ========================================
echo.

REM 检查 Python 是否可用
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python，请先安装 Python 3.10+
    pause
    exit /b 1
)

REM 检查是否安装了必要依赖
echo [1/3] 检查依赖...
python -c "import fastapi" 2>nul
if %errorlevel% neq 0 (
    echo [警告] 未安装 fastapi，正在安装依赖...
    pip install -r requirements.txt
)

python -c "import ltx_video" 2>nul
if %errorlevel% neq 0 (
    echo [警告] 未安装 ltx_video
    echo 请先克隆并安装 LTX-Video:
    echo   git clone https://github.com/Lightricks/LTX-Video.git
    echo   cd LTX-Video ^&^& pip install -e .
    echo.
    echo 是否继续启动？（服务将启动但无法生成视频）按任意键继续...
    pause >nul
)

REM 检查 GPU
echo [2/3] 检查 GPU...
python -c "import torch; print(f'CUDA: {torch.cuda.is_available()}, GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"N/A\"}')"

echo.
echo [3/3] 启动服务...
echo 服务地址: http://localhost:8000
echo API 文档: http://localhost:8000/docs
echo 健康检查: http://localhost:8000/health
echo.
echo 按 Ctrl+C 停止服务
echo.

python server.py

pause
