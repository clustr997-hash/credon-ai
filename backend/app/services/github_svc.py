"""Minimal GitHub API client for Credon's self-improvement loop.

Powers: reading its own repo, creating branches, committing patches,
opening pull requests. The token stays server-side, always.
"""

from __future__ import annotations

import base64
import os
from typing import Any

import requests

_API = "https://api.github.com"


def _headers() -> dict[str, str]:
    token = os.getenv("GITHUB_TOKEN", "").strip()
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "credon-self-evolve",
    }


def repo() -> str:
    return os.getenv("GITHUB_REPO", "").strip()


def token_present() -> bool:
    return bool(os.getenv("GITHUB_TOKEN", "").strip())


def repo_accessible() -> tuple[bool, str]:
    if not token_present():
        return False, "GITHUB_TOKEN missing"
    target = repo()
    if not target:
        return False, "GITHUB_REPO missing"
    try:
        resp = requests.get(f"{_API}/repos/{target}", headers=_headers(), timeout=10)
        if resp.status_code == 200:
            return True, "ok"
        if resp.status_code == 404:
            return False, f"repo {target} not found or token not scoped to it"
        return False, f"github responded {resp.status_code}"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)[:120]


def default_branch() -> str:
    resp = requests.get(f"{_API}/repos/{repo()}", headers=_headers(), timeout=10)
    resp.raise_for_status()
    return str(resp.json().get("default_branch") or "main")


def get_ref(branch: str) -> tuple[str, str] | None:
    """Return (sha, object_type) for a branch ref."""
    resp = requests.get(f"{_API}/repos/{repo()}/git/ref/heads/{branch}", headers=_headers(), timeout=10)
    if resp.status_code != 200:
        return None
    obj = resp.json().get("object", {})
    return str(obj.get("sha", "")), str(obj.get("type", "commit"))


def read_file(path: str, ref: str | None = None) -> str | None:
    params = {"ref": ref} if ref else None
    resp = requests.get(
        f"{_API}/repos/{repo()}/contents/{path}", headers=_headers(), params=params, timeout=10
    )
    if resp.status_code != 200:
        return None
    data = resp.json()
    if data.get("encoding") == "base64":
        try:
            return base64.b64decode(data.get("content", "")).decode("utf-8", errors="replace")
        except Exception:
            return None
    return None


def list_tree(ref: str | None = None, max_entries: int = 300) -> list[dict[str, Any]]:
    ref = ref or default_branch()
    resp = requests.get(
        f"{_API}/repos/{repo()}/git/trees/{ref}", headers=_headers(), params={"recursive": "1"}, timeout=15
    )
    if resp.status_code != 200:
        return []
    tree: list[dict[str, Any]] = [
        {"path": item.get("path"), "type": item.get("type"), "size": item.get("size")}
        for item in resp.json().get("tree", [])
        if item.get("type") == "blob"
    ]
    return tree[:max_entries]


def create_branch(branch: str, from_branch: str | None = None) -> bool:
    source = from_branch or default_branch()
    base = get_ref(source)
    if not base:
        return False
    resp = requests.post(
        f"{_API}/repos/{repo()}/git/refs",
        headers=_headers(),
        json={"ref": f"refs/heads/{branch}", "sha": base[0]},
        timeout=10,
    )
    return resp.status_code in (201, 422)  # 422 = already exists


def commit_files(branch: str, files: dict[str, str], message: str) -> bool:
    """Commit multiple files to a branch via the contents API."""
    for path, content in files.items():
        existing = requests.get(
            f"{_API}/repos/{repo()}/contents/{path}", headers=_headers(), params={"ref": branch}, timeout=10
        )
        sha = existing.json().get("sha") if existing.status_code == 200 else None
        payload: dict[str, Any] = {
            "message": message,
            "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            "branch": branch,
        }
        if sha:
            payload["sha"] = sha
        resp = requests.put(
            f"{_API}/repos/{repo()}/contents/{path}", headers=_headers(), json=payload, timeout=15
        )
        if resp.status_code not in (200, 201):
            return False
    return True


def open_pr(branch: str, title: str, body: str) -> dict[str, Any]:
    base = default_branch()
    resp = requests.post(
        f"{_API}/repos/{repo()}/pulls",
        headers=_headers(),
        json={"title": title[:180], "head": branch, "base": base, "body": body[:60000]},
        timeout=15,
    )
    if resp.status_code in (201, 422):
        data = resp.json() if resp.status_code == 201 else {}
        pr_number = data.get("number")
        if resp.status_code == 422 and pr_number is None:
            # PR already exists for this branch — find it
            existing = requests.get(
                f"{_API}/repos/{repo()}/pulls", headers=_headers(), params={"head": f"{repo()}:{branch}", "state": "open"}, timeout=10
            )
            items = existing.json() if existing.status_code == 200 else []
            if isinstance(items, list) and items:
                pr_number = items[0].get("number")
        url = f"https://github.com/{repo()}/pull/{pr_number}" if pr_number else f"https://github.com/{repo()}/tree/{branch}"
        return {"ok": True, "number": pr_number, "url": url}
    return {"ok": False, "error": f"github {resp.status_code}: {resp.text[:200]}"}


def merge_pr(number: int) -> dict[str, Any]:
    resp = requests.put(
        f"{_API}/repos/{repo()}/pulls/{number}/merge",
        headers=_headers(),
        json={"merge_method": "squash"},
        timeout=15,
    )
    return {"ok": resp.status_code == 200, "status": resp.status_code}
