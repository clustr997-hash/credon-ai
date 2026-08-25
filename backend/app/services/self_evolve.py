"""Signal ledger + self-evolution cycle.

Credon observes its own problems (thumbs-down, errors, failed queries),
clusters them, diagnoses root causes against its own repository, generates
patches, self-checks them, and opens pull requests for the owner to approve.

Guardrails: daily PR cap, forbidden paths, size cap, syntax checks.
The GitHub token never leaves the backend.
"""

from __future__ import annotations

import json
import os
import py_compile
import re
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services import github_svc
from app.services.models import generate_sync

_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_SIGNALS_FILE = _DATA_DIR / "signals.json"
_EVOLVE_LOG = _DATA_DIR / "self_evolve_log.json"

_lock = threading.Lock()

FORBIDDEN_PATHS = [
    r"\.env", r"secrets/", r"firebase-service-account", r"requirements\.txt",
    r"package-lock\.json", r"\.github/", r"Dockerfile", r"\.firebaserc",
]
MAX_CHANGED_LINES = 150


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


# ── signal ledger ───────────────────────────────────────────────

def record_signal(kind: str, detail: str, user_id: str = "", meta: dict[str, Any] | None = None) -> None:
    """ kinds: thumbs_down | error | failed_query | regenerate | slow """
    with _lock:
        signals = _read(_SIGNALS_FILE, [])
        signals.append({
            "id": uuid.uuid4().hex[:10],
            "kind": kind,
            "detail": str(detail)[:600],
            "user_id": user_id[:60],
            "meta": meta or {},
            "ts": _now_iso(),
        })
        _write(_SIGNALS_FILE, signals[-400:])


def signal_summary(limit: int = 40) -> dict[str, Any]:
    signals = _read(_SIGNALS_FILE, [])
    by_kind: dict[str, int] = {}
    for s in signals:
        by_kind[s.get("kind", "?")] = by_kind.get(s.get("kind", "?"), 0) + 1
    recent = [
        {"kind": s.get("kind"), "detail": s.get("detail"), "ts": s.get("ts")}
        for s in signals[-limit:]
    ]
    recent.reverse()
    return {"total": len(signals), "by_kind": by_kind, "recent": recent}


# ── evolve cycle ────────────────────────────────────────────────

def _daily_pr_count() -> int:
    log = _read(_EVOLVE_LOG, [])
    today = datetime.now(timezone.utc).date().isoformat()
    return sum(1 for entry in log if str(entry.get("ts", "")).startswith(today) and entry.get("pr_url"))


def _paths_clean(files: dict[str, str]) -> tuple[bool, str]:
    for path in files:
        for pattern in FORBIDDEN_PATHS:
            if re.search(pattern, path):
                return False, f"forbidden path: {path}"
    total = sum(len(content.splitlines()) for content in files.values())
    if total > MAX_CHANGED_LINES:
        return False, f"patch too large ({total} lines > {MAX_CHANGED_LINES})"
    return True, ""


def _syntax_ok(path: str, content: str) -> bool:
    if not path.endswith(".py"):
        return True
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        py_compile.compile(tmp_path, doraise=True)
        os.unlink(tmp_path)
        return True
    except Exception:
        return False


def _diagnose(summary: dict[str, Any]) -> dict[str, Any] | None:
    """Ask Credon to pick the top issue and propose a patch against its repo."""
    tree = github_svc.list_tree()
    if not tree:
        return None
    interesting = [
        item["path"] for item in tree
        if item["path"].endswith((".py", ".tsx", ".ts", ".css"))
        and "node_modules" not in item["path"] and ".venv" not in item["path"]
    ][:80]

    prompt = f"""You are Credon's self-improvement core. Analyze problems users hit and propose a minimal, safe fix to this repository.

Recent problem signals (JSON):
{json.dumps(summary.get('recent', [])[:20], ensure_ascii=False)[:2500]}

Repository files:
{json.dumps(interesting, indent=0)[:2500]}

Pick the single highest-impact issue you can genuinely fix with a small, safe change.
Respond with ONLY valid JSON:
{{"issue": "one-line description", "evidence": "which signals justify this", "plan": "what you will change and why it is safe",
 "files": {{"path/in/repo": "COMPLETE new file content"}}}}

Rules:
- Change at most 2 files. Prefer 1.
- Python files must be syntactically valid. Never touch .env, secrets, auth, CI, or dependency files.
- Keep total added lines under 120. Preserve existing code style.
- If signals are too vague to act on safely, respond {{"issue": "insufficient signal", "evidence": "...", "plan": "...", "files": {{}}}}"""

    raw = generate_sync([{"role": "user", "content": prompt}])
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        parsed = json.loads(raw[start : end + 1])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def run_evolve_cycle(user_id: str = "owner") -> dict[str, Any]:
    """Full loop: signals → diagnosis → patch → checks → PR."""
    cap = int(os.getenv("SELF_EVOLVE_DAILY_CAP", "1"))
    if _daily_pr_count() >= cap:
        return {"ok": False, "reason": "Daily PR cap reached — Credon stays humble. Resets tomorrow."}

    ok, reason = github_svc.repo_accessible()
    if not ok:
        return {"ok": False, "reason": f"GitHub unavailable: {reason}"}

    summary = signal_summary()
    if summary["total"] < 3:
        return {"ok": False, "reason": "Not enough signals yet — Credon needs more experience before changing itself."}

    diagnosis = _diagnose(summary)
    if not diagnosis:
        record_signal("error", "evolve: diagnosis failed to parse", user_id)
        return {"ok": False, "reason": "Diagnosis failed — will retry next cycle."}

    files: dict[str, str] = diagnosis.get("files") or {}
    if not files:
        return {"ok": True, "action": "none", "reason": diagnosis.get("plan") or "Insufficient signal for a safe change — observing longer."}

    clean, why = _paths_clean(files)
    if not clean:
        record_signal("error", f"evolve: guard blocked patch ({why})", user_id)
        return {"ok": False, "reason": f"Guard blocked patch: {why}"}

    for path, content in files.items():
        if not _syntax_ok(path, content):
            record_signal("error", f"evolve: syntax check failed for {path}", user_id)
            return {"ok": False, "reason": f"Self-check failed: {path} has a syntax error. Patch discarded (this is the guardrail working)."}

    slug = re.sub(r"[^a-z0-9]+", "-", str(diagnosis.get("issue", "fix"))[:40]).strip("-").lower()
    branch = f"credon/fix-{slug or uuid.uuid4().hex[:6]}-{datetime.now(timezone.utc).strftime('%m%d')}"
    if not github_svc.create_branch(branch):
        return {"ok": False, "reason": "Could not create branch."}

    commit_msg = f"credon(self): {str(diagnosis.get('issue', 'improvement'))[:100]}"
    if not github_svc.commit_files(branch, files, commit_msg):
        record_signal("error", "evolve: commit failed", user_id)
        return {"ok": False, "reason": "Commit failed on GitHub side."}

    pr_body = (
        f"## Credon self-improvement proposal\n\n"
        f"**Issue:** {diagnosis.get('issue', '')}\n\n"
        f"**Evidence from signals:**\n{diagnosis.get('evidence', '')}\n\n"
        f"**Change plan:**\n{diagnosis.get('plan', '')}\n\n"
        f"**Files changed:** {', '.join(files.keys())}\n\n"
        f"**Self-checks passed:** syntax compile · forbidden-path guard · size cap (≤{MAX_CHANGED_LINES} lines)\n\n"
        f"---\n*Opened autonomously by Credon's improvement loop. Autopilot is "
        f"{'ON' if os.getenv('SELF_EVOLVE_AUTOPILOT', 'false').lower() == 'true' else 'OFF'} — "
        f"{'merged automatically after checks' if os.getenv('SELF_EVOLVE_AUTOPILOT', 'false').lower() == 'true' else 'waiting for owner approval'}.*"
    )
    pr = github_svc.open_pr(branch, f"credon(self): {str(diagnosis.get('issue', 'improvement'))[:120]}", pr_body)

    entry = {
        "id": uuid.uuid4().hex[:10],
        "ts": _now_iso(),
        "issue": diagnosis.get("issue", ""),
        "evidence": diagnosis.get("evidence", ""),
        "plan": diagnosis.get("plan", ""),
        "files": list(files.keys()),
        "branch": branch,
        "pr_url": pr.get("url"),
        "pr_number": pr.get("number"),
        "merged": False,
    }
    with _lock:
        log = _read(_EVOLVE_LOG, [])
        log.append(entry)
        _write(_EVOLVE_LOG, log[-100:])

    # Autopilot (off by default): merge tiny, verified fixes.
    if os.getenv("SELF_EVOLVE_AUTOPILOT", "false").lower() == "true" and pr.get("number"):
        total = sum(len(c.splitlines()) for c in files.values())
        if total <= 30:
            merge = github_svc.merge_pr(int(pr["number"]))
            entry["merged"] = bool(merge.get("ok"))
            with _lock:
                log = _read(_EVOLVE_LOG, [])
                for item in log:
                    if item.get("id") == entry["id"]:
                        item["merged"] = entry["merged"]
                _write(_EVOLVE_LOG, log)

    return {
        "ok": True,
        "action": "pr_opened",
        "issue": entry["issue"],
        "pr_url": pr.get("url"),
        "merged": entry.get("merged", False),
    }


def evolve_log() -> list[dict[str, Any]]:
    log = _read(_EVOLVE_LOG, [])
    log.reverse()
    return log[:20]
