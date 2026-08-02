import requests, json, time

t0 = time.time()
r = requests.post('http://localhost:3001/api/hermes/chat',
    json={'message': '画一只可爱的柴犬在樱花树下', 'history': []},
    timeout=25)
d = r.json()
t = time.time() - t0

print(f"耗时: {t:.1f}s")
print(f"success: {d.get('success')}")
print(f"action: {d.get('action')}")
print(f"response: {d.get('response','')[:120]}")
if d.get('params'):
    print(f"params: {json.dumps(d['params'], ensure_ascii=False)[:200]}")
