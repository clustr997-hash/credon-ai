from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient


def _ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)


def main() -> int:
    backend_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(backend_root))

    from app.main import app

    client = TestClient(app)

    t0 = time.perf_counter()
    health = client.get("/health")
    print("HEALTH", health.status_code, _ms(t0), health.json())

    quick_payload = {
        "user_id": "smoke-user",
        "session_id": "smoke-session-quick",
        "query": "hi",
        "language": "en",
        "use_web": False,
    }
    t1 = time.perf_counter()
    quick = client.post("/api/v1/chat", json=quick_payload)
    quick_ms = _ms(t1)
    quick_json = quick.json()
    print(
        "CHAT_QUICK",
        quick.status_code,
        quick_ms,
        "reported_latency_ms=",
        quick_json.get("latency_ms"),
        "answer_len=",
        len(quick_json.get("answer", "")),
    )

    run_web = os.getenv("SMOKE_TEST_WEB", "false").lower() == "true"
    if run_web:
        web_payload = {
            "user_id": "smoke-user",
            "session_id": "smoke-session-web",
            "query": "latest AI news",
            "language": "en",
            "use_web": True,
        }
        t2 = time.perf_counter()
        web = client.post("/api/v1/chat", json=web_payload)
        web_ms = _ms(t2)
        web_json = web.json()
        print(
            "CHAT_WEB",
            web.status_code,
            web_ms,
            "reported_latency_ms=",
            web_json.get("latency_ms"),
            "sources=",
            len(web_json.get("sources") or []),
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
