from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, cast

try:
    import firebase_admin  # type: ignore[import-untyped]
    from firebase_admin import credentials, firestore  # type: ignore[import-untyped]
except Exception:
    firebase_admin = None  # type: ignore[assignment]
    credentials = None  # type: ignore[assignment]
    firestore = None  # type: ignore[assignment]


_LOCAL_STORE: dict[str, dict[str, list[dict[str, str]]]] = {}
_SESSION_META: dict[str, dict[str, str]] = {}  # user_id -> session_id -> preview
_STORE_LOCK = Lock()
_LOCAL_STORE_FILE = Path(__file__).resolve().parents[2] / "data" / "chat_store.json"


def _load_local_store() -> None:
    if not _LOCAL_STORE_FILE.exists():
        return
    try:
        payload_raw = json.loads(_LOCAL_STORE_FILE.read_text(encoding="utf-8"))
        if not isinstance(payload_raw, dict):
            return
        payload = cast(dict[str, Any], payload_raw)
        store = payload.get("local_store")
        meta = payload.get("session_meta")
        if isinstance(store, dict):
            _LOCAL_STORE.update(cast(dict[str, dict[str, list[dict[str, str]]]], store))
        if isinstance(meta, dict):
            _SESSION_META.update(cast(dict[str, dict[str, str]], meta))
    except Exception:
        return


def _persist_local_store() -> None:
    _LOCAL_STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "local_store": _LOCAL_STORE,
        "session_meta": _SESSION_META,
    }
    temp_file = _LOCAL_STORE_FILE.with_suffix(".tmp")
    temp_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temp_file.replace(_LOCAL_STORE_FILE)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _firebase_client() -> Any | None:
    if firebase_admin is None or credentials is None or firestore is None:
        return None

    service_account_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
    resolved_service_account_path = None
    if service_account_path:
        candidate = Path(service_account_path)
        if not candidate.is_absolute():
            repo_root = Path(__file__).resolve().parents[3]
            candidate = repo_root / candidate
        resolved_service_account_path = str(candidate)
    project_id = os.getenv("FIREBASE_PROJECT_ID")
    client_email = os.getenv("FIREBASE_CLIENT_EMAIL")
    private_key = os.getenv("FIREBASE_PRIVATE_KEY")

    if not getattr(firebase_admin, "_apps", {}):
        try:
            fb_admin = cast(Any, firebase_admin)
            if resolved_service_account_path and os.path.exists(resolved_service_account_path):
                fb_admin.initialize_app(credentials.Certificate(resolved_service_account_path))
            elif project_id and client_email and private_key:
                fb_admin.initialize_app(
                    credentials.Certificate(
                        {
                            "type": "service_account",
                            "project_id": project_id,
                            "private_key": private_key.replace("\\n", "\n"),
                            "client_email": client_email,
                            "token_uri": "https://oauth2.googleapis.com/token",
                        }
                    )
                )
            else:
                return None
        except ValueError:
            # App already initialized (race condition) — just continue
            pass

    return firestore.client()


def get_firestore_client() -> Any | None:
    """Public wrapper for services that need the shared Firestore client logic."""
    return _firebase_client()


def firestore_health() -> dict[str, Any]:
    """Report Firestore readiness without raising.

    This is the persistence backend for chat history and (as a fallback) the
    knowledge vault. When it is NOT ok, both fall back to an on-disk JSON file
    that is wiped on every Render restart/redeploy — i.e. history would be lost.
    """
    if firebase_admin is None or credentials is None or firestore is None:
        return {"configured": False, "ok": False, "error": "firebase_admin_not_installed"}

    has_inline_creds = bool(
        os.getenv("FIREBASE_PROJECT_ID")
        and os.getenv("FIREBASE_CLIENT_EMAIL")
        and os.getenv("FIREBASE_PRIVATE_KEY")
    )
    has_sa_file = bool(os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH"))
    if not (has_inline_creds or has_sa_file):
        return {"configured": False, "ok": False, "error": "missing_FIREBASE_credentials"}

    try:
        client = _firebase_client()
        if client is None:
            return {"configured": True, "ok": False, "error": "client_init_failed"}
        # Lightweight connectivity probe: reading an empty collection succeeds
        # quickly when credentials + network are valid.
        list(client.collection("__health__").limit(1).stream())
        return {"configured": True, "ok": True, "error": ""}
    except Exception as exc:
        return {"configured": True, "ok": False, "error": str(exc)}


_load_local_store()


def _save_local_message(user_id: str, session_id: str, role: str, text: str, entry: dict[str, Any]) -> None:
    with _STORE_LOCK:
        user_sessions = _LOCAL_STORE.setdefault(user_id, {})
        user_sessions.setdefault(session_id, []).append(entry)
        if role == "user":
            meta = _SESSION_META.setdefault(user_id, {})
            if session_id not in meta:
                meta[session_id] = text[:120]
        _persist_local_store()


def _list_local_sessions(user_id: str) -> list[dict[str, str | int]]:
    with _STORE_LOCK:
        user_sessions = _LOCAL_STORE.get(user_id, {})
        output: list[dict[str, str | int]] = []
        user_meta = _SESSION_META.get(user_id, {})
        for session_id, messages in user_sessions.items():
            last_updated = messages[-1]["created_at"] if messages else _now_iso()
            first_user = user_meta.get(session_id, "")
            output.append(
                {
                    "session_id": session_id,
                    "last_updated": last_updated,
                    "message_count": len(messages),
                    "preview": first_user,
                }
            )
        return sorted(output, key=lambda item: str(item["last_updated"]), reverse=True)


def _get_local_transcript(user_id: str, session_id: str) -> list[dict[str, str]]:
    with _STORE_LOCK:
        return list(_LOCAL_STORE.get(user_id, {}).get(session_id, []))


def save_message(
    user_id: str,
    session_id: str,
    role: str,
    text: str,
    *,
    thinking: str = "",
    confidence: str = "",
    sources: list[dict[str, str]] | None = None,
    images: list[dict[str, str]] | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    timestamp = _now_iso()
    entry: dict[str, Any] = {"role": role, "text": text, "created_at": timestamp}
    if thinking:
        entry["thinking"] = thinking
    if confidence:
        entry["confidence"] = confidence
    if sources:
        entry["sources"] = sources
    if images:
        entry["images"] = images
    if metadata:
        entry["metadata"] = metadata

    client = _firebase_client()
    if client:
        try:
            doc_ref = (
                client.collection("users")
                .document(user_id)
                .collection("sessions")
                .document(session_id)
                .collection("messages")
                .document()
            )
            doc_ref.set(entry)

            session_ref = (
                client.collection("users")
                .document(user_id)
                .collection("sessions")
                .document(session_id)
            )
            session_update: dict[str, str] = {"last_updated": timestamp}
            if role == "user":
                session_doc = session_ref.get()
                existing: dict[str, Any] = cast(dict[str, Any], (session_doc.to_dict() or {})) if session_doc.exists else {}
                if "preview" not in existing:
                    session_update["preview"] = text[:120]
            session_ref.set(session_update, merge=True)
            return
        except Exception:
            print("warning: firestore save failed; using local store")

    _save_local_message(user_id, session_id, role, text, entry)


def list_sessions(user_id: str) -> list[dict[str, str | int]]:
    client = _firebase_client()
    if client:
        try:
            sessions_ref = (
                client.collection("users")
                .document(user_id)
                .collection("sessions")
                .stream()
            )

            sessions: list[dict[str, str | int]] = []
            for session in sessions_ref:
                data: dict[str, Any] = cast(dict[str, Any], session.to_dict() or {})
                messages_count = len(
                    list(
                        client.collection("users")
                        .document(user_id)
                        .collection("sessions")
                        .document(session.id)
                        .collection("messages")
                        .limit(200)
                        .stream()
                    )
                )
                sessions.append(
                    {
                        "session_id": session.id,
                        "last_updated": data.get("last_updated", _now_iso()),
                        "message_count": messages_count,
                        "preview": data.get("preview", ""),
                    }
                )
            return sorted(sessions, key=lambda item: str(item["last_updated"]), reverse=True)
        except Exception:
            print("warning: firestore list failed; using local store")

    return _list_local_sessions(user_id)


def get_transcript(user_id: str, session_id: str) -> list[dict[str, Any]]:
    client = _firebase_client()
    if client:
        try:
            docs = (
                client.collection("users")
                .document(user_id)
                .collection("sessions")
                .document(session_id)
                .collection("messages")
                .order_by("created_at")
                .stream()
            )
            return [doc.to_dict() for doc in docs]
        except Exception:
            print("warning: firestore transcript failed; using local store")

    return _get_local_transcript(user_id, session_id)



def get_chat_history(user_id: str, session_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """Return recent chat history in chronological order."""
    history = get_transcript(user_id, session_id)
    if limit <= 0:
        return history
    return history[-limit:]


def rename_session(user_id: str, session_id: str, preview: str) -> None:
    client = _firebase_client()
    if client:
        try:
            client.collection("users").document(user_id).collection("sessions").document(session_id).set({"preview": preview, "last_updated": _now_iso()}, merge=True)
            return
        except Exception:
            print("warning: firestore rename failed; using local store")
    with _STORE_LOCK:
        _SESSION_META.setdefault(user_id, {})[session_id] = preview
        _persist_local_store()


def delete_session(user_id: str, session_id: str) -> None:
    client = _firebase_client()
    if client:
        try:
            session_ref = client.collection("users").document(user_id).collection("sessions").document(session_id)
            for doc in session_ref.collection("messages").limit(500).stream():
                doc.reference.delete()
            session_ref.delete()
            return
        except Exception:
            print("warning: firestore delete failed; using local store")
    with _STORE_LOCK:
        _LOCAL_STORE.get(user_id, {}).pop(session_id, None)
        _SESSION_META.get(user_id, {}).pop(session_id, None)
        _persist_local_store()
