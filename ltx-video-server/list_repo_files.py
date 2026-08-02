from modelscope import HubApi

api = HubApi()
files = api.get_model_files('Lightricks/LTX-Video', recursive=True)
print(f'Total files: {len(files)}')
for f in files:
    path = f.get('Path', '')
    size = f.get('Size', 0)
    if 'text_encoder' in path.lower():
        print(f'TE: {path}')
    if path.endswith('.safetensors') or path.endswith('.bin'):
        print(f'WGT: {path} ({size} bytes)')
