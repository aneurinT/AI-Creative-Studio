import requests, json, sys

# 1. 生成测试图片
print("=== 1. 生成测试图片 ===")
r = requests.post('http://localhost:3001/api/generate', json={
    'prompt': 'a beautiful sunset over the ocean, warm golden light, cinematic',
    'model': 'trae', 'style': 'realistic', 'size': '1024*1024'
}, timeout=20)
result = r.json()
print(f'success={result.get("success")}, imageUrl={result.get("imageUrl","N/A")}')

if not result.get('imageUrl'):
    print("Image generation failed, using fallback test image path")
    img_url = '/images/1785134138789.png'
else:
    img_url = result['imageUrl']

# 2. 图片+文字聊天测试
print(f"\n=== 2. 图片+文字聊天测试 ===")
print(f"image: {img_url}")
r2 = requests.post('http://localhost:3001/api/hermes/chat-with-image', json={
    'imageUrl': img_url,
    'message': '用这张落日风格图片，生成一个10秒的风景视频，要有海浪和天空'
}, timeout=25)
r2_result = r2.json()
print(f'success: {r2_result.get("success")}')
print(f'action:  {r2_result.get("action")}')
print(f'params:  {json.dumps(r2_result.get("params",{}), ensure_ascii=False)}')
print(f'response: {r2_result.get("response","")[:150]}')

# 3. 判定准确性
action = r2_result.get("action","")
if action == "video":
    print("\n✅ 图片+文字识别准确：正确识别为用户想生成视频")
elif action == "image":
    print("\n⚠️ 偏差：用户要视频但识别为图片，需要审核Agent校对")
else:
    print(f"\n⚠️ 未知action: {action}")
