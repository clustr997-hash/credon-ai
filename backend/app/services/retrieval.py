"""Web retrieval — DuckDuckGo + Wikipedia fallback.

Optimisations:
* Parallel page extraction via ThreadPoolExecutor (3 pages, ~3× faster)
* Shorter snippets to keep prompts compact
* Graceful per-page timeout
"""

from __future__ import annotations

import concurrent.futures
from typing import Any

import requests
import trafilatura
from ddgs import DDGS

_PAGE_TIMEOUT = 6


def _extract_page_text(url: str, max_chars: int = 600) -> str:
    try:
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return ""
        extracted = trafilatura.extract(
            downloaded, include_links=False, include_tables=False
        )
        return (extracted or "")[:max_chars].strip()
    except Exception:
        return ""


def _extract_parallel(urls: list[str], max_chars: int = 600) -> dict[str, str]:
    result: dict[str, str] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        future_map = {
            pool.submit(_extract_page_text, url, max_chars): url for url in urls
        }
        for future in concurrent.futures.as_completed(future_map, timeout=15):
            url = future_map[future]
            try:
                result[url] = future.result(timeout=_PAGE_TIMEOUT)
            except Exception:
                result[url] = ""
    return result


def retrieve_sources(query: str, max_results: int = 5) -> list[dict[str, Any]]:
    raw_results: list[dict[str, Any]] = []

    try:
        ddgs = DDGS()
        raw_results = list(ddgs.text(query, max_results=max_results))
    except Exception:
        pass

    if not raw_results:
        return _wikipedia_fallback(query)

    # Parallel extraction for top 3 URLs (speed win)
    urls_to_extract = []
    for item in raw_results[:3]:
        url = item.get("href") or item.get("url") or ""
        if url:
            urls_to_extract.append(url)

    page_texts = _extract_parallel(urls_to_extract) if urls_to_extract else {}

    collected: list[dict[str, Any]] = []
    for item in raw_results:
        title = item.get("title") or "Untitled"
        url = item.get("href") or item.get("url") or ""
        snippet = item.get("body") or ""
        if not url:
            continue
        final_snippet = page_texts.get(url, "") or snippet
        collected.append({"title": title, "url": url, "snippet": final_snippet})

    return collected[:max_results]


def _wikipedia_fallback(query: str) -> list[dict[str, Any]]:
    try:
        summary_url = (
            "https://en.wikipedia.org/api/rest_v1/page/summary/"
            + query.replace(" ", "_")
        )
        resp = requests.get(summary_url, timeout=8)
        if resp.ok:
            data = resp.json()
            extract = data.get("extract") or ""
            page_url = (
                data.get("content_urls", {})
                .get("desktop", {})
                .get("page", "https://en.wikipedia.org")
            )
            if extract:
                return [
                    {
                        "title": data.get("title", "Wikipedia"),
                        "url": page_url,
                        "snippet": extract[:800],
                    }
                ]
    except Exception:
        pass
    return []
