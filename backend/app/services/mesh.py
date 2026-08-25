"""Credon Unlimited Mesh — provider registry, cooldowns, TPM-aware routing.

Design:
- Lanes are data, not code. A bundled default registry plus an optional
  remote registry (checked daily) define every free provider lane.
- On 429/5xx a lane enters exponential cooldown; routing skips it silently.
- Per-lane token windows (rolling 60s) steer selection toward headroom.
- Routing score: 0.35*headroom + 0.25*speed + 0.2*capability + 0.2*(1-cooldown)
- State persists to backend/data/mesh_state.json so restarts keep learning.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any

_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_STATE_FILE = _DATA_DIR / "mesh_state.json"
_REGISTRY_CACHE = _DATA_DIR / "mesh_registry.json"
_REGISTRY_URL_ENV = "MESH_REGISTRY_URL"
_REGISTRY_TTL = 86400.0  # daily

_lock = threading.Lock()

# lane_id → {label, base_url_env, base_url, key_env, models:[{id, speed 0-1, capability 0-1, ctx}], rpm, tpm}
DEFAULT_REGISTRY: dict[str, Any] = {
    "version": 3,
    "lanes": {
        "groq": {
            "label": "Groq",
            "base_url": "https://api.groq.com/openai/v1",
            "key_env": "GROQ_API_KEY",
            "rpm": 30,
            "tpm": 12000,
            "models": [
                {"id": "llama-3.3-70b-versatile", "speed": 0.98, "capability": 0.86},
                {"id": "openai/gpt-oss-120b", "speed": 0.95, "capability": 0.9},
                {"id": "openai/gpt-oss-20b", "speed": 0.99, "capability": 0.78},
                {"id": "deepseek-r1-distill-llama-70b", "speed": 0.9, "capability": 0.88},
            ],
        },
        "gemini": {
            "label": "Gemini",
            "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
            "key_env": "GEMINI_API_KEY",
            "rpm": 10,
            "tpm": 250000,
            "models": [
                {"id": "gemini-2.5-flash", "speed": 0.85, "capability": 0.9},
                {"id": "gemini-2.0-flash", "speed": 0.88, "capability": 0.84},
            ],
        },
        "openrouter": {
            "label": "OpenRouter",
            "base_url": "https://openrouter.ai/api/v1",
            "key_env": "OPENROUTER_API_KEY",
            "rpm": 20,
            "tpm": 40000,
            "models": [
                {"id": "deepseek/deepseek-r1:free", "speed": 0.6, "capability": 0.92},
                {"id": "meta-llama/llama-3.3-70b-instruct:free", "speed": 0.75, "capability": 0.86},
                {"id": "qwen/qwen3-235b-a22b:free", "speed": 0.65, "capability": 0.9},
            ],
        },
        "nvidia": {
            "label": "NVIDIA NIM",
            "base_url": "https://integrate.api.nvidia.com/v1",
            "key_env": "NVIDIA_API_KEY",
            "rpm": 40,
            "tpm": 100000,
            "models": [
                {"id": "meta/llama-3.3-70b-instruct", "speed": 0.8, "capability": 0.86},
                {"id": "meta/llama-3.1-405b-instruct", "speed": 0.55, "capability": 0.93},
                {"id": "deepseek-ai/deepseek-r1", "speed": 0.5, "capability": 0.93},
            ],
        },
        "cerebras": {
            "label": "Cerebras",
            "base_url": "https://api.cerebras.ai/v1",
            "key_env": "CEREBRAS_API_KEY",
            "rpm": 30,
            "tpm": 60000,
            "models": [
                {"id": "gpt-oss-120b", "speed": 1.0, "capability": 0.9},
                {"id": "llama-3.3-70b", "speed": 1.0, "capability": 0.85},
                {"id": "llama3.1-8b", "speed": 1.0, "capability": 0.72},
            ],
        },
        "mistral": {
            "label": "Mistral",
            "base_url": "https://api.mistral.ai/v1",
            "key_env": "MISTRAL_API_KEY",
            "rpm": 20,
            "tpm": 50000,
            "models": [
                {"id": "mistral-small-latest", "speed": 0.82, "capability": 0.84},
                {"id": "mistral-large-latest", "speed": 0.6, "capability": 0.9},
            ],
        },
        "zai": {
            "label": "Z.ai",
            "base_url": "https://api.z.ai/api/paas/v4",
            "key_env": "ZAI_API_KEY",
            "rpm": 15,
            "tpm": 30000,
            "models": [{"id": "glm-4.5-flash", "speed": 0.85, "capability": 0.82}],
        },
    },
}


def _load_state() -> dict[str, Any]:
    try:
        return json.loads(_STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"cooldowns": {}, "windows": {}, "ttfa": {}, "success": {}}


def _save_state(state: dict[str, Any]) -> None:
    try:
        _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _STATE_FILE.write_text(json.dumps(state), encoding="utf-8")
    except Exception:
        pass


def registry() -> dict[str, Any]:
    """Bundled defaults, overridden by a cached remote registry when fresh."""
    with _lock:
        try:
            cached = json.loads(_REGISTRY_CACHE.read_text(encoding="utf-8"))
            if time.time() - cached.get("_fetched", 0) < _REGISTRY_TTL:
                return cached.get("data") or DEFAULT_REGISTRY
        except Exception:
            pass
    # refresh remote in background-ish (non-blocking failures)
    url = os.getenv(_REGISTRY_URL_ENV, "").strip()
    if url:
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:  # noqa: S310
                data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, dict) and isinstance(data.get("lanes"), dict):
                with _lock:
                    _REGISTRY_CACHE.parent.mkdir(parents=True, exist_ok=True)
                    _REGISTRY_CACHE.write_text(
                        json.dumps({"_fetched": time.time(), "data": data}), encoding="utf-8"
                    )
                return data
        except Exception:
            pass
    return DEFAULT_REGISTRY


def lane_credentials(lane_id: str) -> tuple[str, str, dict[str, Any]]:
    """Return (api_key, base_url, lane_def) for a lane, or ("", "", {}) when unconfigured."""
    lane = registry()["lanes"].get(lane_id)
    if not lane:
        return "", "", {}
    api_key = os.getenv(lane.get("key_env", ""), "").strip()
    base_url = lane.get("base_url", "").rstrip("/")
    return api_key, base_url, lane


def active_lanes() -> list[str]:
    """Lane ids that have a key configured right now."""
    return [lane_id for lane_id in registry()["lanes"] if lane_credentials(lane_id)[0]]


def _window_usage(lane_id: str) -> tuple[float, float]:
    """(tokens_used_in_last_60s, requests_in_last_60s)"""
    with _lock:
        state = _load_state()
        window = state.get("windows", {}).get(lane_id, [])
        now = time.time()
        recent = [entry for entry in window if now - entry.get("t", 0) < 60]
    return sum(e.get("tokens", 0) for e in recent), float(len(recent))


def record_usage(lane_id: str, tokens: int) -> None:
    with _lock:
        state = _load_state()
        windows = state.setdefault("windows", {})
        entries = windows.setdefault(lane_id, [])
        entries.append({"t": time.time(), "tokens": tokens})
        windows[lane_id] = [e for e in entries if time.time() - e.get("t", 0) < 120]
        _save_state(state)


def report_cooldown(lane_id: str, status_code: int) -> None:
    """Exponential backoff on rate limits / server errors."""
    with _lock:
        state = _load_state()
        cooldowns = state.setdefault("cooldowns", {})
        prev = float(cooldowns.get(lane_id, 0)) - time.time()
        base = 30.0 if status_code == 429 else 15.0
        penalty = min(max(prev, 0) * 2, 480.0) + base
        cooldowns[lane_id] = time.time() + penalty
        _save_state(state)


def report_success(lane_id: str, ttfa_ms: float) -> None:
    with _lock:
        state = _load_state()
        ttfa = state.setdefault("ttfa", {})
        old = float(ttfa.get(lane_id, 900))
        ttfa[lane_id] = old * 0.7 + ttfa_ms * 0.3  # EWMA
        success = state.setdefault("success", {})
        success[lane_id] = float(success.get(lane_id, 1)) * 0.9 + 0.1
        _save_state(state)


def _cooldown_remaining(lane_id: str) -> float:
    with _lock:
        state = _load_state()
        until = float(state.get("cooldowns", {}).get(lane_id, 0))
    return max(0.0, until - time.time())


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def pick_model_for_task(lane_id: str, task: str, prefer_capability: bool = False) -> dict[str, Any] | None:
    lane = registry()["lanes"].get(lane_id) or {}
    models = lane.get("models") or []
    if not models:
        return None
    coding = any(k in task.lower() for k in ("code", "debug", "function", "python", "typescript", "sql"))
    reasoning = any(k in task.lower() for k in ("reason", "math", "prove", "analyze", "research"))
    pool = models
    if coding or reasoning or prefer_capability:
        ranked = sorted(pool, key=lambda m: (m.get("capability", 0.8), m.get("speed", 0.8)), reverse=True)
        return ranked[0]
    ranked = sorted(pool, key=lambda m: (m.get("speed", 0.8) * 0.6 + m.get("capability", 0.8) * 0.4), reverse=True)
    return ranked[0]


def route(task: str, tokens_needed: int, prefer_capability: bool = False) -> list[dict[str, Any]]:
    """Return lane candidates ordered by routing score, cooldowns filtered out."""
    candidates: list[dict[str, Any]] = []
    for lane_id, lane in registry()["lanes"].items():
        api_key, _, _ = lane_credentials(lane_id)
        if not api_key:
            continue
        cooldown = _cooldown_remaining(lane_id)
        if cooldown > 0:
            continue
        tokens_used, reqs_used = _window_usage(lane_id)
        tpm = float(lane.get("tpm", 30000))
        rpm = float(lane.get("rpm", 30))
        headroom = max(0.0, 1.0 - (tokens_used / max(tpm, 1))) * 0.7 + max(0.0, 1.0 - (reqs_used / max(rpm, 1))) * 0.3
        model = pick_model_for_task(lane_id, task, prefer_capability)
        if not model:
            continue
        with _lock:
            state = _load_state()
        ttfa = float(state.get("ttfa", {}).get(lane_id, 900))
        speed = max(0.05, min(1.0, 1200.0 / max(ttfa, 120.0)))
        success = float(state.get("success", {}).get(lane_id, 1.0))
        score = (
            0.35 * headroom
            + 0.25 * speed
            + 0.20 * float(model.get("capability", 0.8))
            + 0.20 * min(1.0, success)
        )
        candidates.append(
            {
                "lane": lane_id,
                "label": lane.get("label", lane_id),
                "model": model["id"],
                "score": round(score, 4),
                "headroom": round(headroom, 3),
                "ttfa_ms": int(ttfa),
            }
        )
    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates


def mesh_status() -> dict[str, Any]:
    lanes = []
    for lane_id, lane in registry()["lanes"].items():
        api_key, _, _ = lane_credentials(lane_id)
        cooldown = _cooldown_remaining(lane_id)
        used, reqs = _window_usage(lane_id)
        with _lock:
            state = _load_state()
        lanes.append(
            {
                "id": lane_id,
                "label": lane.get("label", lane_id),
                "configured": bool(api_key),
                "cooldown_sec": int(cooldown),
                "tokens_last_60s": int(used),
                "tpm_limit": lane.get("tpm"),
                "ttfa_ms": int(state.get("ttfa", {}).get(lane_id, 0)) or None,
            }
        )
    return {
        "lanes": lanes,
        "registry_version": registry().get("version"),
        "remote_registry": bool(os.getenv(_REGISTRY_URL_ENV, "").strip()),
    }
