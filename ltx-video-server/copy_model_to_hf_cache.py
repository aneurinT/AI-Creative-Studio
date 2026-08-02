"""复制 ModelScope 下载的模型到 HuggingFace 缓存目录"""
import os
import shutil

SRC = r'd:/项目/aiDemo/aiProject/LTX-Video/LTX-Video-weights/models/Lightricks--LTX-Video'
DST = os.path.join(os.path.expanduser('~'), '.cache', 'huggingface', 'hub', 'models--Lightricks--LTX-Video')

snap_src = os.path.join(SRC, 'snapshots')
snap_dst = os.path.join(DST, 'snapshots')

print(f'源: {snap_src}')
print(f'目标: {snap_dst}')

# 清理旧数据
if os.path.exists(snap_dst):
    print('清理旧数据...')
    shutil.rmtree(snap_dst)

os.makedirs(snap_dst, exist_ok=True)

# 复制所有文件
print('开始复制...')
shutil.copytree(snap_src, snap_dst, dirs_exist_ok=True)

# 创建 refs/main 引用文件
refs_dir = os.path.join(DST, 'refs')
os.makedirs(refs_dir, exist_ok=True)
with open(os.path.join(refs_dir, 'main'), 'w') as f:
    f.write('master')
print('refs/main -> master')

# 统计大小
total_size = 0
for root, dirs, files in os.walk(snap_dst):
    for f in files:
        total_size += os.path.getsize(os.path.join(root, f))

print(f'\n复制完成! 文件总数: {sum(1 for _, _, fs in os.walk(snap_dst) for _ in fs)} 个')
print(f'总大小: {total_size/1024**3:.2f} GB')
print(f'模型已就绪!')
