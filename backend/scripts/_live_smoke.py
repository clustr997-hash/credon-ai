import json
import urllib.request

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

health_raw = opener.open('http://127.0.0.1:8000/health', timeout=15).read().decode('utf-8', errors='replace')
print('health', health_raw)

ing_body = json.dumps({
    'user_id': 'swapnil-test',
    'text': 'Newton second law says force equals mass times acceleration. Ohm law is V=IR.',
    'title': 'physics quick note',
    'subject': 'physics',
    'tags': ['mechanics', 'electricity'],
    'source_type': 'note',
}).encode('utf-8')

ing_req = urllib.request.Request(
    'http://127.0.0.1:8000/api/v1/ingest/text',
    data=ing_body,
    headers={'Content-Type': 'application/json'},
)
ing_raw = opener.open(ing_req, timeout=45).read().decode('utf-8', errors='replace')
print('ingest', ing_raw[:500])

chat_body = json.dumps({
    'user_id': 'swapnil-test',
    'session_id': 's1',
    'query': 'what is newton second law in simple words',
    'language': 'en',
    'use_web': False,
    'deep_think': False,
}).encode('utf-8')
chat_req = urllib.request.Request(
    'http://127.0.0.1:8000/api/v1/chat',
    data=chat_body,
    headers={'Content-Type': 'application/json'},
)
chat_raw = opener.open(chat_req, timeout=75).read().decode('utf-8', errors='replace')
print('chat', chat_raw[:1200])
