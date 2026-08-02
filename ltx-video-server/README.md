# LTX-Video 本地推理微服务

## 简介

本服务为 AI创意工坊 项目提供本地视频生成能力，基于 [LTX-Video](https://github.com/Lightricks/LTX-Video) 开源模型。

与第三方 Agnes Video API 相比，LTX-Video 本地生成速度更快（5秒视频约20秒 vs 几分钟），但画质略低，适合快速试稿。

## 环境要求

- **Python**: 3.10.5+
- **GPU**: NVIDIA GPU，最低 6GB 显存（2B 蒸馏版），推荐 8GB+
- **CUDA**: 12.1+（FP8 量化需要 ADA 架构: RTX 40/50系）
- **磁盘**: 至少 20GB（模型权重 + 依赖）

## 安装步骤

### 1. 创建 Python 虚拟环境

```powershell
# 使用 conda（推荐）
conda create -n ltxv python=3.10.5 -y
conda activate ltxv

# 或使用 venv
python -m venv venv
.\venv\Scripts\activate
```

### 2. 安装 PyTorch

```powershell
# CUDA 12.1
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121

# CUDA 11.8
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

### 3. 克隆并安装 LTX-Video

```powershell
# 建议克隆到同级目录
cd ..
git clone https://github.com/Lightricks/LTX-Video.git
cd LTX-Video
pip install -e .
```

### 4. 下载模型权重（推荐手动下载）

```powershell
# 设置国内镜像加速
set HF_ENDPOINT=https://hf-mirror.com

# 下载 2B 蒸馏版（低显存推荐）
pip install -U huggingface_hub
huggingface-cli download Lightricks/LTX-Video ltxv-2b-0.9.6-distilled-04-25.safetensors --local-dir ./LTX-Video

# 或下载 13B 蒸馏 FP8 版（RTX 4090 推荐）
huggingface-cli download Lightricks/LTX-Video ltxv-13b-0.9.8-distilled-fp8.safetensors --local-dir ./LTX-Video
```

下载后将 `.safetensors` 文件放入 LTX-Video 仓库根目录。

### 5. 安装本服务依赖

```powershell
cd ltx-video-server
pip install -r requirements.txt
```

### 6. （可选）安装 FP8 量化支持

仅 ADA 架构 GPU（RTX 40/50系、H100）支持：

```powershell
pip install git+https://github.com/Lightricks/LTXVideo-Q8-Kernels
```

## 启动服务

### 方式一：批处理脚本

```powershell
.\start.bat
```

### 方式二：手动启动

```powershell
python server.py
```

### 方式三：uvicorn 直接启动

```powershell
python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

启动后访问：
- 健康检查: http://localhost:8000/health
- API 文档: http://localhost:8000/docs
- 可用模型: http://localhost:8000/models

## 配置

通过环境变量配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LTX_HOST` | `0.0.0.0` | 监听地址 |
| `LTX_PORT` | `8000` | 监听端口 |
| `LTX_OUTPUT_DIR` | `./outputs` | 视频输出目录 |
| `LTX_DEFAULT_MODEL` | `ltxv-2b-distilled` | 默认模型 |

## 可用模型

| 模型 ID | 最小显存 | 说明 |
|---------|----------|------|
| `ltxv-2b-distilled` | 6GB | 2B 蒸馏版，速度最快 |
| `ltxv-2b-dev` | 8GB | 2B 开发版，画质较好 |
| `ltxv-13b-distilled` | 10GB | 13B 蒸馏版，推荐 |
| `ltxv-13b-distilled-fp8` | 8GB | 13B 蒸馏 FP8，RTX 4090 推荐 |
| `ltxv-13b-dev` | 16GB | 13B 开发版，最高质量 |

## API 接口

### POST /generate - 提交生成任务

```json
{
  "prompt": "一只猫在弹钢琴，温暖的光线",
  "model": "ltxv-2b-distilled",
  "width": 768,
  "height": 512,
  "num_frames": 121,
  "frame_rate": 30,
  "seed": 171198
}
```

响应：
```json
{
  "task_id": "ltx_1719481600_abc123",
  "status": "processing",
  "message": "视频生成任务已创建"
}
```

### GET /status/{task_id} - 查询状态

```json
{
  "task_id": "ltx_1719481600_abc123",
  "status": "completed",
  "progress": 100,
  "video_path": "outputs/ltx_1719481600_abc123/video.mp4"
}
```

### GET /video/{task_id} - 下载视频

返回视频文件流。

## 注意事项

1. **首次运行**会自动下载 T5 text encoder（约 4GB），建议提前用 `HF_ENDPOINT=https://hf-mirror.com` 加速
2. **GPU 串行**: 服务使用 GPU 锁确保同一时间只执行一个生成任务，避免显存冲突
3. **任务过期**: 超过2小时的任务记录会自动清理
4. **模型选择**: 显存 <8GB 用 2B 蒸馏版；RTX 4090 用 13B 蒸馏 FP8 版效果最佳
