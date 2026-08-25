"""Platform routes: memory transparency, scheduled jobs, share snapshots.

All storage is local-file based (backend/data/*.json) so the whole platform
runs free with zero infrastructure.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

try:
    from app.services.push_notify import send_test_push as _push
except Exception:  # pragma: no cover
    def _push(user_id: str, title: str, body: str) -> dict[str, Any]:
        return {"ok": False}

router = APIRouter()

_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_LEARNED_FILE = _DATA_DIR / "credon_learned.json"
_JOBS_FILE = _DATA_DIR / "scheduled_jobs.json"
_SHARES_FILE = _DATA_DIR / "shares.json"

_lock = threading.Lock()


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Memory transparency ─────────────────────────────────────────

@router.get("/memory/{user_id}")
def list_memory(user_id: str, limit: int = 60) -> dict[str, Any]:
    """What Credon has learned — full transparency, editable."""
    entries = _read_json(_LEARNED_FILE, [])
    items: list[dict[str, Any]] = []
    for idx, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        if entry.get("user_id") and entry.get("user_id") != user_id:
            continue
        items.append(
            {
                "id": str(idx),
                "question": str(entry.get("question", ""))[:160],
                "answer": str(entry.get("answer", ""))[:220],
                "ts": entry.get("ts") or entry.get("timestamp") or "",
            }
        )
    return {"items": items[-limit:], "total": len(items)}


@router.delete("/memory/{user_id}/{item_id}")
def forget_memory(user_id: str, item_id: str) -> dict[str, Any]:
    with _lock:
        entries = _read_json(_LEARNED_FILE, [])
        try:
            idx = int(item_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid id")
        if 0 <= idx < len(entries):
            entries.pop(idx)
            _write_json(_LEARNED_FILE, entries)
            return {"ok": True}
    raise HTTPException(status_code=404, detail="not found")


# ── Scheduled jobs ───────────────────────────────────────────────

class JobCreate(BaseModel):
    user_id: str
    goal: str = Field(min_length=3, max_length=400)
    run_at: str  # ISO datetime
    repeat: str = "once"  # once | daily | weekly


@router.post("/schedule")
def create_job(job: JobCreate) -> dict[str, Any]:
    with _lock:
        jobs = _read_json(_JOBS_FILE, [])
        entry = {
            "id": uuid.uuid4().hex[:12],
            "user_id": job.user_id,
            "goal": job.goal,
            "run_at": job.run_at,
            "repeat": job.repeat,
            "status": "pending",
            "created_at": _now_iso(),
            "last_run": "",
        }
        jobs.append(entry)
        _write_json(_JOBS_FILE, jobs)
        return entry


@router.get("/schedule/{user_id}")
def list_jobs(user_id: str) -> dict[str, Any]:
    jobs = [j for j in _read_json(_JOBS_FILE, []) if isinstance(j, dict) and j.get("user_id") == user_id]
    return {"jobs": jobs}


@router.delete("/schedule/{job_id}")
def delete_job(job_id: str) -> dict[str, Any]:
    with _lock:
        jobs = _read_json(_JOBS_FILE, [])
        remaining = [j for j in jobs if j.get("id") != job_id]
        if len(remaining) != len(jobs):
            _write_json(_JOBS_FILE, remaining)
            return {"ok": True}
    raise HTTPException(status_code=404, detail="not found")


def run_due_jobs() -> int:
    """Execute pending jobs whose time has arrived.

    Called opportunistically on health checks. Uses the agent pipeline
    for the goal, then pushes a notification via FCM (best effort).
    Returns number of jobs run.
    """
    now = datetime.now(timezone.utc)
    ran = 0
    with _lock:
        jobs = _read_json(_JOBS_FILE, [])
        changed = False
        for job in jobs:
            if job.get("status") != "pending":
                continue
            try:
                due = datetime.fromisoformat(str(job.get("run_at")).replace("Z", "+00:00"))
            except Exception:
                job["status"] = "error"
                changed = True
                continue
            if due > now:
                continue
            job["status"] = "running"
            changed = True
            _write_json(_JOBS_FILE, jobs)
            result = ""
            try:
                from app.routes.agent import run_job_sync

                result = run_job_sync(str(job.get("user_id")), str(job.get("goal", "")))[:3500]
            except Exception as exc:
                result = f"Job failed: {exc}"
            job["last_run"] = _now_iso()
            job["result_preview"] = result[:300]
            job["status"] = "done" if job.get("repeat") == "once" else "pending"
            if job.get("repeat") == "daily":
                job["run_at"] = due.replace(day=due.day + 1).isoformat() if due.day < 28 else _now_iso()
            changed = True
            ran += 1
            try:
                _push(str(job.get("user_id")), "Credon job finished", result[:180] or "Your scheduled task completed.")
            except Exception:
                pass
        if changed:
            _write_json(_JOBS_FILE, jobs)
    return ran


@router.get("/schedule/{user_id}/results")
def job_results(user_id: str) -> dict[str, Any]:
    jobs = [
        j for j in _read_json(_JOBS_FILE, [])
        if isinstance(j, dict) and j.get("user_id") == user_id and j.get("status") == "done"
    ]
    return {"jobs": jobs[-10:]}


# ── Share snapshots ──────────────────────────────────────────────

class ShareCreate(BaseModel):
    user_id: str
    title: str = ""
    messages: list[dict[str, Any]]


@router.post("/share")
def create_share(payload: ShareCreate) -> dict[str, Any]:
    share_id = uuid.uuid4().hex[:10]
    with _lock:
        shares = _read_json(_SHARES_FILE, {})
        shares[share_id] = {
            "id": share_id,
            "title": payload.title[:90] or "Credon conversation",
            "user_id": payload.user_id,
            "messages": payload.messages[:60],
            "created_at": _now_iso(),
        }
        _write_json(_SHARES_FILE, shares)
    return {"id": share_id, "url": f"/share/{share_id}"}


@router.get("/share/{share_id}")
def get_share(share_id: str):
    shares = _read_json(_SHARES_FILE, {})
    share = shares.get(share_id)
    if not share:
        raise HTTPException(status_code=404, detail="Share not found")
    return JSONResponse(share)
