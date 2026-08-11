#!/bin/bash
set -e

echo "============================================"
echo "  AI Creative Studio - Docker 部署"
echo "============================================"
echo ""

# 检测 Docker
if ! command -v docker &> /dev/null; then
    echo "[错误] 未检测到 Docker，请先安装 Docker"
    echo "Linux: curl -fsSL https://get.docker.com | sh"
    echo "Mac: https://www.docker.com/products/docker-desktop"
    exit 1
fi
echo "Docker: $(docker --version)"

# 检测 docker compose
if ! docker compose version &> /dev/null; then
    echo "[错误] 未检测到 docker compose 插件"
    exit 1
fi
echo ""

# 检测 .env
if [ ! -f .env ]; then
    echo "[错误] .env 文件不存在！"
    echo "请复制 .env.example 为 .env 并配置 API Key 后重试"
    exit 1
fi
echo "[OK] .env 配置文件存在"
echo ""

echo "============================================"
echo "  选择部署模式"
echo "============================================"
echo "  [1] 基础模式（后端 + 前端 Nginx）"
echo "  [2] GPU 模式（含 LTX 本地推理，需 NVIDIA GPU）"
echo "  [3] 停止并清理所有容器"
echo "  [4] 查看运行状态"
echo "  [5] 查看日志"
echo "  [0] 退出"
echo ""
read -p "请选择 [1-5]: " choice

case $choice in
    1)
        echo ""
        echo "[部署] 基础模式：构建并启动..."
        docker compose up -d --build
        echo ""
        echo "============================================"
        echo "  部署成功！"
        echo "============================================"
        echo "  访问地址: http://localhost"
        echo "  API健康:  http://localhost:3001/api/health"
        echo ""
        echo "  管理命令:"
        echo "    docker compose ps        查看状态"
        echo "    docker compose logs -f   查看日志"
        echo "    docker compose down      停止服务"
        ;;
    2)
        echo ""
        echo "[部署] GPU 模式：构建并启动（含 LTX 本地推理）..."
        docker compose --profile gpu up -d --build
        echo ""
        echo "============================================"
        echo "  部署成功！（GPU 模式）"
        echo "============================================"
        echo "  访问地址: http://localhost"
        echo "  LTX API:  http://localhost:8000"
        ;;
    3)
        echo ""
        echo "[停止] 停止所有容器并清理..."
        docker compose --profile gpu down -v
        echo "已停止并清理"
        ;;
    4)
        docker compose ps
        ;;
    5)
        echo ""
        echo "按 Ctrl+C 停止查看日志"
        docker compose logs -f --tail 50
        ;;
    0)
        echo "退出"
        exit 0
        ;;
    *)
        echo "无效选择，退出..."
        exit 1
        ;;
esac
