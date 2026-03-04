from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Callable, cast

try:
    import firebase_admin  # type: ignore[import-untyped]
    from firebase_admin import credentials, firestore  # type: ignore[import-untyped]
except Exception:
    firebase_admin = None  # type: ignore[assignment]
    credentials = None  # type: ignore[assignment]
    firestore = None  # type: ignore[assignment]

from app.services.models import generate_embedding

_STORE_LOCK = Lock()
_LOCAL_FILE = Path(__file__).resolve().parents[2] / "data" / "knowledge_vectors.json"
_LOCAL_CHUNKS: list[dict[str, Any]] = []


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
            initialize_app = cast(Callable[..., Any], getattr(firebase_admin, "initialize_app"))
            if resolved_service_account_path and os.path.exists(resolved_service_account_path):
                initialize_app(credentials.Certificate(resolved_service_account_path))
            elif project_id and client_email and private_key:
                initialize_app(
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
            pass

    return firestore.client()


def _load_local() -> None:
    if not _LOCAL_FILE.exists():
        return
    try:
        payload = json.loads(_LOCAL_FILE.read_text(encoding="utf-8"))
        chunks_any: Any = payload.get("chunks", [])
        if isinstance(chunks_any, list):
            safe_chunks: list[dict[str, Any]] = []
            for item in cast(list[Any], chunks_any):
                if isinstance(item, dict):
                    safe_chunks.append(cast(dict[str, Any], item))
            _LOCAL_CHUNKS.extend(safe_chunks)
    except Exception:
        return


def _persist_local() -> None:
    _LOCAL_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload = {"chunks": _LOCAL_CHUNKS}
    temp_file = _LOCAL_FILE.with_suffix(".tmp")
    temp_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temp_file.replace(_LOCAL_FILE)


def _chunk_text(text: str, chunk_size: int = 900, overlap: int = 140) -> list[str]:
    cleaned = " ".join(text.split())
    if not cleaned:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + chunk_size)
        chunks.append(cleaned[start:end])
        if end >= len(cleaned):
            break
        start = max(0, end - overlap)
    return chunks


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    size = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(size))
    na = math.sqrt(sum(x * x for x in a[:size])) or 1.0
    nb = math.sqrt(sum(x * x for x in b[:size])) or 1.0
    return dot / (na * nb)


def _to_float_list(values: Any) -> list[float]:
    if not isinstance(values, list):
        return []
    numeric: list[float] = []
    for value in cast(list[Any], values):
        if isinstance(value, (int, float)):
            numeric.append(float(value))
    return numeric


def _append_local_chunk(
    user_id: str,
    document_id: str,
    chunk_index: int,
    text: str,
    embedding: list[float],
    source_type: str,
    filename: str,
) -> None:
    _LOCAL_CHUNKS.append(
        {
            "id": f"{document_id}_{chunk_index}",
            "user_id": user_id,
            "document_id": document_id,
            "chunk_index": chunk_index,
            "text": text,
            "embedding": embedding,
            "source_type": source_type,
            "filename": filename,
            "created_at": _now_iso(),
        }
    )


def _local_retrieve_scored(query_emb: list[float], user_id: str) -> list[tuple[float, dict[str, Any]]]:
    scored: list[tuple[float, dict[str, Any]]] = []
    with _STORE_LOCK:
        for row in _LOCAL_CHUNKS:
            if row.get("user_id") != user_id:
                continue
            emb_any: Any = row.get("embedding")
            numeric_emb = _to_float_list(emb_any)
            if not numeric_emb:
                continue
            score = _cosine(query_emb, numeric_emb)
            if score > 0.08:
                scored.append((score, row))
    return scored


def ingest_knowledge_text(
    user_id: str,
    document_id: str,
    text: str,
    source_type: str,
    filename: str,
) -> dict[str, int | str]:
    chunks = _chunk_text(text)
    if not chunks:
        return {"document_id": document_id, "chunks": 0, "stored": 0}

    client = _firebase_client()
    stored = 0

    if client:
        try:
            base_ref = (
                client.collection("users")
                .document(user_id)
                .collection("knowledge_chunks")
            )
            for idx, chunk in enumerate(chunks):
                emb = generate_embedding(chunk)
                row: dict[str, Any] = {
                    "user_id": user_id,
                    "document_id": document_id,
                    "chunk_index": idx,
                    "text": chunk,
                    "embedding": emb,
                    "source_type": source_type,
                    "filename": filename,
                    "created_at": _now_iso(),
                }
                base_ref.document(f"{document_id}_{idx}").set(row)
                stored += 1
            return {"document_id": document_id, "chunks": len(chunks), "stored": stored}
        except Exception as exc:
            print(f"[warn] firestore ingest failed, using local store: {exc}")

    with _STORE_LOCK:
        for idx, chunk in enumerate(chunks):
            emb = generate_embedding(chunk)
            _append_local_chunk(
                user_id=user_id,
                document_id=document_id,
                chunk_index=idx,
                text=chunk,
                embedding=emb,
                source_type=source_type,
                filename=filename,
            )
            stored += 1
        _persist_local()

    return {"document_id": document_id, "chunks": len(chunks), "stored": stored}


def retrieve_knowledge_context(user_id: str, query: str, top_k: int = 4) -> list[dict[str, Any]]:
    if not query.strip():
        return []

    query_emb = generate_embedding(query)
    client = _firebase_client()
    scored: list[tuple[float, dict[str, Any]]] = []

    if client:
        try:
            docs = (
                client.collection("users")
                .document(user_id)
                .collection("knowledge_chunks")
                .limit(500)
                .stream()
            )
            for doc in docs:
                raw_row: Any = doc.to_dict()
                if not isinstance(raw_row, dict):
                    continue
                row = cast(dict[str, Any], raw_row)
                emb_any: Any = row.get("embedding")
                numeric_emb = _to_float_list(emb_any)
                if not numeric_emb:
                    continue
                score = _cosine(query_emb, numeric_emb)
                if score > 0.08:
                    scored.append((score, row))
        except Exception as exc:
            print(f"[warn] firestore retrieve failed, using local store: {exc}")
            scored = _local_retrieve_scored(query_emb=query_emb, user_id=user_id)
    else:
        scored = _local_retrieve_scored(query_emb=query_emb, user_id=user_id)

    scored.sort(key=lambda x: x[0], reverse=True)

    results: list[dict[str, Any]] = []
    for score, row in scored[:top_k]:
        file_name = row.get("filename") or "uploaded-document"
        doc_id = row.get("document_id") or "doc"
        chunk_index = row.get("chunk_index") or 0
        text = (row.get("text") or "")[:480]
        results.append(
            {
                "title": f"{file_name} (chunk {chunk_index + 1})",
                "url": f"credon://knowledge/{doc_id}#{chunk_index}",
                "snippet": text,
                "score": round(score, 4),
            }
        )

    return results


_load_local()
