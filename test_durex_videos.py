import requests, json, time

# ====== 英文版杜蕾斯宣传视频 ======
print("=== 提交杜蕾斯英文宣传视频 ===")
body_en = {
    "prompt": (
        "A cinematic and elegant Durex brand promotional video. "
        "Modern couples enjoying life together, romantic sunsets, "
        "intimate dinner dates, city night scenes. "
        "Clean white minimalist aesthetics with subtle red brand color accents. "
        "Professional lighting, smooth camera movements. "
        "Focus on emotional connection and lifestyle. Duration 20 seconds. "
        'Add English subtitles throughout: "Love freely. Love safely. Choose Durex."'
    ),
    "style": "cinematic",
    "duration": "20"
}
r = requests.post("http://localhost:3001/api/video", json=body_en, timeout=30)
result_en = r.json()
print(f"English video task: success={result_en.get('success')}, taskId={result_en.get('taskId','N/A')}")
if not result_en.get('success'):
    print(f"  error: {result_en.get('error','')}")

# ====== 西班牙语版杜蕾斯宣传视频 ======
print("\n=== 提交杜蕾斯西班牙语宣传视频 ===")
body_es = {
    "prompt": (
        "A cinematic and elegant Durex brand promotional video. "
        "Modern couples enjoying life together, romantic evening scenes, "
        "warm candlelit dinners, beautiful urban nightscapes. "
        "Clean white minimalist aesthetics with subtle red color accents. "
        "Smooth cinematic camera movements with professional lighting. "
        "Emphasize love, trust, and connection. Duration 20 seconds. "
        'Add Spanish subtitles throughout: "Ama libremente. Ama con seguridad. Elige Durex."'
    ),
    "style": "cinematic",
    "duration": "20"
}
r2 = requests.post("http://localhost:3001/api/video", json=body_es, timeout=30)
result_es = r2.json()
print(f"Spanish video task: success={result_es.get('success')}, taskId={result_es.get('taskId','N/A')}")
if not result_es.get('success'):
    print(f"  error: {result_es.get('error','')}")

print("\n=== 汇总 ===")
print(f"EN taskId: {result_en.get('taskId','FAIL')}")
print(f"ES taskId: {result_es.get('taskId','FAIL')}")
