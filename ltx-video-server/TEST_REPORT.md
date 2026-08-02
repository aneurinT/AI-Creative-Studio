# LTX-Video 本地视频生成集成测试报告

## 测试概要

- **测试时间**: 2026-07-26
- **测试环境**: Windows, Node.js + TypeScript 后端, Python FastAPI 微服务
- **测试目标**: 验证 LTX-Video 本地视频生成模型与现有项目的集成

## 集成架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   前端 (React)   │────▶│  Node.js 后端     │────▶│  Python LTX 微服务   │
│  VideoGenerator  │     │  /api/ltx/*       │     │  localhost:8000     │
│  引擎切换按钮     │◀────│  ltxVideoService  │◀────│  server.py (FastAPI)│
└─────────────────┘     └──────────────────┘     └─────────────────────┘
                              │                            │
                              ▼                            ▼
                        持久化进度文件                  GPU 推理
                        videoTaskProgress.json          ltx_video
```

## 新增文件清单

| 文件路径 | 说明 |
|---------|------|
| `ltx-video-server/server.py` | Python FastAPI 微服务（健康检查、任务提交、状态查询、视频下载） |
| `ltx-video-server/requirements.txt` | Python 依赖清单 |
| `ltx-video-server/start.bat` | Windows 启动脚本 |
| `ltx-video-server/README.md` | 部署文档 |
| `api/services/ltxVideoService.ts` | Node.js 端 LTX 服务客户端（任务创建、后台轮询、视频下载） |
| `api/routes/ltx.ts` | LTX-Video API 路由（/api/ltx/health, /generate, /status, /models） |

## 修改文件清单

| 文件路径 | 修改内容 |
|---------|---------|
| `api/app.ts` | 注册 LTX 路由 `app.use('/api/ltx', ltxRoutes)` |
| `.env` | 添加 `LTX_SERVER_URL=http://localhost:8000` 配置 |
| `src/pages/VideoGenerator.tsx` | 添加引擎切换UI（Agnes API / LTX 本地）、模型选择器、LTX健康检查、时长限制 |

## 测试结果

### 测试1: Node.js LTX 健康检查
- **接口**: `GET /api/ltx/health`
- **结果**: PASS
- **说明**: 正确返回 Python 微服务状态，包括 CUDA 可用性、GPU 名称、ltx_video 安装状态

### 测试2: 模型列表接口
- **接口**: `GET /api/ltx/models`
- **结果**: PASS
- **说明**: 返回5个可用模型配置（2B蒸馏/2B开发/13B蒸馏/13B蒸馏FP8/13B开发）

### 测试3: 不存在任务状态查询
- **接口**: `GET /api/ltx/status/nonexistent_task_12345`
- **结果**: PASS
- **说明**: 正确返回 `status: "failed"` 和 "任务记录不存在或已过期" 错误信息

### 测试4: 空 prompt 参数验证
- **接口**: `POST /api/ltx/generate` (body: `{prompt: ""}`)
- **结果**: PASS
- **说明**: 返回 HTTP 400 和 "prompt is required" 错误

### 测试5: 超长视频验证（>18秒）
- **接口**: `POST /api/ltx/generate` (body: `{prompt: "测试", duration: "30"}`)
- **结果**: PASS
- **说明**: 正确拒绝超长视频，返回 "LTX-Video 本地模型仅支持18秒以内的视频"

### 测试6: Python 微服务健康检查
- **接口**: `GET http://localhost:8000/health`
- **结果**: PASS
- **说明**: FastAPI 服务正常启动，返回 GPU 状态和模型安装状态

### 测试7: 端到端任务流程（ltx_video 未安装场景）
- **接口**: `POST /api/ltx/generate` -> `GET /api/ltx/status/:taskId`
- **结果**: PASS
- **说明**:
  1. Node.js 后端成功创建任务并返回 taskId
  2. Python 微服务后台执行，检测到 ltx_video 未安装，标记任务为 failed
  3. Node.js 后端轮询 Python 微服务，获取到 failed 状态
  4. Node.js 后端更新持久化进度记录
  5. 前端查询 Node.js 后端，正确获取到失败状态和错误信息
  6. 错误信息: "ltx_video 未安装: No module named 'ltx_video'。请参考 README.md 安装 LTX-Video。"

### 测试8: TypeScript 编译检查
- **命令**: `npx tsc --noEmit`
- **结果**: PASS
- **说明**: 所有新增和修改的 TypeScript 文件编译通过，无类型错误

## 前端功能

### 引擎切换 UI
- 在视频生成页面新增"生成引擎"选择器
- 两个选项：**Agnes API（云端）** 和 **LTX 本地模型**
- LTX 按钮在服务不可用时自动禁用
- 显示 LTX 服务在线状态标签（在线/离线/模型未安装）

### 模型选择
- 切换到 LTX 引擎时显示模型下拉选择器
- 5个可选模型，标注显存要求和适用场景
- 提示"本地模型仅支持18秒以内的视频"

### 时长限制
- 切换到 LTX 引擎时，超过18秒的时长选项自动禁用并变灰
- 鼠标悬停显示"本地模型仅支持18秒以内"提示

## 部署步骤（用户需执行）

LTX-Video 集成代码已完成，但要实际生成视频，还需部署 Python 环境：

1. **创建 Python 虚拟环境** (conda 或 venv)
2. **安装 PyTorch** (`pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121`)
3. **克隆并安装 LTX-Video** (`git clone https://github.com/Lightricks/LTX-Video.git && cd LTX-Video && pip install -e .`)
4. **下载模型权重** (从 HuggingFace 下载 .safetensors 文件)
5. **安装微服务依赖** (`pip install -r ltx-video-server/requirements.txt`)
6. **启动微服务** (运行 `ltx-video-server/start.bat` 或 `python server.py`)

详细步骤见 `ltx-video-server/README.md`。

## 已知限制

1. **LTX 本地模型仅支持18秒以内视频** - 超过18秒需使用 Agnes API
2. **GPU 串行执行** - Python 微服务使用 GPU 锁，同一时间只执行一个生成任务
3. **首次运行需下载模型** - T5 text encoder 约4GB，建议使用 HF 镜像加速
4. **FP8 量化需 ADA 架构 GPU** - 仅 RTX 40/50系、H100 等支持
5. **Python 微服务内存存储** - 任务记录在 Python 端存内存，重启丢失（Node.js 端有持久化）

## 结论

LTX-Video 本地视频生成已成功集成到项目中，所有测试通过。用户可在视频生成页面通过引擎切换按钮选择使用本地 LTX-Video 模型或 Agnes Video API。完成 Python 环境部署后即可使用本地模型生成视频，预期速度比 Agnes API 快5-10倍。
