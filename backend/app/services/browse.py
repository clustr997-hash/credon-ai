"""Extra research tools: page browser (Camoufox-optional), arXiv, YouTube.

All free, all graceful: every tool degrades to a no-result instead of failing.
"""

from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET

import requests

_UA = "CredonAI/2.0 (research assistant; +https://credonai.app)"


# ── Page browser ────────────────────────────────────────────────

def _read_with_trafilatura(url: str) -> str:
    try:
        import trafilatura

        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return ""
        text = trafilatura.extract(downloaded, include_comments=False) or ""
        return text.strip()
    except Exception:
        return ""


def _read_with_requests(url: str) -> str:
    try:
        resp = requests.get(url, headers={"User-Agent": _UA}, timeout=10)
        resp.raise_for_status()
        html = resp.text
        # crude readable-text fallback
        html = re.sub(r"<(script|style|nav|footer|header)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text)
        return text.strip()[:6000]
    except Exception:
        return ""


def _read_with_camoufox(url: str) -> str:
    """Anti-detect browser reading for JS-heavy or bot-protected pages.

    Optional: requires `pip install "camoufox[geoip]"` + `camoufox fetch`.
    Never a hard dependency — returns "" when unavailable.
    """
    if os.getenv("USE_CAMOUFOX", "false").lower() != "true":
        return ""
    try:
        from camoufox.sync_api import Camoufox  # type: ignore

        with Camoufox(headless=True) as browser:
            page = browser.new_page()
            page.goto(url, timeout=25000, wait_until="domcontentloaded")
            page.wait_for_timeout(1200)
            text = page.inner_text("body")
            page.close()
        return (text or "").strip()[:8000]
    except Exception:
        return ""


def read_page(url: str, deep: bool = False) -> dict[str, str]:
    """Read a web page's main content. Chain: trafilatura → camoufox → requests."""
    text = _read_with_trafilatura(url)
    method = "trafilatura"
    if len(text) < 400 and (deep or not text):
        cam = _read_with_camoufox(url)
        if len(cam) > len(text):
            text, method = cam, "camoufox"
    if len(text) < 200 and not text:
        plain = _read_with_requests(url)
        if len(plain) > len(text):
            text, method = plain, "requests"
    return {"url": url, "method": method, "text": text[:8000]}


# ── arXiv research ──────────────────────────────────────────────

def search_arxiv(query: str, max_results: int = 4) -> list[dict[str, str]]:
    try:
        resp = requests.get(
            "https://export.arxiv.org/api/query",
            params={
                "search_query": f"all:{query}",
                "start": 0,
                "max_results": max_results,
                "sortBy": "relevance",
            },
            headers={"User-Agent": _UA},
            timeout=10,
        )
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        ns = {"a": "http://www.w3.org/2005/Atom"}
        papers: list[dict[str, str]] = []
        for entry in root.findall("a:entry", ns):
            title = re.sub(r"\s+", " ", entry.findtext("a:title", "", ns)).strip()
            summary = re.sub(r"\s+", " ", entry.findtext("a:summary", "", ns)).strip()[:500]
            link = entry.findtext("a:id", "", ns)
            authors = [a.findtext("a:name", "", ns) for a in entry.findall("a:author", ns)][:3]
            papers.append(
                {
                    "title": title,
                    "url": link,
                    "snippet": summary,
                    "authors": ", ".join(a for a in authors if a),
                }
            )
        return papers
    except Exception:
        return []


# ── YouTube transcript ──────────────────────────────────────────

_YT_ID_RE = re.compile(r"(?:v=|youtu\.be/|shorts/|embed/)([A-Za-z0-9_-]{11})")


def youtube_transcript(url: str) -> dict[str, str]:
    """Fetch a YouTube transcript via the public timedtext endpoint.

    Graceful: returns an explanatory message when unavailable.
    """
    match = _YT_ID_RE.search(url or "")
    if not match:
        return {"video_id": "", "transcript": "", "note": "No YouTube video id found in that link."}
    video_id = match.group(1)
    try:
        resp = requests.get(
            f"https://video.google.com/timedtext?lang=en&v={video_id}",
            headers={"User-Agent": _UA},
            timeout=10,
        )
        if resp.ok and "<transcript" in resp.text:
            texts = re.findall(r"<text[^>]*>(.*?)</text>", resp.text, re.S)
            import html as _html

            transcript = " ".join(_html.unescape(t).replace("\n", " ") for t in texts)
            transcript = re.sub(r"\s+", " ", transcript).strip()
            if transcript:
                return {"video_id": video_id, "transcript": transcript[:15000], "note": ""}
    except Exception:
        pass
    return {
        "video_id": video_id,
        "transcript": "",
        "note": "Transcript unavailable for this video (captions may be disabled).",
    }
