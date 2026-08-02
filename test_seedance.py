import requests, json, time

body = {
    'prompt': (
        'A cinematic promotional commercial for modern contraceptive brand. '
        'Opening scene: young professional couple having intimate conversation at a stylish dinner table, '
        'warm ambient lighting, shallow depth of field. Smooth camera push-in to close-up of their faces, '
        'showing trust and connection. Next: woman picks up the product elegantly from a marble countertop, '
        'clean white modern bathroom setting. Product close-up shot with soft studio lighting, '
        'emphasizing premium quality and sleek packaging. Final: couple walking hand in hand '
        'along city street at golden hour sunset, confident smiles, '
        'slow motion cinematic, warm tones, lifestyle commercial aesthetic'
    ),
    'model': 'seedance',
    'duration': 5,
    'style': 'cinematic'
}
print('Submitting Seedance 2.0 task...')
r = requests.post('http://localhost:3001/api/video/free', json=body, timeout=20)
result = r.json()
print(f"success: {result.get('success')}")
print(f"taskId: {result.get('taskId', 'N/A')}")
if result.get('error'):
    print(f"error: {result['error']}")
else:
    task_id = result['taskId']
    # Poll status
    print(f'\nPolling status for {task_id}...')
    for i in range(30):
        time.sleep(10)
        sr = requests.get(f'http://localhost:3001/api/video/free/status/{task_id}?model=seedance', timeout=5)
        sd = sr.json()
        status = sd.get('status', '?')
        progress = sd.get('progress', 0)
        print(f"  [{i+1}] status={status} progress={progress}%")
        if status == 'completed':
            print(f"\nSUCCESS! videoUrl={sd.get('videoUrl')}")
            break
        elif status == 'failed':
            print(f"\nFAILED: {sd.get('error', 'unknown')}")
            break
