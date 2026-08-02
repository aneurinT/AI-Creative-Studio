"""
LTX-Video 本地推理微服务
========================
提供 HTTP API 供 Node.js 后端调用，实现本地视频生成。

API 端点：
  GET  /health          - 健康检查（返回 GPU 状态）
  POST /generate        - 提交视频生成任务（异步，返回 task_id）
  GET  /status/:task_id - 查询任务状态
  GET  /video/:task_id  - 下载生成的视频文件
  GET  /models          - 列出可用模型配置

启动方式：
  python -m uvicorn server:app --host 0.0.0.0 --port 8000
  或直接运行: python server.py
"""

import os
import sys
import uuid
import time
import json
import shutil
import traceback
import threading
from pathlib import Path
from typing import Optional, Dict, Any

# ============================================================
# 配置
# ============================================================

HOST = os.environ.get("LTX_HOST", "0.0.0.0")
PORT = int(os.environ.get("LTX_PORT", "8000"))

# 视频输出目录（最终会被 Node.js 后端复制到 public/images）
OUTPUT_DIR = Path(os.environ.get("LTX_OUTPUT_DIR", "./outputs"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# LTX-Video 代码仓库路径（配置文件、模型权重等都在这里）
# 默认相对于 ltx-video-server 的上级目录
LTX_REPO_DIR = Path(os.environ.get("LTX_REPO_DIR", str(Path(__file__).resolve().parent.parent / "LTX-Video")))

# 可用模型配置（pipeline_config 使用绝对路径）
MODEL_CONFIGS: Dict[str, Dict[str, Any]] = {
    "ltxv-2b-distilled": {
        "name": "LTX-Video 2B 蒸馏版（低显存，快速）",
        "pipeline_config": str(LTX_REPO_DIR / "configs/ltxv-2b-0.9.6-distilled.yaml"),
        "min_vram_gb": 6,
        "description": "适合 6GB+ 显存，生成速度最快，画质中等",
    },
    "ltxv-2b-dev": {
        "name": "LTX-Video 2B 开发版（低显存，高质量）",
        "pipeline_config": str(LTX_REPO_DIR / "configs/ltxv-2b-0.9.6-dev.yaml"),
        "min_vram_gb": 8,
        "description": "适合 8GB+ 显存，画质较好但速度较慢",
    },
    "ltxv-13b-distilled": {
        "name": "LTX-Video 13B 蒸馏版（推荐，速度与质量平衡）",
        "pipeline_config": str(LTX_REPO_DIR / "configs/ltxv-13b-0.9.8-distilled.yaml"),
        "min_vram_gb": 10,
        "description": "适合 10GB+ 显存，速度快画质好",
    },
    "ltxv-13b-distilled-fp8": {
        "name": "LTX-Video 13B 蒸馏 FP8 版（RTX 4090 推荐）",
        "pipeline_config": str(LTX_REPO_DIR / "configs/ltxv-13b-0.9.8-distilled-fp8.yaml"),
        "min_vram_gb": 8,
        "description": "FP8 量化版，需 ADA 架构 GPU（RTX 40/50系），速度最快",
    },
    "ltxv-13b-dev": {
        "name": "LTX-Video 13B 开发版（最高质量）",
        "pipeline_config": str(LTX_REPO_DIR / "configs/ltxv-13b-0.9.8-dev.yaml"),
        "min_vram_gb": 16,
        "description": "适合 16GB+ 显存，画质最高但速度较慢",
    },
}

DEFAULT_MODEL = os.environ.get("LTX_DEFAULT_MODEL", "ltxv-2b-distilled")

# 任务存储（内存中，重启后丢失；与 Node.js 端的持久化配合使用）
tasks: Dict[str, Dict[str, Any]] = {}
tasks_lock = threading.Lock()

# GPU 任务队列（串行执行，避免显存冲突）
gpu_lock = threading.Lock()


# ============================================================
# FastAPI 应用
# ============================================================

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional

app = FastAPI(title="LTX-Video API", version="1.0.0", description="LTX-Video 本地视频生成微服务")

# 允许跨域（Node.js 后端调用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# 请求/响应模型
# ============================================================

class GenerateRequest(BaseModel):
    prompt: str = Field(..., description="视频生成提示词")
    model: str = Field(default=DEFAULT_MODEL, description="模型配置名称")
    height: int = Field(default=512, description="视频高度（像素）")
    width: int = Field(default=768, description="视频宽度（像素）")
    num_frames: int = Field(default=121, description="帧数（30fps 下 121帧≈4秒）")
    frame_rate: int = Field(default=30, description="输出帧率")
    seed: int = Field(default=171198, description="随机种子")
    offload_to_cpu: bool = Field(default=False, description="是否将模型卸载到 CPU（省显存但变慢）")
    negative_prompt: str = Field(default="", description="负向提示词")
    # 图生视频参数
    conditioning_media_paths: Optional[List[str]] = Field(default=None, description="条件图片路径列表")
    conditioning_strengths: Optional[List[float]] = Field(default=None, description="条件强度")
    conditioning_start_frames: Optional[List[int]] = Field(default=None, description="条件起始帧")


class TaskResponse(BaseModel):
    task_id: str
    status: str
    message: str


# ============================================================
# 健康检查
# ============================================================

@app.get("/health")
def health():
    """检查服务状态和 GPU 可用性"""
    try:
        import torch
        cuda_available = torch.cuda.is_available()
        gpu_name = torch.cuda.get_device_name(0) if cuda_available else "N/A"
        gpu_memory = (
            torch.cuda.get_device_properties(0).total_mem / 1024**3
            if cuda_available
            else 0
        )
    except ImportError:
        cuda_available = False
        gpu_name = "PyTorch not installed"
        gpu_memory = 0

    # 检查 ltx_video 是否已安装
    ltx_installed = False
    try:
        import ltx_video  # noqa: F401
        ltx_installed = True
    except ImportError:
        pass

    return {
        "status": "ok",
        "cuda_available": cuda_available,
        "gpu_name": gpu_name,
        "gpu_memory_gb": round(gpu_memory, 1),
        "ltx_video_installed": ltx_installed,
        "default_model": DEFAULT_MODEL,
        "active_tasks": len([t for t in tasks.values() if t["status"] == "processing"]),
    }


# ============================================================
# 列出可用模型
# ============================================================

@app.get("/models")
def list_models():
    """列出所有可用的模型配置"""
    return {"models": MODEL_CONFIGS, "default": DEFAULT_MODEL}


# ============================================================
# 提交视频生成任务（异步）
# ============================================================

@app.post("/generate", response_model=TaskResponse)
def generate(req: GenerateRequest, background_tasks: BackgroundTasks):
    """提交视频生成任务，立即返回 task_id，后台异步执行"""

    # 验证模型配置
    if req.model not in MODEL_CONFIGS:
        raise HTTPException(status_code=400, detail=f"未知模型: {req.model}，可用模型: {list(MODEL_CONFIGS.keys())}")

    # 验证 prompt 非空
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt 不能为空")

    task_id = f"ltx_{int(time.time())}_{uuid.uuid4().hex[:6]}"

    with tasks_lock:
        tasks[task_id] = {
            "task_id": task_id,
            "status": "processing",
            "progress": 0,
            "prompt": req.prompt,
            "model": req.model,
            "created_at": time.time(),
            "updated_at": time.time(),
            "video_path": None,
            "error": None,
        }

    # 后台执行生成
    background_tasks.add_task(run_generation, task_id, req)

    return TaskResponse(
        task_id=task_id,
        status="processing",
        message=f"视频生成任务已创建，使用模型: {MODEL_CONFIGS[req.model]['name']}",
    )


# ============================================================
# 查询任务状态
# ============================================================

@app.get("/status/{task_id}")
def get_status(task_id: str):
    """查询任务状态"""
    with tasks_lock:
        task = tasks.get(task_id)

    if not task:
        raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")

    return {
        "task_id": task["task_id"],
        "status": task["status"],
        "progress": task["progress"],
        "prompt": task["prompt"],
        "model": task["model"],
        "video_path": task["video_path"],
        "error": task["error"],
        "created_at": task["created_at"],
        "updated_at": task["updated_at"],
    }


# ============================================================
# 下载/获取视频文件
# ============================================================

@app.get("/video/{task_id}")
def get_video(task_id: str):
    """获取生成的视频文件"""
    with tasks_lock:
        task = tasks.get(task_id)

    if not task:
        raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")

    if task["status"] != "completed" or not task["video_path"]:
        raise HTTPException(status_code=400, detail=f"视频尚未生成完成，当前状态: {task['status']}")

    video_path = Path(task["video_path"])
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="视频文件不存在")

    return FileResponse(
        str(video_path),
        media_type="video/mp4",
        filename=f"{task_id}.mp4",
    )


# ============================================================
# 删除任务
# ============================================================

@app.delete("/task/{task_id}")
def delete_task(task_id: str):
    """删除任务记录"""
    with tasks_lock:
        if task_id in tasks:
            del tasks[task_id]
            return {"success": True, "message": "任务已删除"}
    raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")


# ============================================================
# 后台生成逻辑
# ============================================================

def run_generation(task_id: str, req: GenerateRequest):
    """在后台执行视频生成（串行，通过 GPU 锁避免并发冲突）"""

    with gpu_lock:
        try:
            _update_task(task_id, progress=5, status="processing")

            # 动态导入 ltx_video（首次可能需要加载模型）
            _update_task(task_id, progress=10, status="loading_model")

            try:
                from ltx_video.inference import infer, InferenceConfig
            except ImportError as e:
                _update_task(
                    task_id,
                    status="failed",
                    error=f"ltx_video 未安装: {e}。请参考 README.md 安装 LTX-Video。",
                )
                return

            _update_task(task_id, progress=20, status="preparing")

            # 创建输出目录
            task_output_dir = OUTPUT_DIR / task_id
            task_output_dir.mkdir(parents=True, exist_ok=True)

            # 构建推理配置
            model_config = MODEL_CONFIGS[req.model]

            # 读取 pipeline YAML 配置，替换 checkpoint_path 为本地的绝对路径
            # 避免 hf_hub_download 因网络问题报 LocalEntryNotFoundError
            pipeline_config_path = model_config["pipeline_config"]
            import yaml as yaml_reader
            with open(pipeline_config_path, "r", encoding="utf-8") as f:
                pipeline_cfg = yaml_reader.safe_load(f)

            # 查找本地已下载的模型 checkpoint
            ckpt_name = pipeline_cfg.get("checkpoint_path", "")
            # 尝试在 HF 缓存中找到对应的文件
            from huggingface_hub import try_to_load_from_cache
            local_ckpt = try_to_load_from_cache("Lightricks/LTX-Video", ckpt_name)
            
            # 如果精确匹配不到，搜索 HF 缓存中的 safetensors 文件
            if not local_ckpt:
                import glob as glob_mod
                hf_snapshots = os.path.join(
                    os.path.expanduser("~"), ".cache", "huggingface", "hub",
                    "models--Lightricks--LTX-Video", "snapshots"
                )
                if os.path.isdir(hf_snapshots):
                    for snap_dir in os.listdir(hf_snapshots):
                        snap_path = os.path.join(hf_snapshots, snap_dir)
                        if not os.path.isdir(snap_path):
                            continue
                        # 优先匹配同名，其次匹配任何 2b safetensors
                        candidates = glob_mod.glob(os.path.join(snap_path, "*.safetensors"))
                        candidates = [c for c in candidates if "incomplete" not in c]
                        for c in candidates:
                            if ckpt_name in os.path.basename(c) or "2b" in os.path.basename(c):
                                local_ckpt = c
                                break
                        if local_ckpt:
                            break
                        
            if local_ckpt:
                pipeline_cfg["checkpoint_path"] = local_ckpt
                print(f"[LTX-Video] Using local checkpoint: {local_ckpt}")

                # 修正 text_encoder 路径，指向本地缓存中的同目录（含 text_encoder/）
                pipeline_cfg["text_encoder_model_name_or_path"] = "Lightricks/LTX-Video"
                print(f"[LTX-Video] Using local text_encoder from repo: Lightricks/LTX-Video")
                
                # 禁用 prompt 增强（需要额外下载模型）
                pipeline_cfg["prompt_enhancement_words_threshold"] = 99999
            elif not os.path.isfile(ckpt_name):
                print(f"[LTX-Video] WARNING: checkpoint '{ckpt_name}' not in cache, may trigger download")

            # 设置 HF 离线模式，避免网络请求

            # 写入修改后的临时 YAML（使用绝对路径，因为 infer() 会切换工作目录）
            patched_config_path = task_output_dir / "pipeline_config.yaml"
            patched_config_path = patched_config_path.resolve()
            with open(patched_config_path, "w", encoding="utf-8") as f:
                yaml_reader.dump(pipeline_cfg, f)

            config_kwargs = {
                "prompt": req.prompt,
                "pipeline_config": str(patched_config_path),
                "seed": req.seed,
                "height": req.height,
                "width": req.width,
                "num_frames": req.num_frames,
                "frame_rate": req.frame_rate,
                "offload_to_cpu": req.offload_to_cpu,
                "output_path": str(task_output_dir),
            }

            # 可选参数
            if req.negative_prompt:
                config_kwargs["negative_prompt"] = req.negative_prompt

            if req.conditioning_media_paths:
                config_kwargs["conditioning_media_paths"] = req.conditioning_media_paths
                config_kwargs["conditioning_strengths"] = req.conditioning_strengths or [1.0]
                config_kwargs["conditioning_start_frames"] = req.conditioning_start_frames or [0]
                config_kwargs["image_cond_noise_scale"] = 0.15

            config = InferenceConfig(**config_kwargs)

            _update_task(task_id, progress=30, status="generating")

            print(f"[LTX-Video] Task {task_id}: Starting generation with model={req.model}")
            print(f"[LTX-Video] Prompt: {req.prompt[:100]}")
            print(f"[LTX-Video] Resolution: {req.width}x{req.height}, Frames: {req.num_frames}")

            start_time = time.time()

            # 切换到 LTX-Video 仓库目录执行推理（模型加载需要相对路径）
            original_cwd = os.getcwd()
            # 强制 HF 离线模式，避免 LocalEntryNotFoundError
            original_hf_offline = os.environ.get("HF_HUB_OFFLINE", "")
            os.environ["HF_HUB_OFFLINE"] = "1"

            # 超时保护：GPU 推理超过 20 分钟则中断（LTX-Video 2B 模型正常约 2-5 分钟）
            INFERENCE_TIMEOUT_SEC = 1200  # 20 分钟
            inference_timed_out = threading.Event()

            def timeout_handler():
                inference_timed_out.set()
                print(f"[LTX-Video] Task {task_id}: Inference timeout ({INFERENCE_TIMEOUT_SEC}s), interrupting...")
                # 尝试通过抛出异常中断（在独立线程中不直接生效，但会标记状态）
                import ctypes
                thread_id = threading.current_thread().ident
                if thread_id:
                    try:
                        ctypes.pythonapi.PyThreadState_SetAsyncExc(
                            ctypes.c_ulong(thread_id),
                            ctypes.py_object(TimeoutError(f"推理超时 ({INFERENCE_TIMEOUT_SEC}s)"))
                        )
                    except Exception:
                        pass

            timeout_timer = threading.Timer(INFERENCE_TIMEOUT_SEC, timeout_handler)
            timeout_timer.daemon = True
            timeout_timer.start()

            try:
                os.chdir(str(LTX_REPO_DIR))
                infer(config=config)
            except TimeoutError:
                _update_task(task_id, status="failed", error=f"推理超时（{INFERENCE_TIMEOUT_SEC}秒），请尝试更短的视频或更小的分辨率")
                return
            finally:
                timeout_timer.cancel()
                os.chdir(original_cwd)
                if original_hf_offline:
                    os.environ["HF_HUB_OFFLINE"] = original_hf_offline
                else:
                    os.environ.pop("HF_HUB_OFFLINE", None)

            elapsed = time.time() - start_time
            print(f"[LTX-Video] Task {task_id}: Generation completed in {elapsed:.1f}s")

            _update_task(task_id, progress=90, status="finalizing")

            # 查找生成的视频文件
            video_files = list(task_output_dir.glob("*.mp4"))
            if not video_files:
                # 尝试查找其他视频格式
                video_files = list(task_output_dir.glob("*.avi")) + list(task_output_dir.glob("*.mov"))

            if not video_files:
                _update_task(
                    task_id,
                    status="failed",
                    error="推理完成但未找到输出视频文件",
                )
                return

            video_path = video_files[0]
            _update_task(
                task_id,
                progress=100,
                status="completed",
                video_path=str(video_path),
            )

            print(f"[LTX-Video] Task {task_id}: Video saved to {video_path}")

        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            print(f"[LTX-Video] Task {task_id}: Generation failed - {error_msg}")
            print(traceback.format_exc())
            _update_task(task_id, status="failed", error=error_msg)


def _update_task(task_id: str, **kwargs):
    """更新任务状态（线程安全）"""
    with tasks_lock:
        if task_id in tasks:
            tasks[task_id].update(kwargs)
            tasks[task_id]["updated_at"] = time.time()


# ============================================================
# 清理过期任务（超过2小时）
# ============================================================

def cleanup_expired_tasks():
    """清理过期的任务记录"""
    now = time.time()
    expired = []
    with tasks_lock:
        for tid, task in list(tasks.items()):
            if now - task["updated_at"] > 2 * 3600:  # 2小时
                expired.append(tid)
        for tid in expired:
            # 清理输出文件
            task_output = OUTPUT_DIR / tid
            if task_output.exists():
                shutil.rmtree(task_output, ignore_errors=True)
            del tasks[tid]

    if expired:
        print(f"[LTX-Video] Cleaned up {len(expired)} expired tasks")


@app.on_event("startup")
async def startup_event():
    """启动时清理过期任务"""
    cleanup_expired_tasks()
    print(f"[LTX-Video] Server started on {HOST}:{PORT}")
    print(f"[LTX-Video] Output directory: {OUTPUT_DIR}")
    print(f"[LTX-Video] Default model: {DEFAULT_MODEL}")


# ============================================================
# 主入口
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
