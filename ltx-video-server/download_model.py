"""
LTX-Video 模型下载脚本 (通过 ModelScope)
下载完成后，模型将保存到 ../LTX-Video/LTX-Video-weights/
"""
import os
import sys
from pathlib import Path

# 设置下载目录
DOWNLOAD_DIR = Path(__file__).resolve().parent.parent / "LTX-Video" / "LTX-Video-weights"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

print(f"下载目录: {DOWNLOAD_DIR}")
print("=" * 60)

try:
    from modelscope import snapshot_download
    
    print("[1/3] 正在从 ModelScope 下载模型 (约 10-15GB，请耐心等待)...")
    print("      模型: Lightricks/LTX-Video")
    
    model_dir = snapshot_download(
        'Lightricks/LTX-Video',
        cache_dir=str(DOWNLOAD_DIR),
        revision='master'
    )
    print(f"      √ 下载完成: {model_dir}")
    
    # 验证下载结果
    print(f"\n[2/3] 验证下载文件...")
    model_path = Path(model_dir)
    files = list(model_path.rglob("*"))
    total_size = sum(f.stat().st_size for f in files if f.is_file())
    print(f"      文件数: {len(files)} 个")
    print(f"      总大小: {total_size / (1024**3):.2f} GB")
    print(f"      √ 验证通过")
    
    # 打印文件列表
    print(f"\n[3/3] 文件列表:")
    for f in sorted(files):
        if f.is_file():
            size_mb = f.stat().st_size / (1024**2)
            rel_path = f.relative_to(model_path)
            print(f"      {rel_path} ({size_mb:.1f} MB)")
    
    print("\n" + "=" * 60)
    print("√ 下载完成！LTX-Video 模型已就绪。")
    print(f"模型路径: {model_dir}")
    print("\n使用方式:")
    print(f'  设置环境变量: $env:LTX_MODEL_PATH="{model_dir}"')
    print(f'  或在 server.py 中配置 model_path')
    
except ImportError:
    print("错误: 未安装 modelscope")
    print("请运行: pip install modelscope")
    sys.exit(1)
except Exception as e:
    print(f"错误: {e}")
    print("\n可能的原因:")
    print("1. 网络连接问题")
    print("2. ModelScope 上暂无该模型")
    print("3. 存储空间不足 (需要约 20GB 可用空间)")
    sys.exit(1)
