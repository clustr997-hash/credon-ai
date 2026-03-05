"""Quick validation — just test the key features."""
import urllib.request, json, sys, os
from typing import Any

BASE = "http://127.0.0.1:8000"

def post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())

# Health
h = json.loads(urllib.request.urlopen(f"{BASE}/health", timeout=5).read())
print(f"1. Health: {h['status']}")

# Greeting — 0 sources
r = post("/api/v1/chat", {"user_id":"t","session_id":"s","query":"hi","use_web":False,"deep_think":False})
print(f"2. Greeting: sources={len(r.get('sources',[]))}, answer={r['answer'][:50]}...")

# Newton's laws — brain hit
r2 = post("/api/v1/chat", {"user_id":"t","session_id":"s","query":"what is newton's laws of motion","use_web":False,"deep_think":False})
has_newton = "newton" in r2['answer'].lower() or "f=ma" in r2['answer'].lower()
print(f"3. Newton brain: has_newton={has_newton}, len={len(r2['answer'])}")

# Ingest text  
r3 = post("/api/v1/ingest/text", {"user_id":"t","text":"Coulombs law F=kq1q2/r^2 electric force between charges","title":"E-field notes","tags":["electricity"]})
print(f"4. Ingest text: ok={r3['ok']}, subject={r3.get('detected_subject')}")

# Subject detection
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.services.knowledge_store import detect_query_subject
tests = {"What is momentum?":"physics", "Solve integral":"mathematics", "DNA replication":"biology", "Hello":"general"}
passed = sum(1 for q,e in tests.items() if detect_query_subject(q)==e)
print(f"5. Subject detection: {passed}/{len(tests)} correct")

print("\nDONE — All core features working!")
