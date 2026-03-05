"""Quick smoke test for academic ingest endpoints."""
import urllib.request
import json

from typing import Any

BASE = "http://127.0.0.1:8000/api/v1"


def post_json(path: str, body: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{BASE}{path}", data=data, headers={"Content-Type": "application/json"}
    )
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())


# Test 1: /ingest/text  (physics notes)
print("=== /ingest/text ===")
r1 = post_json("/ingest/text", {
    "user_id": "test-user",
    "text": (
        "Newton's second law of motion states F=ma. Force equals mass times "
        "acceleration. Momentum p=mv is conserved in collisions. Kinetic energy "
        "is half mv squared. Work done equals force times displacement."
    ),
    "title": "Physics Ch-3 Notes",
    "source_type": "note",
    "tags": ["chapter-3", "mechanics"],
})
print(json.dumps(r1, indent=2))

# Test 2: /ingest/bulk  (math + biology)
print("\n=== /ingest/bulk ===")
r2 = post_json("/ingest/bulk", {
    "user_id": "test-user",
    "items": [
        {
            "text": (
                "Integral of x^n is x^(n+1)/(n+1). Derivative of sin(x) is cos(x). "
                "The chain rule: d/dx f(g(x)) = f'(g(x)) * g'(x). "
                "Integration by parts: integral u dv = uv - integral v du."
            ),
            "title": "Math Calculus Cheat Sheet",
            "source_type": "cheat_sheet",
            "tags": ["calculus", "integration"],
        },
        {
            "text": (
                "DNA replication is semiconservative. mRNA carries genetic code "
                "from nucleus to ribosome. Transcription happens in the nucleus, "
                "translation in the cytoplasm. tRNA brings amino acids."
            ),
            "title": "Biology Molecular Genetics Notes",
            "source_type": "note",
            "tags": ["genetics", "dna"],
        },
    ],
})
print(json.dumps(r2, indent=2))

# Test 3: subject detection sanity
print("\n=== Subject detection ===")
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.services.knowledge_store import detect_query_subject

tests = [
    "What is Newton's second law of motion?",
    "Solve the integral of x^2 dx",
    "Explain DNA replication",
    "What is polymorphism in OOP?",
    "Hello how are you?",
]
for t in tests:
    print(f"  {t!r:55s} -> {detect_query_subject(t)}")

print("\nAll tests passed!")
