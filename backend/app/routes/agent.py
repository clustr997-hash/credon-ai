"""Credon Agent v2 — autonomous plan → research → code → files → report.

Devin-style workflow with a persistent per-session workspace:
- Drafts a plan (research / reason / code / browse steps)
- Executes each step, writing real files into backend/data/workspaces/
- Runs Python in an isolated, timeout-bounded subprocess
- Can open and read live web pages (Camoufox when installed, else trafilatura)
- Accepts follow-up goals in the same session and iterates ("now change X")

Streams SSE events: status, plan, step_start, step_output, file, step_done, done.
"""

from __future__ import annotations

import json as _json
import os
import re
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services.models import generate_sync
from app.services.retrieval_v2 import retrieve_sources
from app.services.browse import read_page, search_arxiv, youtube_transcript
from app.services import github_svc

router = APIRouter()

_MAX_STEPS = 6
_PY_TIMEOUT_SEC = 15
_PY_OUTPUT_CAP = 8000

_WORKSPACES = Path(__file__).resolve().parents[2] / "data" / "workspaces"

_ALLOWED_PY_IMPORTS = {
    "math", "random", "json", "re", "statistics", "datetime",
    "itertools", "functools", "collections", "string", "textwrap",
    "fractions", "decimal", "heapq", "bisect", "array", "csv",
    "io", "hashlib", "uuid", "time",
}


class AgentRunRequest(BaseModel):
    user_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    goal: str = Field(min_length=1)
    use_web: bool = True
    max_steps: int = Field(default=4, ge=2, le=_MAX_STEPS)
    context: str = ""
    is_follow_up: bool = False
    auth_email: str = ""
    unsafe_tools_enabled: bool = False


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {_json.dumps(payload, ensure_ascii=False)}\n\n"


_SAFE_COMMANDS = {"python", "python3", "pytest", "npm", "pnpm", "yarn", "node", "git"}
_MUTATING_GIT = {"commit", "push", "pull"}


def _owner_email() -> str:
    return os.getenv("OWNER_EMAIL", "").strip().lower()


def _is_owner(email: str) -> bool:
    owner = _owner_email()
    return bool(owner and email.strip().lower() == owner)


def _unsafe_tools_enabled(req: AgentRunRequest) -> bool:
    return _is_owner(req.auth_email) and req.unsafe_tools_enabled and os.getenv("AGENT_UNSAFE_TOOLS_ENABLED", "false").lower() == "true"


def _safe_workspace_path(ws: Path, rel_path: str) -> Path:
    candidate = (ws / rel_path).resolve()
    root = ws.resolve()
    if root != candidate and root not in candidate.parents:
        raise ValueError("Path escapes workspace")
    return candidate


class AgentToolbox:
    """Capability-gated tools exposed to the agent runtime after authorization."""

    def __init__(self, req: AgentRunRequest, ws: Path):
        self.req = req
        self.ws = ws
        self.authenticated = bool(req.user_id.strip() and req.auth_email.strip())
        self.owner = _is_owner(req.auth_email)
        self.unsafe_enabled = _unsafe_tools_enabled(req)

    def capabilities(self) -> dict[str, bool]:
        return {
            "workspace_read": self.authenticated,
            "workspace_write": self.authenticated,
            "command_execute": self.unsafe_enabled,
            "git_status": self.authenticated,
            "git_diff": self.authenticated,
            "git_commit": self.unsafe_enabled,
            "github_push_pull_pr": self.unsafe_enabled and github_svc.token_present(),
            "codebase_search": self.authenticated,
        }

    def _require(self, capability: str) -> None:
        if not self.capabilities().get(capability):
            raise PermissionError(f"Tool disabled: {capability}")

    def event(self, name: str, status: str, output: str = "", **extra: Any) -> dict[str, Any]:
        return {"type": "tool", "name": name, "status": status, "output": output[-4000:], **extra}

    def read_file(self, path: str) -> str:
        self._require("workspace_read")
        return _safe_workspace_path(self.ws, path).read_text(encoding="utf-8", errors="replace")[:60000]

    def write_file(self, path: str, content: str) -> dict[str, Any]:
        self._require("workspace_write")
        safe = _safe_workspace_path(self.ws, path)
        safe.parent.mkdir(parents=True, exist_ok=True)
        safe.write_text(content[:60000], encoding="utf-8")
        rel = str(safe.relative_to(self.ws))
        return {"path": rel, "size": safe.stat().st_size, "preview": content[:600], "modified": datetime.now(timezone.utc).isoformat()}

    def run_command(self, command: list[str], timeout: int = 20) -> tuple[bool, str]:
        self._require("command_execute")
        if not command or command[0] not in _SAFE_COMMANDS:
            raise PermissionError("Command is not allowlisted")
        proc = subprocess.run(command, cwd=self.ws, capture_output=True, text=True, timeout=min(timeout, 60))
        return proc.returncode == 0, ((proc.stdout or "") + (proc.stderr or ""))[-8000:]

    def git(self, op: str, message: str = "agent update") -> tuple[bool, str]:
        if op in {"status", "diff"}:
            self._require(f"git_{op}")
            cmd = ["git", op, "--short"] if op == "status" else ["git", "diff", "--stat"]
        elif op == "commit":
            self._require("git_commit")
            cmd = ["git", "commit", "-am", message[:200]]
        else:
            raise PermissionError("Unsupported git operation")
        proc = subprocess.run(cmd, cwd=self.ws, capture_output=True, text=True, timeout=30)
        return proc.returncode == 0, ((proc.stdout or "") + (proc.stderr or ""))[-8000:]

    def github(self, op: str, **kwargs: Any) -> dict[str, Any]:
        self._require("github_push_pull_pr")
        if op == "open_pr":
            return github_svc.open_pr(str(kwargs.get("branch") or ""), str(kwargs.get("title") or "Agent update"), str(kwargs.get("body") or ""))
        raise PermissionError("GitHub operation is unavailable in this sandbox")

    def search_codebase(self, query: str) -> str:
        self._require("codebase_search")
        proc = subprocess.run(["rg", "-n", "--", query[:200], "."], cwd=self.ws, capture_output=True, text=True, timeout=10)
        return ((proc.stdout or "") + (proc.stderr or ""))[-8000:]


def _workspace(user_id: str, session_id: str) -> Path:
    path = _WORKSPACES / user_id / session_id
    path.mkdir(parents=True, exist_ok=True)
    (path / "logs").mkdir(exist_ok=True)
    return path


def _list_files(ws: Path) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    for item in sorted(ws.rglob("*")):
        if item.is_file() and "logs" not in item.parts:
            try:
                content = item.read_text(encoding="utf-8", errors="replace")
            except Exception:
                content = ""
            files.append(
                {
                    "path": str(item.relative_to(ws)),
                    "size": item.stat().st_size,
                    "preview": content[:1200],
                    "modified": datetime.fromtimestamp(item.stat().st_mtime, timezone.utc).isoformat(),
                }
            )
    return files[:24]


def _extract_json(text: str) -> dict[str, Any] | None:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        parsed = _json.loads(text[start : end + 1])
        return parsed if isinstance(parsed, dict) else None
    except _json.JSONDecodeError:
        return None


def _workspace_brief(ws: Path) -> str:
    files = _list_files(ws)
    if not files:
        return ""
    lines = [f"- {f['path']} ({f['size']}b): {f['preview'][:120].replace(chr(10), ' ')}" for f in files]
    return "Workspace files from earlier steps:\n" + "\n".join(lines[:12])


_PLAN_PROMPT = """You are Credon Agent, an autonomous AI engineer and researcher working inside a sandbox workspace.

Break the user's goal into at most {n} concrete executable steps. Each step is one kind:
- "research": web search (include focused "search_query")
- "browse": open and read one specific URL fully (include "url")
- "reason": analyze/synthesize from earlier findings
- "code": write a file AND/OR run a Python script (include complete "python_code" with prints; optionally "filename")

Available context you previously produced:
{context_block}
{ws_block}
Respond with ONLY valid JSON:
{{"steps": [{{"id": 1, "kind": "research|browse|reason|code", "title": "short imperative", "detail": "what exactly to do", "search_query": "...", "url": "...", "filename": "...", "python_code": "..."}}]}}

Rules:
- Use "code" when computation, verification, or producing a file artifact helps.
- Use "browse" only when a specific URL matters (articles, docs, YouTube links).
- Keep titles under 60 chars. No markdown fences around the JSON.

User goal: {goal}"""


def _build_plan(goal: str, max_steps: int, context: str, ws: Path, is_follow_up: bool) -> list[dict[str, Any]]:
    ws_block = _workspace_brief(ws)
    prompt = _PLAN_PROMPT.format(n=max_steps, goal=goal, context_block=context[:1500], ws_block=ws_block)
    raw = generate_sync([{"role": "user", "content": prompt}])
    parsed = _extract_json(raw)
    steps = parsed.get("steps") if isinstance(parsed, dict) else None
    if not isinstance(steps, list) or not steps:
        return [
            {"id": 1, "kind": "research", "title": "Research the topic", "detail": goal, "search_query": goal},
            {"id": 2, "kind": "code", "title": "Write up the result", "detail": f"Produce a complete answer for: {goal}"},
        ]
    normalized: list[dict[str, Any]] = []
    for idx, step in enumerate(steps[:max_steps], start=1):
        if not isinstance(step, dict):
            continue
        kind = str(step.get("kind") or "reason").lower()
        if kind not in {"research", "reason", "code", "browse"}:
            kind = "reason"
        normalized.append({
            "id": int(step.get("id") or idx),
            "kind": kind,
            "title": str(step.get("title") or f"Step {idx}")[:80],
            "detail": str(step.get("detail") or "")[:500],
            "search_query": str(step.get("search_query") or "")[:200],
            "url": str(step.get("url") or "")[:400],
            "filename": str(step.get("filename") or "")[:80],
            "python_code": str(step.get("python_code") or ""),
        })
    return normalized or [{"id": 1, "kind": "reason", "title": "Answer directly", "detail": goal}]


_UNSAFE_PATTERNS = [
    r"\bimport\s+subprocess\b", r"\bimport\s+socket\b", r"\bimport\s+shutil\b",
    r"\bimportlib\b", r"\beval\s*\(", r"\bexec\s*\(", r"\b__import__\b",
    r"\bos\.system\b", r"\bos\.remove\b", r"\bos\.rmdir\b", r"\bshutil\.",
    r"\brequests\b", r"\burllib\b", r"\bhttpx\b", r"\bsqlite3\b",
]


def _code_is_safe(code: str) -> tuple[bool, str]:
    for pattern in _UNSAFE_PATTERNS:
        if re.search(pattern, code):
            label = pattern.replace(r"\b", "").split("\\")[0].strip() or "unsafe operation"
            return False, f"Blocked for safety: {label}"
    return True, ""


def _run_python(code: str, ws: Path) -> tuple[bool, str, str]:
    safe, reason = _code_is_safe(code)
    if not safe:
        return False, "", reason
    header = (
        "import math, random, json, re, statistics, datetime, itertools, functools, "
        "collections, string, textwrap, fractions, decimal, heapq, bisect\n"
    )
    script = header + code
    with tempfile.TemporaryDirectory(prefix="credon-agent-") as tmp:
        path = Path(tmp) / "step.py"
        path.write_text(script, encoding="utf-8")
        try:
            proc = subprocess.run(
                [sys.executable, "-I", str(path)],
                capture_output=True,
                text=True,
                timeout=_PY_TIMEOUT_SEC,
                cwd=ws,
                env={"PATH": os.environ.get("PATH", ""), "PYTHONIOENCODING": "utf-8"},
            )
            out = (proc.stdout or "")[-_PY_OUTPUT_CAP:]
            err = (proc.stderr or "")[-2000:]
            return proc.returncode == 0, out, err
        except subprocess.TimeoutExpired:
            return False, "", f"Execution timed out after {_PY_TIMEOUT_SEC}s"
        except Exception as exc:  # noqa: BLE001
            return False, "", f"Runner error: {exc}"


def _save_file(ws: Path, filename: str, content: str) -> str:
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", filename or f"note-{uuid.uuid4().hex[:6]}.md")
    path = ws / safe_name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content[:60000], encoding="utf-8")
    return safe_name


async def _agent_stream(req: AgentRunRequest) -> AsyncGenerator[str, None]:
    started = time.time()
    ws = _workspace(req.user_id, req.session_id)
    tools = AgentToolbox(req, ws)
    if not tools.authenticated:
        raise HTTPException(status_code=401, detail="Authenticated session required for agent tools")
    engine = "Credon engine" if os.getenv("USE_MODEL_GENERATION", "true").lower() == "true" else "Credon engine"

    yield _sse({"type": "status", "stage": "planning", "message": f"{engine}: analyzing goal and drafting plan..."})
    plan = _build_plan(req.goal, req.max_steps, req.context, ws, req.is_follow_up)
    yield _sse({"type": "plan", "goal": req.goal, "steps": [
        {k: step[k] for k in ("id", "kind", "title", "detail")} for step in plan
    ]})
    yield _sse({"type": "capabilities", "capabilities": tools.capabilities(), "unsafe_enabled": tools.unsafe_enabled})

    collected: list[str] = []
    all_sources: list[dict[str, str]] = []
    created_files: list[dict[str, Any]] = []

    for step in plan:
        sid = step["id"]
        yield _sse({"type": "step_start", "step_id": sid, "kind": step["kind"], "title": step["title"]})
        terminal: list[str] = []

        if step["kind"] == "research":
            q = step.get("search_query") or step["title"]
            terminal.append(f'$ credon research --query "{q}"')
            # arXiv enrichment for scholarly-looking queries
            papers = search_arxiv(q, max_results=2) if re.search(r"\b(paper|research|arxiv|study|theory)\b", q, re.I) else []
            sources = []
            try:
                sources = retrieve_sources(q, max_results=5)  # type: ignore[arg-type]
            except Exception:
                sources = []
            all_sources.extend(sources)
            for src in sources[:5]:
                terminal.append(f"  ✓ fetched {(src.get('title') or 'source')[:70]}")
            for paper in papers:
                terminal.append(f"  ✓ arXiv: {paper['title'][:70]}")
                all_sources.append({"title": paper["title"], "url": paper["url"], "snippet": paper["snippet"]})
            body = "\n\n".join(
                f"[{i}] {(s.get('title') or 'Source')}\n    {(s.get('snippet') or '')[:400]}\n    URL: {s.get('url', '')}"
                for i, s in enumerate(sources, 1)
            ) or "No web results found."
            collected.append(f"### Research: {step['title']}\n{body}")
            terminal += ["", body[:1200]]

        elif step["kind"] == "browse":
            url = step.get("url") or (step.get("search_query") or "")
            terminal.append(f"$ credon browse {url}")
            page = read_page(url, deep=True)
            if page["text"]:
                terminal.append(f"  ✓ read via {page['method']} ({len(page['text'])} chars)")
                collected.append(f"### Page: {url}\n{page['text'][:4000]}")
                all_sources.append({"title": url, "url": url, "snippet": page["text"][:300]})
                file_info = tools.write_file(f"page-{sid}.md", f"# {url}\n\n{page['text']}")
                fname = file_info["path"]
                created_files.append(file_info)
                yield _sse(tools.event("workspace.write", "ok", f"wrote {fname}", files_changed=[fname]))
                yield _sse({"type": "file", "step_id": sid, "file": created_files[-1]})
            else:
                terminal.append("  ✕ page could not be read (may require the browser tool)")
            yield _sse({"type": "step_done", "step_id": sid, "ok": bool(page["text"]), "terminal": terminal[-40:]})
            continue

        elif step["kind"] == "code":
            code = step.get("python_code") or ""
            terminal.append("$ credon run python --sandboxed")
            ok = False
            out = err = ""
            if code.strip():
                preview = "\n".join(f"  │ {line}" for line in code.splitlines()[:12])
                terminal.append(preview)
                if len(code.splitlines()) > 12:
                    terminal.append(f"  │ ... (+{len(code.splitlines()) - 12} lines)")
                fname = step.get("filename") or f"script-{sid}.py"
                if fname.endswith((".md", ".txt", ".json", ".csv", ".html", ".css", ".js", ".py", ".ts")) and not code.lstrip().startswith(("print", "import", "from", "def", "class", "#!")):
                    file_info = tools.write_file(fname, code)
                    saved = file_info["path"]
                    created_files.append(file_info)
                    yield _sse(tools.event("workspace.write", "ok", f"wrote {saved}", files_changed=[saved]))
                    yield _sse({"type": "file", "step_id": sid, "file": created_files[-1]})
                    terminal.append(f"  ✓ wrote {saved}")
                    ok = True
                else:
                    ok, out, err = _run_python(code, ws)
                    if ok and out.strip():
                        result_name = f"output-{sid}.txt"
                        file_info = tools.write_file(result_name, out)
                        saved = file_info["path"]
                        created_files.append(file_info)
                        yield _sse(tools.event("workspace.write", "ok", f"wrote {saved}", files_changed=[saved]))
                        yield _sse({"type": "file", "step_id": sid, "file": created_files[-1]})
            else:
                err = "Model returned no code for this step."
            terminal.append(f"→ process finished {'exit 0' if ok else 'exit 1'}")
            if out.strip():
                terminal.extend(out.strip().splitlines()[:20])
            if err.strip():
                terminal.append(f"stderr: {err.strip()[:400]}")
            collected.append(
                f"### Code step: {step['title']}\nStatus: {'ok' if ok else 'failed'}\n```\n{(out or err).strip()[:1200]}\n```"
            )

        else:  # reason
            terminal.append("$ credon think --deep")
            synth_prompt = (
                f"Overall goal: {req.goal}\nCurrent sub-task: {step['detail'] or step['title']}\n\n"
                f"Findings so far:\n{chr(10).join(collected)[-4500:]}\n\n"
                "Write a focused analysis for this sub-task. Specific, concise, max 250 words."
            )
            analysis = generate_sync([{"role": "user", "content": synth_prompt}])
            collected.append(f"### Analysis: {step['title']}\n{analysis}")
            terminal += ["", analysis[:1000]]

        yield _sse({"type": "step_done", "step_id": sid, "ok": True, "terminal": terminal[-40:]})

    yield _sse({"type": "status", "stage": "composing", "message": "Composing final report..."})
    files_block = "\n".join(f"- {f['path']}" for f in created_files) or "(none)"
    final_prompt = (
        f"Goal: {req.goal}\n\nWork log:\n{chr(10).join(collected)[-9000:]}\n\nFiles created:\n{files_block}\n\n"
        "Synthesize the complete final answer. Clean markdown, short headers, key numbers and code outputs included. "
        "If slides were requested, structure the answer with '## Slide N:' sections. "
        "Do not mention internal steps; deliver a polished result."
    )
    final_answer = generate_sync([{"role": "user", "content": final_prompt}])

    report_info = tools.write_file(f"report-{datetime.now(timezone.utc).strftime('%H%M%S')}.md",
                                   f"# {req.goal}\n\n{final_answer}")
    report_name = report_info["path"]
    created_files.append(report_info)
    yield _sse(tools.event("workspace.write", "ok", f"wrote {report_name}", files_changed=[report_name]))
    yield _sse({"type": "file", "step_id": 0, "file": created_files[-1]})

    yield _sse({
        "type": "done",
        "answer": final_answer,
        "sources": all_sources[:8],
        "files": created_files,
        "latency_ms": int((time.time() - started) * 1000),
        "metadata": {"routing": {"selected_route": "agent_run_v2"}, "agent": "credon-agent"},
    })


def run_job_sync(user_id: str, goal: str) -> str:
    """Run an agent goal synchronously (used by scheduled jobs)."""
    import asyncio

    async def _collect() -> str:
        chunks: list[str] = []
        async for chunk in _agent_stream(
            AgentRunRequest(user_id=user_id, session_id=f"job-{uuid.uuid4().hex[:6]}", goal=goal)
        ):
            text = chunk.removeprefix("data: ").strip()
            try:
                event = _json.loads(text)
                if event.get("type") == "done":
                    chunks.append(str(event.get("answer", "")))
            except Exception:
                continue
        return "\n".join(chunks)

    try:
        return asyncio.run(_collect())
    except Exception:
        return ""


@router.post("/agent/run")
async def agent_run(body: AgentRunRequest):
    probe_ws = _workspace(body.user_id, body.session_id)
    if not AgentToolbox(body, probe_ws).authenticated:
        raise HTTPException(status_code=401, detail="Authenticated session required for agent tools")
    return StreamingResponse(
        _agent_stream(body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/agent/files")
def agent_files(user_id: str, session_id: str):
    ws = _WORKSPACES / user_id / session_id
    if not ws.exists():
        return {"files": []}
    return {"files": _list_files(ws)}


@router.get("/read")
def read_link(url: str):
    """Read a web page for chat context (paste-a-link → Credon reads it)."""
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "invalid url"}
    page = read_page(url, deep=False)
    return {"ok": bool(page["text"]), "url": url, "method": page["method"], "text": page["text"][:6000]}
