import requests

body = {
    'prompt': 'A cinematic couple at golden hour, intimate dinner, warm lighting, cinematic quality',
    'model': 'seedance',
    'duration': 5,
    'style': 'cinematic'
}
r = requests.post('http://localhost:3001/api/video/free', json=body, timeout=20)
result = r.json()
print(f"success={result.get('success')} taskId={result.get('taskId','N/A')} error={result.get('error','')}")
