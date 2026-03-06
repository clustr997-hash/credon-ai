from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, cast

from app.services.chat_store import get_firestore_client

_PUSH_FILE = Path(__file__).resolve().parents[2] / "data" / "push_tokens.json"
_PUSH_LOCK = Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_local() -> dict[str, dict[str, Any]]:
    if not _PUSH_FILE.exists():
        return {}
    try:
        raw = json.loads(_PUSH_FILE.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return cast(dict[str, dict[str, Any]], raw)
    except Exception:
        pass
    return {}


def _save_local(payload: dict[str, dict[str, Any]]) -> None:
    _PUSH_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _PUSH_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(_PUSH_FILE)


def save_user_push_token(user_id: str, token: str, platform: str = "web") -> None:
    now = _now_iso()
    client = get_firestore_client()
    if client:
        try:
            doc_id = token[:24].replace(":", "_").replace("/", "_")
            (
                client.collection("users")
                .document(user_id)
                .collection("push_tokens")
                .document(doc_id)
                .set(
                    {
                        "token": token,
                        "platform": platform,
                        "updated_at": now,
                        "active": True,
                    },
                    merge=True,
                )
            )
            return
        except Exception:
            print("warning: firestore push token save failed; using local store")

    with _PUSH_LOCK:
        store = _load_local()
        user_tokens = store.setdefault(user_id, {})
        user_tokens[token] = {
            "platform": platform,
            "updated_at": now,
            "active": True,
        }
        _save_local(store)


def get_user_push_tokens(user_id: str) -> list[str]:
    client = get_firestore_client()
    if client:
        try:
            docs = (
                client.collection("users")
                .document(user_id)
                .collection("push_tokens")
                .where("active", "==", True)
                .stream()
            )
            tokens: list[str] = []
            for doc in docs:
                data = cast(dict[str, Any], doc.to_dict() or {})
                token = str(data.get("token", "")).strip()
                if token:
                    tokens.append(token)
            if tokens:
                return tokens
        except Exception:
            print("warning: firestore push token fetch failed; using local store")

    with _PUSH_LOCK:
        store = _load_local()
        user_tokens = store.get(user_id, {})
        return [token for token, meta in user_tokens.items() if bool(meta.get("active", True))]
