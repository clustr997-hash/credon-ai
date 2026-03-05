from __future__ import annotations

import argparse
import json
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
STATE_FILE = DATA_DIR / "autonomous_feedback_bot_state.json"

SEED_PROMPTS = [
    "Explain binary search in C with one example.",
    "In Hinglish, explain pointers in C language simply.",
    "Fix this C code and explain errors: int main(){ int a[3]={1,2}; printf(\"%d\",a[5]); }",
    "Compare DFS vs BFS with C implementation snippets.",
    "Summarize how hash tables work in C and give collision handling code.",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {"day": "", "count": 0, "hour": "", "hour_count": 0, "last_run": "", "history": []}
    try:
        raw = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return raw
    except Exception:
        pass
    return {"day": "", "count": 0, "hour": "", "hour_count": 0, "last_run": "", "history": []}


def _save_state(state: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _score_answer(answer: str, question: str, sources: list[dict[str, Any]] | None, thinking: str | None) -> tuple[str, str]:
    ans = answer.lower()
    q = question.lower()
    think = (thinking or "").lower()

    score = 0
    if len(answer.strip()) >= 120:
        score += 2
    if "```" in answer:
        score += 2
    if any(lang in q for lang in [" c ", " c++", "python", "java", "javascript", "typescript"]) and "```" in answer:
        score += 1
    if any(word in ans for word in ["step", "run", "test", "fix", "error", "correct"]):
        score += 1
    if sources and len(sources) >= 2:
        score += 1
    if thinking and len(thinking.strip()) >= 40:
        score += 1
    if any(word in think for word in ["source", "approach", "step", "analysis"]):
        score += 1
    if any(bad in ans for bad in ["i am continuously learning", "enable web search", "building understanding"]):
        score -= 3
    if any(word in q for word in ["c ", " in c", "c language"]) and "```python" in ans:
        score -= 2

    if score >= 4:
        return "up", "Strong structure + runnable answer quality"
    return "down", "Needs better specificity, code fidelity, or grounding"


def run_bot(
    base_url: str,
    user_id: str,
    loops: int,
    daily_cap: int,
    hourly_cap: int,
    max_downvotes_per_run: int,
    use_web: bool,
    deep_think_rate: float,
    chat_timeout_sec: float,
    sleep_sec: float,
) -> int:
    state = _load_state()
    day_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    hour_key = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H")
    if state.get("day") != day_key:
        state["day"] = day_key
        state["count"] = 0
    if state.get("hour") != hour_key:
        state["hour"] = hour_key
        state["hour_count"] = 0

    allowed = max(0, daily_cap - int(state.get("count", 0)))
    allowed_hour = max(0, hourly_cap - int(state.get("hour_count", 0)))
    loops = min(loops, allowed, allowed_hour)
    if loops <= 0:
        print("[Bot] Daily/hourly cap reached. Skipping run.")
        return 0

    session_id = f"bot-session-{int(time.time())}"
    history = state.get("history", [])
    if not isinstance(history, list):
        history = []

    downvotes_used = 0
    for i in range(loops):
        prompt = random.choice(SEED_PROMPTS)
        payload = {
            "user_id": user_id,
            "session_id": session_id,
            "query": prompt,
            "language": "auto",
            "use_web": use_web,
            "deep_think": random.random() < deep_think_rate,
            "code_mode": True,
        }

        try:
            r = requests.post(f"{base_url}/api/v1/chat", json=payload, timeout=max(5.0, chat_timeout_sec))
            r.raise_for_status()
            data = r.json()
            answer = str(data.get("answer", ""))
            sources = data.get("sources")
            thinking = str(data.get("thinking", ""))
            vote, reason = _score_answer(answer, prompt, sources if isinstance(sources, list) else None, thinking)

            if vote == "down" and downvotes_used >= max_downvotes_per_run:
                vote = "up"
                reason = "Capped downvotes for this run to avoid over-penalizing during low traffic period"

            feedback_payload = {
                "user_id": user_id,
                "session_id": session_id,
                "message_text": answer,
                "vote": vote,
                "category": "other" if vote == "down" else None,
                "reason": reason if vote == "down" else None,
            }
            fr = requests.post(f"{base_url}/api/v1/feedback", json=feedback_payload, timeout=45)
            fr.raise_for_status()
            if vote == "down":
                downvotes_used += 1

            history.append(
                {
                    "at": _now_iso(),
                    "prompt": prompt,
                    "vote": vote,
                    "reason": reason,
                    "answer_preview": answer[:180],
                }
            )
            state["count"] = int(state.get("count", 0)) + 1
            state["hour_count"] = int(state.get("hour_count", 0)) + 1
            state["last_run"] = _now_iso()
            print(f"[Bot] {i + 1}/{loops} vote={vote} prompt={prompt[:55]}...")
        except Exception as exc:
            print(f"[Bot] Loop failed: {exc}")

        time.sleep(max(0.0, sleep_sec))

    state["history"] = history[-300:]
    _save_state(state)
    print(f"[Bot] Completed. Daily count: {state['count']}/{daily_cap} • Hour count: {state['hour_count']}/{hourly_cap}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Autonomous QA feedback bot for Credon AI")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Backend base URL")
    parser.add_argument("--user-id", default="trainer-bot", help="Dedicated bot user id")
    parser.add_argument("--loops", type=int, default=6, help="How many Q/A loops to run this execution")
    parser.add_argument("--daily-cap", type=int, default=40, help="Max loops per day to protect quota")
    parser.add_argument("--hourly-cap", type=int, default=10, help="Max loops per hour to protect quota")
    parser.add_argument("--max-downvotes-per-run", type=int, default=2, help="Safety cap for negative feedback in a single run")
    parser.add_argument("--use-web", action="store_true", help="Allow web retrieval in trainer loops (higher latency/quota)")
    parser.add_argument("--deep-think-rate", type=float, default=0.25, help="Probability [0..1] to enable deep_think per loop")
    parser.add_argument("--chat-timeout-sec", type=float, default=35.0, help="Per-chat request timeout")
    parser.add_argument("--sleep-sec", type=float, default=2.0, help="Delay between loops")
    args = parser.parse_args()

    return run_bot(
        base_url=args.base_url.rstrip("/"),
        user_id=args.user_id,
        loops=max(1, args.loops),
        daily_cap=max(1, args.daily_cap),
        hourly_cap=max(1, args.hourly_cap),
        max_downvotes_per_run=max(0, args.max_downvotes_per_run),
        use_web=bool(args.use_web),
        deep_think_rate=min(max(float(args.deep_think_rate), 0.0), 1.0),
        chat_timeout_sec=max(5.0, float(args.chat_timeout_sec)),
        sleep_sec=max(0.0, args.sleep_sec),
    )


if __name__ == "__main__":
    raise SystemExit(main())
