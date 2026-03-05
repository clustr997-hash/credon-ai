import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from typing import Any

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.append(str(BACKEND))


def http_get(url: str, timeout: int = 10) -> tuple[bool, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
        return True, body
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def http_post_json(url: str, payload: dict[str, Any], timeout: int = 30) -> tuple[bool, dict[str, Any] | str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
        return True, json.loads(body)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return False, f"HTTPError {exc.code}: {detail}"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def stream_probe(url: str, payload: dict[str, Any], timeout: int = 45) -> tuple[bool, str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            saw_data = 0
            for raw in response:
                line = raw.decode("utf-8", errors="replace").strip()
                if line.startswith("data: "):
                    saw_data += 1
                    if saw_data >= 2:
                        return True, f"received {saw_data} SSE data events"
        return False, "stream closed before receiving enough SSE data events"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def main() -> int:
    api = "http://127.0.0.1:8000"

    print("[check] health")
    ok, health = http_get(f"{api}/health", timeout=8)
    print("  ok:", ok, "body:", health)

    print("[check] chat sync (no web)")
    ok, response = http_post_json(
        f"{api}/api/v1/chat",
        {
            "user_id": "workflow-check",
            "session_id": f"session-{int(time.time())}",
            "query": "hi",
            "language": "en",
            "use_web": False,
        },
        timeout=30,
    )
    if ok and isinstance(response, dict):
        print(
            "  ok:",
            True,
            "has_answer:",
            bool(response.get("answer")),
            "sources:",
            len(response.get("sources") or []),
            "confidence:",
            response.get("confidence"),
        )
    else:
        print("  ok:", False, "error:", response)

    print("[check] retrieval_v2 web fetch")
    try:
        from app.services.retrieval_v2 import retrieve_sources  # type: ignore

        web_results = retrieve_sources("Latest AI trends 2026", max_results=3)
        print(
            "  ok:",
            True,
            "results:",
            len(web_results),
            "first_url:",
            web_results[0].get("url") if web_results else None,
        )
    except Exception as exc:
        print("  ok:", False, "error:", f"{type(exc).__name__}: {exc}")

    print("[check] chat stream (SSE)")
    ok, stream_status = stream_probe(
        f"{api}/api/v1/chat/stream",
        {
            "user_id": "workflow-check",
            "session_id": f"session-{int(time.time())}",
            "query": "hello",
            "language": "en",
            "use_web": False,
        },
        timeout=45,
    )
    print("  ok:", ok, "status:", stream_status)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
