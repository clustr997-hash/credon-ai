"""Enhanced retrieval — DuckDuckGo + multiple fallbacks + image search.

Improvements over v1:
* Parallel page extraction (4 workers)
* Image search for visual queries
* Better snippet quality
* Multiple search provider fallbacks (DDG → Brave → Google scrape → Wikipedia)
"""

from __future__ import annotations

import concurrent.futures
import os
import re
from typing import Any
from urllib.parse import quote_plus

import requests
import trafilatura
from ddgs import DDGS

_PAGE_TIMEOUT = 3


def _extract_page_text(url: str, max_chars: int = 800) -> str:
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


def _extract_parallel(urls: list[str], max_chars: int = 800) -> dict[str, str]:
    result: dict[str, str] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        future_map = {
            pool.submit(_extract_page_text, url, max_chars): url for url in urls
        }
        done, pending = concurrent.futures.wait(
            future_map.keys(), timeout=6, return_when=concurrent.futures.ALL_COMPLETED
        )
        for future in done:
            url = future_map[future]
            try:
                result[url] = future.result(timeout=_PAGE_TIMEOUT)
            except Exception:
                result[url] = ""
        for future in pending:
            url = future_map[future]
            future.cancel()
            result[url] = ""
    return result


def _is_visual_query(query: str) -> bool:
    """Heuristic: does the user likely want images?"""
    visual_words = [
        "image", "picture", "photo", "diagram", "chart", "graph",
        "screenshot", "logo", "icon", "illustration", "visual",
        "how does .* look", "show me", "tasveer", "dikha",
    ]
    q = query.lower()
    return any(re.search(pat, q) for pat in visual_words)


def search_images(query: str, max_results: int = 4) -> list[dict[str, str]]:
    """Search for images — DDG first, then Brave fallback."""
    results = _ddg_image_search(query, max_results)
    if not results:
        results = _brave_image_search(query, max_results)
    return results


def _ddg_image_search(query: str, max_results: int) -> list[dict[str, str]]:
    """DuckDuckGo image search."""
    try:
        ddgs = DDGS()
        raw = list(ddgs.images(query, max_results=max_results))
        results: list[dict[str, str]] = []
        for item in raw:
            img_url = item.get("image") or ""
            thumb = item.get("thumbnail") or img_url
            title = item.get("title") or ""
            source = item.get("url") or ""
            if img_url:
                results.append({
                    "image_url": img_url,
                    "thumbnail": thumb,
                    "title": title,
                    "source_url": source,
                })
        return results
    except Exception:
        return []


def _brave_image_search(query: str, max_results: int) -> list[dict[str, str]]:
    """Brave image search fallback."""
    api_key = os.getenv("BRAVE_API_KEY", "")
    if not api_key:
        return []
    try:
        resp = requests.get(
            "https://api.search.brave.com/res/v1/images/search",
            params={"q": query, "count": max_results},
            headers={"Accept": "application/json", "X-Subscription-Token": api_key},
            timeout=5,
        )
        if not resp.ok:
            return []
        data = resp.json()
        results: list[dict[str, str]] = []
        for item in data.get("results", []):
            img_url = item.get("properties", {}).get("url", "")
            thumb = item.get("thumbnail", {}).get("src", "") or img_url
            title = item.get("title", "")
            source = item.get("url", "")
            if img_url:
                results.append({
                    "image_url": img_url,
                    "thumbnail": thumb,
                    "title": title,
                    "source_url": source,
                })
        return results[:max_results]
    except Exception:
        return []


def retrieve_sources(query: str, max_results: int = 6) -> list[dict[str, Any]]:
    """Search with multiple fallbacks: DDG → Brave → Google scrape → Wikipedia."""
    # Try DuckDuckGo first
    raw_results = _ddg_search(query, max_results)

    # Fallback 1: Brave Search (if API key is set)
    if not raw_results:
        raw_results = _brave_search(query, max_results)

    # Fallback 2: Google scrape via SearXNG-style
    if not raw_results:
        raw_results = _google_scrape_search(query, max_results)

    # Fallback 3: Wikipedia
    if not raw_results:
        return _wikipedia_fallback(query)

    urls_to_extract = []
    for item in raw_results[:4]:
        url = item.get("href") or item.get("url") or ""
        if url:
            urls_to_extract.append(url)

    enable_page_extraction = os.getenv("ENABLE_PAGE_EXTRACTION", "false").lower() == "true"
    page_texts = _extract_parallel(urls_to_extract) if (enable_page_extraction and urls_to_extract) else {}

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


def _ddg_search(query: str, max_results: int) -> list[dict[str, Any]]:
    """DuckDuckGo search (primary)."""
    try:
        ddgs = DDGS()
        return list(ddgs.text(query, max_results=max_results))
    except Exception as e:
        print(f"[Credon] DDG search failed: {e}")
        return []


def _brave_search(query: str, max_results: int) -> list[dict[str, Any]]:
    """Brave Search API fallback (requires BRAVE_API_KEY env var)."""
    api_key = os.getenv("BRAVE_API_KEY", "")
    if not api_key:
        return []
    try:
        resp = requests.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": max_results},
            headers={"Accept": "application/json", "X-Subscription-Token": api_key},
            timeout=10,
        )
        if not resp.ok:
            return []
        data = resp.json()
        results = []
        for item in data.get("web", {}).get("results", []):
            results.append({
                "title": item.get("title", ""),
                "href": item.get("url", ""),
                "body": item.get("description", ""),
            })
        return results[:max_results]
    except Exception as e:
        print(f"[Credon] Brave search failed: {e}")
        return []


def _google_scrape_search(query: str, max_results: int) -> list[dict[str, Any]]:
    """Lightweight Google results scrape as a last-resort web fallback."""
    try:
        url = f"https://www.google.com/search?q={quote_plus(query)}&num={max_results}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        resp = requests.get(url, headers=headers, timeout=5)
        if not resp.ok:
            return []
        # Basic extraction of result titles/URLs from HTML
        results: list[dict[str, Any]] = []
        # Find <a href="/url?q=..." patterns
        import re as _re
        matches = _re.findall(r'<a href="/url\?q=([^&"]+)&[^"]*"[^>]*>(.*?)</a>', resp.text)
        for link, title_html in matches:
            # Clean title HTML
            clean_title = _re.sub(r'<[^>]+>', '', title_html).strip()
            if not link.startswith("http") or not clean_title:
                continue
            if any(skip in link for skip in ["google.com", "youtube.com", "accounts.google"]):
                continue
            results.append({
                "title": clean_title[:200],
                "href": link,
                "body": "",
            })
            if len(results) >= max_results:
                break
        return results
    except Exception as e:
        print(f"[Credon] Google scrape failed: {e}")
        return []


def _wikipedia_fallback(query: str) -> list[dict[str, Any]]:
    try:
        summary_url = (
            "https://en.wikipedia.org/api/rest_v1/page/summary/"
            + query.replace(" ", "_")
        )
        resp = requests.get(summary_url, timeout=4)
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
