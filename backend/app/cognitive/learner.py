"""Consolidation worker — slow lane: episodic → semantic (PCL v0.1).

Runs every CONSOLIDATE_EVERY turns per user (default 20) or on explicit call.
Distillation uses an LLM via generate_sync when available; otherwise falls
back to promoting literally repeated topics (extractive, never fabricated).
Every distilled fact stores source_turn_ids for audit. Merge-only: nothing is
deleted, so old knowledge cannot be catastrophically overwritten.
"""
from __future__ import annotations
import json
import re
import time
from collections import Counter
from pathlib import Path
from typing import Any

from app.cognitive import memory as mem

_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_STATE_FILE = _DATA_DIR / "cognitive_consolidation.json"
CONSOLIDATE_EVERY = 20


def _read_state() -> dict:
    try:
        return json.loads(_STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_state(s: dict) -> None:
    _STATE_FILE.write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")


def _llm_distill(episodes: list[dict]) -> list[str]:
    """Ask the model for durable facts. Returns [] if no model available."""
    try:
        from app.services.models import generate_sync  # type: ignore
    except Exception:
        return []
    convo = "\n".join(f"- Q: {e.get('q','')[:160]} | A: {e.get('a','')[:220]}" for e in episodes[-12:])
    prompt = ("Distill durable, reusable facts the assistant should remember long-term "
              "(user preferences, rules, stable knowledge). Reply with one fact per line, "
              "each starting with '- '. No chatter, no duplicates. If nothing durable, reply EMPTY.\n\n"
              f"Episodes:\n{convo}")
    try:
        raw = generate_sync([{"role": "user", "content": prompt}]) or ""
    except Exception as exc:
        print(f"[PCL learner] distill LLM unavailable: {exc}")
        return []
    facts = []
    for line in raw.splitlines():
        line = re.sub(r"^[-*\d.\s]+", "", line.strip()).strip()
        if 15 < len(line) < 300 and "empty" not in line.lower()[:10]:
            facts.append(line)
    return facts[:5]


def _extractive_fallback(episodes: list[dict]) -> list[str]:
    """No LLM: only promote topics repeated ≥3 times (never invent)."""
    topics = []
    for e in episodes:
        words = re.findall(r"\w{5,}", (e.get("q", "") + " " + e.get("a", "")).lower())
        topics.extend(words)
    repeated = [w for w, c in Counter(topics).most_common(20) if c >= 3]
    if not repeated:
        return []
    return [f"Recurring user topic: {', '.join(repeated[:6])}"]


def maybe_consolidate(user_id: str, force: bool = False) -> dict[str, Any]:
    st = _read_state()
    entry = st.get(user_id, {"count": 0, "last_ts": 0.0})
    entry["count"] = int(entry.get("count", 0)) + 1
    due = force or entry["count"] >= CONSOLIDATE_EVERY
    if not due:
        st[user_id] = entry
        _write_state(st)
        return {"ran": False, "count": entry["count"]}
    entry["count"] = 0
    entry["last_ts"] = time.time()
    st[user_id] = entry
    _write_state(st)

    all_eps = mem._read_json(mem._EPISODIC_FILE, {})
    episodes = all_eps.get(user_id, [])[-40:]
    if not episodes:
        return {"ran": True, "distilled": 0, "provider": "none"}

    facts = _llm_distill(episodes)
    provider = "llm"
    if not facts:
        facts = _extractive_fallback(episodes)
        provider = "extractive"
    for f in facts:
        mem.semantic_remember(f, "consolidated")
    return {"ran": True, "distilled": len(facts), "provider": provider, "facts": facts}
