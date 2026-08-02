"""测试多图+文字生成视频全流程"""
import requests, json, time

# Step 1: 生成一张测试图片
print("=== Step 1: Generate test image ===")
r = requests.post('http://localhost:3001/api/generate', json={
    'prompt': 'a beautiful sunset over the ocean, golden light, cinematic',
    'model': 'trae', 'style': 'cinematic', 'size': '1024*1024'
}, timeout=30)
img_result = r.json()
img_url = img_result.get('imageUrl', '')
print(f"imageUrl: {img_url}")

if not img_url:
    # Fallback: use existing upload
    r2 = requests.post('http://localhost:3001/api/generate', json={
        'prompt': 'sunset beach cinematic',
        'model': 'cogview', 'style': 'cinematic', 'size': '1024x1024'
    }, timeout=30)
    img2 = r2.json()
    img_url = img2.get('imageUrl', '/uploads/upload_1785131771477-180606547.png')
    print(f"fallback image: {img_url}")

# Step 2: 用多图+文字生成视频
print(f"\n=== Step 2: Video generation with image ===")
body = {
    'prompt': 'A cinematic video using this sunset beach scene as reference: golden hour lighting, smooth camera pan, gentle waves, cinematic quality, slow motion',
    'model': 'seedance',
    'imageUrls': [img_url],
    'duration': 5,
    'style': 'cinematic'
}
r = requests.post('http://localhost:3001/api/video/free', json=body, timeout=20)
result = r.json()
print(f"success: {result.get('success')}")
print(f"taskId: {result.get('taskId', 'N/A')}")
print(f"error: {result.get('error', '')}")

if result.get('success'):
    task_id = result['taskId']
    print(f"\n=== Step 3: Poll status ===")
    for i in range(20):
        time.sleep(10)
        sr = requests.get(f'http://localhost:3001/api/video/free/status/{task_id}?model=seedance', timeout=5)
        sd = sr.json()
        status = sd.get('status', '?')
        progress = sd.get('progress', 0)
        print(f"  [{i+1}] {status} ({progress}%)")
        if status == 'completed':
            print(f"  SUCCESS! video={sd.get('videoUrl')}")
            break
        elif status == 'failed':
            print(f"  FAILED: {sd.get('error')}")
            break
