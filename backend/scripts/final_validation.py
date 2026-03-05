"""Final e2e validation: health + brain knowledge + ingest + subject detection."""
import urllib.request
import json

from typing import Any

BASE = "http://127.0.0.1:8000"

def get(path: str) -> dict[str, Any]:
    return json.loads(urllib.request.urlopen(f"{BASE}{path}", timeout=10).read())

def post(path: str, body: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


# 1. Health
print("1. Health check")
h = get("/health")
assert h["status"] == "ok", f"Health failed: {h}"
print("   OK\n")

# 2. Greeting — should return sources=0, no unrelated results
print("2. Greeting (hi) — sync chat, no web, no deepthink")
r = post("/api/v1/chat", {
    "user_id": "test-final",
    "session_id": "s-final",
    "query": "hi",
    "use_web": False,
    "deep_think": False,
})
assert "credon" in r.get("answer", "").lower() or "hey" in r.get("answer", "").lower() or "hello" in r.get("answer", "").lower(), f"Greeting answer unexpected: {r.get('answer','')[:80]}"
assert len(r.get("sources", [])) == 0, f"Greeting should have 0 sources, got {len(r.get('sources', []))}"
print(f"   Answer: {r['answer'][:80]}...")
print(f"   Sources: {len(r.get('sources', []))}, Thinking: {len(r.get('thinking', ''))}")
print("   OK\n")

# 3. Academic query — test brain knowledge
print("3. Academic query — Newton's laws (brain knowledge)")
r2 = post("/api/v1/chat", {
    "user_id": "test-final",
    "session_id": "s-final",
    "query": "what is newton's laws of motion",
    "use_web": False,
    "deep_think": False,
})
ans = r2.get("answer", "")
assert "newton" in ans.lower() or "f=ma" in ans.lower() or "force" in ans.lower(), f"Expected Newton's laws content, got: {ans[:100]}"
print(f"   Answer starts with: {ans[:120]}...")
print(f"   Sources: {len(r2.get('sources', []))}")
print("   OK\n")

# 4. ingest/text — physics content
print("4. Ingest text — physics notes")
r3 = post("/api/v1/ingest/text", {
    "user_id": "test-final",
    "text": "Ohm's law states V=IR. Resistance is measured in ohms. Current flows from high to low potential.",
    "title": "Physics Electricity Notes",
    "source_type": "note",
    "tags": ["electricity", "ohm"],
})
assert r3.get("ok"), f"Ingest failed: {r3}"
print(f"   Subject: {r3.get('detected_subject')}, Chunks: {r3.get('chunks')}")
print("   OK\n")

# 5. Ingest bulk — multiple subjects
print("5. Ingest bulk — math + bio")
r4 = post("/api/v1/ingest/bulk", {
    "user_id": "test-final",
    "items": [
        {"text": "The Pythagorean theorem states a^2 + b^2 = c^2 for right triangles.", "title": "Geometry basics", "tags": ["geometry"]},
        {"text": "Mitochondria is the powerhouse of the cell. ATP is produced here.", "title": "Cell Energy", "tags": ["cell-biology"]},
    ],
})
assert r4.get("ok"), f"Bulk ingest failed: {r4}"
assert r4["total_stored_chunks"] >= 2, f"Expected >=2 chunks, got {r4['total_stored_chunks']}"
for item in r4["results"]:
    print(f"   {item['title']}: subject={item.get('detected_subject')}")
print("   OK\n")

# 6. Subject detection
print("6. Subject detection validation")
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.services.knowledge_store import detect_query_subject
checks = {
    "What is Newton's second law?": "physics",
    "Solve integral of sin(x)": "mathematics",
    "DNA replication process": "biology",
    "What is covalent bonding?": "chemistry",
    "Binary search complexity": "computer_science",
    "Hello how are you": "general",
}
all_pass = True
for q, expected in checks.items():
    got = detect_query_subject(q)
    status = "PASS" if got == expected else "FAIL"
    if got != expected:
        all_pass = False
    print(f"   {status}: '{q}' -> {got} (expected {expected})")
assert all_pass, "Some subject detections failed"
print("   OK\n")

print("=" * 50)
print("ALL VALIDATIONS PASSED!")
print("=" * 50)
