"""Owner-only routes for Credon's self-improvement loop.

Gated by OWNER_EMAIL allowlist — no separate admin login. The section
simply doesn't exist for anyone else, and mutations require the owner email.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import github_svc, self_evolve

router = APIRouter()


def _require_owner(email: str) -> None:
    owner = os.getenv("OWNER_EMAIL", "").strip().lower()
    if not owner or email.strip().lower() != owner:
        raise HTTPException(status_code=403, detail="Owner access required")


@router.get("/system/status")
def system_status(email: str = "") -> dict[str, Any]:
    _require_owner(email)
    repo_ok, repo_note = github_svc.repo_accessible()
    return {
        "github": {"connected": repo_ok, "note": repo_note, "repo": github_svc.repo()},
        "autopilot": os.getenv("SELF_EVOLVE_AUTOPILOT", "false").lower() == "true",
        "daily_cap": int(os.getenv("SELF_EVOLVE_DAILY_CAP", "1")),
        "signals": self_evolve.signal_summary(),
        "log": self_evolve.evolve_log(),
        "prs_today": self_evolve._daily_pr_count(),
    }


@router.post("/system/evolve")
def run_evolve(email: str = "") -> dict[str, Any]:
    _require_owner(email)
    if os.getenv("SELF_EVOLVE_ENABLED", "true").lower() != "true":
        raise HTTPException(status_code=403, detail="Self-evolution disabled")
    return self_evolve.run_evolve_cycle()


class SignalIn(BaseModel):
    kind: str = Field(pattern="^(thumbs_down|error|failed_query|regenerate|slow)$")
    detail: str = Field(min_length=1, max_length=600)
    user_id: str = ""


@router.post("/system/signal")
def add_signal(signal: SignalIn) -> dict[str, str]:
    """Open to the app (not owner-gated): the ledger grows from real usage."""
    self_evolve.record_signal(signal.kind, signal.detail, signal.user_id)
    return {"ok": "true"}


@router.post("/system/autopilot")
def set_autopilot(email: str = "", enabled: bool = False) -> dict[str, Any]:
    _require_owner(email)
    # Runtime toggle (env remains the source of truth across restarts)
    os.environ["SELF_EVOLVE_AUTOPILOT"] = "true" if enabled else "false"
    return {"ok": True, "autopilot": enabled}
