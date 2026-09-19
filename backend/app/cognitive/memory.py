"""Multi-timescale memory — real vector recall (PCL v0.1).

Timescales (enforced update rates, see UPDATE_RATES):
  working  (seconds)  — in-RAM deque, TTL 90s, rate 1.0
  task     (minutes)  — in-RAM per user+session, rate 0.5
  episodic (days)     — Chroma cosine index + JSON append-only truth, rate 0.2
  semantic (months)   — Chroma cosine index + JSON merge-only truth, rate 0.05
  identity (slowest)  — JSON user model, merge-only, rate 0.01

REAL vs previous scaffold: recall is cosine similarity over embeddings
(sentence_transformers > Ollama > hashing fallback — see vectors.py),
fused with recency (episodic) or confidence (semantic). No keyword overlap.
JSON files stay the durable source of truth; Chroma is a rebuildable index.
"""
from __future__ import annotations
import json
import re
import time
import uuid
from collections import deque
from pathlib import Path
from threading import RLock
from typing import Any

from app.cognitive import vectors as vec

_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_DATA_DIR.mkdir(parents=True, exist_ok=True)
_EPISODIC_FILE = _DATA_DIR / "cognitive_episodic.json"
_SEMANTIC_FILE = _DATA_DIR / "cognitive_semantic.json"
_USERMODEL_FILE = _DATA_DIR / "cognitive_users.json"

_LOCK = RLock()
_WORKING: dict[str, deque] = {}
_TASK: dict[str, list] = {}

UPDATE_RATES = {"working": 1.0, "task": 0.5, "episodic": 0.2, "semantic": 0.05, "identity": 0.01}
WORKING_TTL = 90.0
WORKING_MAX = 30
SEMANTIC_DEDUP_COSINE = 0.92  # above this: same fact → bump confidence, never duplicate


def _read_json(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    return default


def _write_json(path: Path, payload: Any) -> None:
    with _LOCK:
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


# ── working memory (fast, unchanged) ──
def working_push(user_id: str, item: dict[str, Any]) -> list[dict[str, Any]]:
    with _LOCK:
        dq = _WORKING.setdefault(user_id, deque(maxlen=WORKING_MAX))
        dq.append((time.time(), item))
        now = time.time()
        alive = [it for ts, it in list(dq) if (now - ts) < WORKING_TTL]
        _WORKING[user_id] = deque([(now, it) for it in alive], maxlen=WORKING_MAX)
        return alive


def working_get(user_id: str) -> list[dict[str, Any]]:
    with _LOCK:
        now = time.time()
        return [it for ts, it in list(_WORKING.get(user_id, deque())) if (now - ts) < WORKING_TTL]


# ── task memory (medium, unchanged) ──
def task_push(user_id: str, session_id: str, step: dict[str, Any]) -> list[dict[str, Any]]:
    with _LOCK:
        key = f"{user_id}:{session_id}"
        lst = _TASK.setdefault(key, [])
        lst.append({**step, "ts": time.time()})
        _TASK[key] = lst[-20:]
        return _TASK[key]


def task_get(user_id: str, session_id: str) -> list[dict[str, Any]]:
    return list(_TASK.get(f"{user_id}:{session_id}", []))


# ── episodic memory (vector index + append-only JSON) ──
def _recency(ts: float, now: float | None = None) -> float:
    now = now if now is not None else time.time()
    age_h = max(0.0, (now - ts) / 3600.0)
    return 1.0 / (1.0 + age_h / 24.0)


def episodic_append(user_id: str, query: str, answer: str, surprise: float, meta: dict | None = None) -> str:
    doc_id = f"{user_id}:{uuid.uuid4().hex[:12]}"
    topic = " ".join(re.findall(r"\w{4,}", query.lower())[:6])[:120]
    emb = vec.embed(f"{query}\n{answer[:600]}")
    entry = {"id": doc_id, "q": query[:500], "a": answer[:1500], "topic": topic,
             "surprise": round(float(surprise), 3), "meta": meta or {},
             "ts": time.time(), "emb": emb, "indexed": False}
    with _LOCK:
        all_eps = _read_json(_EPISODIC_FILE, {})
        lst = all_eps.get(user_id, [])
        lst.append(entry)
        all_eps[user_id] = lst[-200:]
        _write_json(_EPISODIC_FILE, all_eps)
    entry["indexed"] = vec.upsert(vec.episodic_collection(), doc_id, emb, {"user_id": user_id})
    if entry["indexed"]:
        with _LOCK:
            all_eps = _read_json(_EPISODIC_FILE, {})
            for e in all_eps.get(user_id, []):
                if e.get("id") == doc_id:
                    e["indexed"] = True
            _write_json(_EPISODIC_FILE, all_eps)
    return doc_id


def _episodic_scan(user_id: str, q_emb: list[float], top_k: int) -> list[tuple[float, dict]]:
    """Fallback when Chroma has no hits: cosine scan over JSON embeddings."""
    all_eps = _read_json(_EPISODIC_FILE, {})
    lst = all_eps.get(user_id, [])
    now = time.time()
    scored = []
    dirty = False
    for e in lst:
        emb = e.get("emb")
        if not emb or len(emb) != len(q_emb):
            emb = vec.embed(f"{e.get('q','')}\n{e.get('a','')[:600]}")
            e["emb"] = emb
            dirty = True
            vec.upsert(vec.episodic_collection(), e.get("id", uuid.uuid4().hex), emb, {"user_id": user_id})
        score = 0.75 * vec.cosine(q_emb, emb) + 0.25 * _recency(float(e.get("ts", now)), now)
        scored.append((score, e))
    if dirty:
        with _LOCK:
            all_eps[user_id] = lst
            _write_json(_EPISODIC_FILE, all_eps)
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:top_k]


def episodic_recall(user_id: str, query: str, top_k: int = 3) -> list[dict[str, Any]]:
    if not (query or "").strip():
        all_eps = _read_json(_EPISODIC_FILE, {})
        return all_eps.get(user_id, [])[-top_k:]
    q_emb = vec.embed(query)
    now = time.time()
    hits = vec.query(vec.episodic_collection(), q_emb, top_k=top_k * 3, where={"user_id": user_id})
    by_id: dict[str, dict] = {}
    if hits:
        all_eps = _read_json(_EPISODIC_FILE, {})
        by_id = {e.get("id", ""): e for e in all_eps.get(user_id, [])}
    scored: list[tuple[float, dict]] = []
    for h in hits:
        e = by_id.get(h["id"])
        if not e:
            continue
        score = 0.75 * float(h["cosine"]) + 0.25 * _recency(float(e.get("ts", now)), now)
        scored.append((score, e))
    if not scored:
        scored = _episodic_scan(user_id, q_emb, top_k)
    scored.sort(key=lambda x: x[0], reverse=True)
    return [e for _, e in scored[:top_k]]


# ── semantic memory (vector index + merge-only JSON) ──
def semantic_remember(fact: str, topic: str = "") -> str:
    fact = fact.strip()[:400]
    if len(fact) < 12:
        return ""
    emb = vec.embed(fact)
    doc_id = hashlib_id(fact)
    with _LOCK:
        sem = _read_json(_SEMANTIC_FILE, [])
        # vector dedup: same meaning → bump confidence, never duplicate/overwrite
        nearest = vec.query(vec.semantic_collection(), emb, top_k=3)
        if nearest:
            by_id = {e.get("id", ""): e for e in sem}
            for h in nearest:
                if float(h["cosine"]) >= SEMANTIC_DEDUP_COSINE and h["id"] in by_id:
                    e = by_id[h["id"]]
                    e["confidence"] = min(1.0, float(e.get("confidence", 0.5)) + 0.05)
                    e["hits"] = int(e.get("hits", 1)) + 1
                    _write_json(_SEMANTIC_FILE, sem)
                    return str(e.get("id", ""))
        for entry in sem:
            if entry.get("fact", "").strip().lower() == fact.lower():
                entry["confidence"] = min(1.0, float(entry.get("confidence", 0.5)) + 0.05)
                entry["hits"] = int(entry.get("hits", 1)) + 1
                if not entry.get("emb"):
                    entry["emb"] = emb
                _write_json(_SEMANTIC_FILE, sem)
                vec.upsert(vec.semantic_collection(), str(entry.get("id", doc_id)), emb, {})
                return str(entry.get("id", ""))
        entry = {"id": doc_id, "fact": fact, "topic": topic[:80],
                 "confidence": 0.55, "hits": 1, "ts": time.time(), "emb": emb}
        sem.append(entry)
        _write_json(_SEMANTIC_FILE, sem[-500:])
    vec.upsert(vec.semantic_collection(), doc_id, emb, {})
    return doc_id


def hashlib_id(text: str) -> str:
    import hashlib as _hl
    return "sem-" + _hl.sha256(text.lower().encode("utf-8")).hexdigest()[:16]


def semantic_recall(query: str, top_k: int = 3) -> list[dict[str, Any]]:
    if not (query or "").strip():
        return []
    q_emb = vec.embed(query)
    sem = _read_json(_SEMANTIC_FILE, [])
    if not sem:
        return []
    by_id = {str(e.get("id", "")): e for e in sem}
    scored: list[tuple[float, dict]] = []
    for h in vec.query(vec.semantic_collection(), q_emb, top_k=top_k * 3):
        e = by_id.get(h["id"])
        if not e:
            continue
        score = 0.7 * float(h["cosine"]) + 0.3 * float(e.get("confidence", 0.5))
        scored.append((score, e))
    if not scored:
        dirty = False
        for e in sem:
            emb = e.get("emb")
            if not emb or len(emb) != len(q_emb):
                emb = vec.embed(e.get("fact", ""))
                e["emb"] = emb
                dirty = True
            score = 0.7 * vec.cosine(q_emb, emb) + 0.3 * float(e.get("confidence", 0.5))
            scored.append((score, e))
        if dirty:
            with _LOCK:
                _write_json(_SEMANTIC_FILE, sem)
    scored.sort(key=lambda x: x[0], reverse=True)
    return [e for _, e in scored[:top_k]]


# ── identity / user model (slowest, merge-only — unchanged semantics) ──
def load_user_model(user_id: str) -> dict[str, Any]:
    all_u = _read_json(_USERMODEL_FILE, {})
    return all_u.get(user_id, {})


def save_user_model(user_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    with _LOCK:
        all_u = _read_json(_USERMODEL_FILE, {})
        cur = all_u.get(user_id, {"interaction_count": 0, "preferences": {},
                                  "past_topics": [], "corrections": []})
        cur["interaction_count"] = int(cur.get("interaction_count", 0)) + 1
        for k, v in (patch.get("preferences") or {}).items():
            cur.setdefault("preferences", {})[k] = v
        for t in patch.get("past_topics", []):
            if t and t not in cur.setdefault("past_topics", []):
                cur["past_topics"].append(t)
            cur["past_topics"] = cur["past_topics"][-30:]
        for c in patch.get("corrections", []):
            cur.setdefault("corrections", []).append(c)
            cur["corrections"] = cur["corrections"][-50:]
        if patch.get("communication_style"):
            cur["communication_style"] = patch["communication_style"]
        cur["last_seen"] = time.time()
        all_u[user_id] = cur
        _write_json(_USERMODEL_FILE, all_u)
        return cur

