"""Enhanced retrieval — multi-engine web search + source extraction.

Improvements over v1:
* Parallel page extraction (4 workers)
* Image search for visual queries
* Better snippet quality
* Multi-engine retrieval (DDG + LangSearch + Serper + Wikipedia)
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
from typing import Any, cast
from urllib.parse import quote_plus, urlparse

import requests
import trafilatura
from ddgs import DDGS  # type: ignore[import-untyped]

_PAGE_TIMEOUT = 3


def _is_complex_query(query: str) -> bool:
    q = query.lower().strip()
    if len(q.split()) >= 9:
        return True
    patterns = [
        r"\b(explain|compare|analy[sz]e|difference|trade[- ]?off|why|how)\b",
        r"\b(latest|recent|202[4-9]|current)\b",
        r"\b(with sources|citations?|references?)\b",
    ]
    return any(re.search(p, q) for p in patterns)


def _page_extraction_mode() -> str:
    """Supported values:
    - false/off/0: disabled
    - true/on/1/auto: strategic extraction
    - full: always extract
    """
    raw = os.getenv("ENABLE_PAGE_EXTRACTION", "false").strip().lower()
    if raw in {"full"}:
        return "full"
    if raw in {"true", "1", "on", "auto"}:
        return "strategic"
    return "off"


def _extraction_budget(query: str, max_results: int) -> int:
    if _is_complex_query(query):
        return min(max(max_results, 4), 8)
    return min(max(max_results // 2, 2), 4)


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


_LICENSE_SAFE_IMAGE_DOMAINS: dict[str, str] = {
    "commons.wikimedia.org": "Wikimedia Commons",
    "upload.wikimedia.org": "Wikimedia Commons",
    "unsplash.com": "Unsplash",
    "images.unsplash.com": "Unsplash",
    "pexels.com": "Pexels",
    "images.pexels.com": "Pexels",
    "pixabay.com": "Pixabay",
    "cdn.pixabay.com": "Pixabay",
}


def _image_source_label(source_url: str, image_url: str) -> str:
    host = (urlparse(source_url or image_url).hostname or "").lower().removeprefix("www.")
    for domain, label in _LICENSE_SAFE_IMAGE_DOMAINS.items():
        if host == domain or host.endswith(f".{domain}"):
            return label
    return ""


def _image_result_from_item(item: dict[str, Any]) -> dict[str, Any] | None:
    img_url = str(item.get("image") or "")
    if not img_url:
        return None
    source = str(item.get("url") or item.get("source") or "")
    label = _image_source_label(source, img_url)
    license_safe_source = bool(label)
    license_verified = False
    license_note = (
        f"Preferred source: {label}; license still not verified in-app, so open the source to confirm exact terms."
        if license_safe_source
        else "License not verified by search; treat as a reference image and open the source to check rights."
    )
    return {
        "image_url": img_url,
        "thumbnail": str(item.get("thumbnail") or img_url),
        "title": str(item.get("title") or ""),
        "source_url": source or img_url,
        "source_name": label or str(item.get("source") or ""),
        "license_safe_source": license_safe_source,
        "license_verified": license_verified,
        "license_note": license_note,
        "is_reference": not license_verified,
    }


def search_images(query: str, max_results: int = 4) -> list[dict[str, Any]]:
    """Search for source-linked images, preferring license-safe providers when possible."""
    return _ddg_image_search(query, max_results)


def _ddg_images(ddgs: DDGS, query: str, max_results: int) -> list[dict[str, Any]]:
    """Call DDG images with license parameters when the installed library supports them."""
    try:
        return list(ddgs.images(query, max_results=max_results, license_image="ShareCommercially"))
    except TypeError:
        return list(ddgs.images(query, max_results=max_results))


def _ddg_image_search(query: str, max_results: int) -> list[dict[str, Any]]:
    """DuckDuckGo image search with source preference and rights metadata."""
    try:
        ddgs = DDGS()
        safe_sites = " OR ".join(f"site:{domain}" for domain in ["commons.wikimedia.org", "unsplash.com", "pexels.com", "pixabay.com"])
        searches = [f"{query} ({safe_sites})", query]
        results: list[dict[str, Any]] = []
        seen: set[str] = set()
        for search_query in searches:
            if len(results) >= max_results:
                break
            raw = _ddg_images(ddgs, search_query, max(max_results * 2, 8))
            for item in raw:
                result = _image_result_from_item(item)
                if not result:
                    continue
                key = str(result.get("image_url") or "")
                if not key or key in seen:
                    continue
                seen.add(key)
                results.append(result)
                if len(results) >= max_results:
                    break
        results.sort(key=lambda item: (not bool(item.get("license_safe_source")), str(item.get("title") or "")))
        return results[:max_results]
    except Exception:
        return []


def retrieve_sources(query: str, max_results: int = 6) -> list[dict[str, Any]]:
    """Search with multi-engine aggregation and quality-preserving dedupe.
    
    Runs DDG, LangSearch, and Serper in parallel for speed.
    """
    raw_results: list[dict[str, Any]] = []
    raw_results.extend(_direct_fetch_sources(query))

    # Parallel search across all engines (DDG + LangSearch + Serper)
    search_fns = [
        ("ddg", lambda: _ddg_search(query, max_results)),
        ("langsearch", lambda: _langsearch_search(query, max_results)),
        ("serper", lambda: _serper_search(query, max_results)),
    ]
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            futures = {
                pool.submit(fn): name for name, fn in search_fns
            }
            done, _ = concurrent.futures.wait(futures.keys(), timeout=12)
            for future in done:
                try:
                    engine_results = future.result(timeout=1)
                    if engine_results:
                        raw_results.extend(engine_results)
                except Exception:
                    continue
    except Exception as e:
        print(f"[Credon] Parallel search error: {e}")
        # Sequential fallback
        raw_results.extend(_ddg_search(query, max_results))

    if not raw_results:
        raw_results = _google_scrape_search(query, max_results)
    if not raw_results:
        return _wikipedia_fallback(query)

    merged_raw = _dedupe_raw_results(raw_results, cap=max(max_results * 3, 12))

    urls_to_extract: list[str] = []
    for item in merged_raw[:8]:
        url = item.get("href") or item.get("url") or ""
        if url:
            urls_to_extract.append(url)

    extraction_mode = _page_extraction_mode()
    should_extract = (
        extraction_mode == "full"
        or (extraction_mode == "strategic" and _is_complex_query(query))
    )
    budget = _extraction_budget(query, max_results)
    extract_targets = urls_to_extract[:budget]
    page_texts = _extract_parallel(extract_targets) if (should_extract and extract_targets) else {}

    collected: list[dict[str, Any]] = []
    for item in merged_raw:
        title = item.get("title") or "Untitled"
        url = item.get("href") or item.get("url") or ""
        snippet = item.get("body") or ""
        if not url:
            continue
        final_snippet = page_texts.get(url, "") or snippet
        collected.append({"title": title, "url": url, "snippet": final_snippet})

    return collected[:max_results]


def _dedupe_raw_results(raw_results: list[dict[str, Any]], cap: int) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw_results:
        url = str(item.get("href") or item.get("url") or "").strip()
        title = str(item.get("title") or "").strip()
        if not url:
            continue
        key = url.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(
            {
                "title": title or url,
                "href": url,
                "body": str(item.get("body") or item.get("snippet") or "").strip(),
            }
        )
        if len(deduped) >= cap:
            break
    return deduped


def _direct_fetch_sources(query: str) -> list[dict[str, Any]]:
    urls = re.findall(r"https?://[^\s)]+", query)
    if not urls:
        return []
    pages = _extract_parallel(urls[:3], max_chars=700)
    results: list[dict[str, Any]] = []
    for url in urls[:3]:
        snippet = pages.get(url, "").strip()
        if snippet:
            results.append(
                {
                    "title": f"Direct source: {url.split('/')[2] if '://' in url else url}",
                    "href": url,
                    "body": snippet,
                }
            )
    return results


def _ddg_search(query: str, max_results: int) -> list[dict[str, Any]]:
    """DuckDuckGo search (primary)."""
    try:
        ddgs = DDGS()
        return list(ddgs.text(query, max_results=max_results))
    except Exception as e:
        print(f"[Credon] DDG search failed: {e}")
        return []


def _langsearch_search(query: str, max_results: int) -> list[dict[str, Any]]:
    """LangSearch web search (optional, OpenAI-compatible style endpoint)."""
    api_key = os.getenv("LANGSEARCH_API_KEY", "").strip()
    if not api_key:
        return []
    try:
        base_url = os.getenv("LANGSEARCH_BASE_URL", "https://api.langsearch.com/v1/web-search").strip()
        resp = requests.post(
            base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={"query": query, "top_k": max_results},
            timeout=10,
        )
        if not resp.ok:
            return []
        payload = cast(dict[str, Any], resp.json())
        raw_items = cast(list[Any], payload.get("results") or payload.get("data") or [])
        results: list[dict[str, Any]] = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            entry = cast(dict[str, Any], item)
            results.append({
                "title": str(entry.get("title", "")),
                "href": str(entry.get("url", "") or entry.get("link", "")),
                "body": str(entry.get("snippet", "") or entry.get("description", "")),
            })
        return results[:max_results]
    except Exception as e:
        print(f"[Credon] LangSearch failed: {e}")
        return []


def _serper_search(query: str, max_results: int) -> list[dict[str, Any]]:
    """Serper Google API search fallback."""
    api_key = os.getenv("SERPER_API_KEY", "").strip()
    if not api_key:
        return []
    try:
        resp = requests.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            data=json.dumps({"q": query, "num": max_results}),
            timeout=10,
        )
        if not resp.ok:
            return []
        data = cast(dict[str, Any], resp.json())
        results: list[dict[str, Any]] = []
        for item in cast(list[Any], data.get("organic", [])):
            if not isinstance(item, dict):
                continue
            entry = cast(dict[str, Any], item)
            results.append(
                {
                    "title": str(entry.get("title", "")),
                    "href": str(entry.get("link", "")),
                    "body": str(entry.get("snippet", "")),
                }
            )
        return results[:max_results]
    except Exception as e:
        print(f"[Credon] Serper search failed: {e}")
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
