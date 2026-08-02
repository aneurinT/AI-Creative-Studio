"""下载 LTX-Video text_encoder 权重文件 (约 4.7GB)"""
import os
import sys

# 设置目标目录
hf_snapshot = os.path.expanduser(
    r'~\.cache\huggingface\hub\models--Lightricks--LTX-Video\snapshots\master\text_encoder'
)
os.makedirs(hf_snapshot, exist_ok=True)

target = os.path.join(hf_snapshot, 'model.safetensors')
if os.path.exists(target):
    size = os.path.getsize(target) / (1024**3)
    print(f'already exists: {size:.1f} GB')
    sys.exit(0)

# 尝试从 modelscope 下载
print('Trying ModelScope...')
try:
    from modelscope import file_download
    path = file_download.model_file_download(
        'Lightricks/LTX-Video',
        'text_encoder/model.safetensors',
        cache_dir=os.path.dirname(hf_snapshot)
    )
    print(f'Success: {path}')
    sys.exit(0)
except Exception as e:
    print(f'ModelScope failed: {e}')

# 尝试从 hf-mirror 下载
print('Trying hf-mirror.com...')
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'
try:
    from huggingface_hub import hf_hub_download
    path = hf_hub_download(
        'Lightricks/LTX-Video',
        'text_encoder/model.safetensors',
        cache_dir=os.path.dirname(os.path.dirname(hf_snapshot)),
        local_files_only=False
    )
    print(f'Success: {path}')
    sys.exit(0)
except Exception as e:
    print(f'hf-mirror failed: {e}')

print('All sources failed. Manual download needed.')
