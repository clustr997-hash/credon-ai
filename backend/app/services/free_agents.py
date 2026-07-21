from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

import requests


def is_weather_query(query: str) -> bool:
    q = query.lower()
    return bool(re.search(r"\b(weather|rain|raining|temperature|forecast|umbrella|humidity|wind)\b", q))


def is_news_query(query: str) -> bool:
    q = query.lower()
    return bool(re.search(r"\b(news|headlines|breaking|latest updates|current events|today's news|today news)\b", q))


def manager_plan(query: str, *, use_web: bool, deep_think: bool, code_mode: bool) -> dict[str, Any]:
    q = query.lower().strip()
    agents: list[str] = []
    if is_weather_query(q):
        agents.append("Weather Agent")
    if is_news_query(q):
        agents.append("News Agent")
    if re.search(r"\b(code|debug|bug|python|javascript|typescript|react|api|sql|html|css)\b", q):
        agents.append("Code Agent")
    if re.search(r"\b(image|picture|diagram|chart|compare|show me|visual)\b", q):
        agents.append("Visual Agent")
    if use_web or re.search(r"\b(latest|source|research|current|today|2026)\b", q):
        agents.append("Research Agent")
    if deep_think or re.search(r"\b(why|analyze|strategy|compare|deep|explain)\b", q):
        agents.append("Reasoning Agent")
    if not agents:
        agents.append("General Answer Agent")

    # Preserve order while removing duplicates.
    unique_agents = list(dict.fromkeys(agents))
    return {
        "intent": _intent_label(q),
        "agents": unique_agents,
        "mode": {
            "web": use_web,
            "deep_think": deep_think,
            "code_mode": code_mode,
            "master_mode": use_web and deep_think and code_mode,
        },
        "reason": "Credon Manager selected tools from query intent, requested modes, and freshness needs.",
    }


def _intent_label(q: str) -> str:
    if is_weather_query(q):
        return "weather"
    if is_news_query(q):
        return "news"
    if re.search(r"\b(code|debug|bug|program|api|html|css|python|javascript|typescript)\b", q):
        return "coding"
    if re.search(r"\b(compare|chart|table|visualize|trend)\b", q):
        return "visual_analysis"
    if re.search(r"\b(explain|what is|why|how|analyze)\b", q):
        return "explanation"
    return "general"


def _extract_location(query: str) -> str | None:
    q = query.strip()
    patterns = [
        r"\b(?:in|at|for)\s+([A-Za-z][A-Za-z\s,.-]{2,40})\??$",
        r"\b(?:weather|rain|forecast)\s+(?:in|at|for)\s+([A-Za-z][A-Za-z\s,.-]{2,40})",
    ]
    for pat in patterns:
        match = re.search(pat, q, flags=re.IGNORECASE)
        if match:
            loc = re.sub(r"\b(today|tomorrow|now|please)\b", "", match.group(1), flags=re.IGNORECASE).strip(" ,.-")
            if loc:
                return loc
    return None


def _geocode_location(location: str) -> dict[str, Any] | None:
    resp = requests.get(
        "https://geocoding-api.open-meteo.com/v1/search",
        params={"name": location, "count": 1, "language": "en", "format": "json"},
        timeout=8,
    )
    resp.raise_for_status()
    results = resp.json().get("results") or []
    return results[0] if results else None


def _reverse_geocode(latitude: float, longitude: float) -> str | None:
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": latitude, "lon": longitude, "format": "jsonv2", "zoom": 10},
            headers={"User-Agent": "CredonAI/1.0 (location label for weather answers)"},
            timeout=8,
        )
        resp.raise_for_status()
        address = resp.json().get("address") or {}
        parts = [
            address.get("city") or address.get("town") or address.get("village") or address.get("county"),
            address.get("state"),
            address.get("country"),
        ]
        label = ", ".join(str(x) for x in parts if x)
        return label or None
    except Exception:
        return None


def is_location_identity_query(query: str) -> bool:
    q = query.lower()
    return bool(re.search(r"\b(my|current|this)\s+(district|county|city|state|location|address)\b|\bwhat\s+is\s+my\s+(district|county|city|state|location)\b|\bwhich\s+(district|county|city|state)\s+am\s+i\s+in\b", q))


def location_identity_answer(query: str, language: str, latitude: float | None = None, longitude: float | None = None) -> tuple[str, list[dict[str, str]], dict[str, Any]] | None:
    if not is_location_identity_query(query):
        return None
    if latitude is None or longitude is None:
        answer = (
            "I can tell your district/city if location access is enabled. Please allow browser location and ask again, or type your village/city/state."
            if language == "en"
            else "Main aapka district/city bata sakta hoon agar location access on ho. Browser location allow karke phir poochho, ya apna village/city/state type karo."
        )
        return answer, [], {"agent": "location_identity", "needs_location": True}
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": latitude, "lon": longitude, "format": "jsonv2", "zoom": 12},
            headers={"User-Agent": "CredonAI/1.0 (location identity answers)"},
            timeout=8,
        )
        resp.raise_for_status()
        address = resp.json().get("address") or {}
    except Exception:
        return None

    district = address.get("county") or address.get("state_district") or address.get("district")
    city = address.get("city") or address.get("town") or address.get("village") or address.get("municipality")
    state = address.get("state")
    country = address.get("country")
    if language == "hinglish":
        answer = "## 📍 Aapki location info\n\n"
        answer += f"- **District/County:** {district or 'not clearly found'}\n"
        answer += f"- **City/Town/Village:** {city or 'not clearly found'}\n"
        answer += f"- **State:** {state or 'not clearly found'}\n"
        answer += f"- **Country:** {country or 'not clearly found'}\n\n"
        answer += "Note: Ye browser GPS coordinates se estimate hai; exact official district ke liye address/village name bhejo."
    else:
        answer = "## 📍 Your location info\n\n"
        answer += f"- **District/County:** {district or 'not clearly found'}\n"
        answer += f"- **City/Town/Village:** {city or 'not clearly found'}\n"
        answer += f"- **State:** {state or 'not clearly found'}\n"
        answer += f"- **Country:** {country or 'not clearly found'}\n\n"
        answer += "Note: This is estimated from browser GPS coordinates; share your address/village name for an official district check."
    return answer, [{"title": "OpenStreetMap Nominatim", "url": "https://nominatim.openstreetmap.org/"}], {
        "agent": "location_identity",
        "district": district or "",
        "city": city or "",
        "state": state or "",
        "country": country or "",
    }


def weather_answer(query: str, language: str, latitude: float | None = None, longitude: float | None = None) -> tuple[str, list[dict[str, str]], dict[str, Any]] | None:
    if not is_weather_query(query):
        return None
    location_label = "your current location"
    loc = _extract_location(query)
    try:
        if loc and (latitude is None or longitude is None):
            geo = _geocode_location(loc)
            if not geo:
                return None
            latitude = float(geo["latitude"])
            longitude = float(geo["longitude"])
            location_label = ", ".join(str(x) for x in [geo.get("name"), geo.get("admin1"), geo.get("country")] if x)
        if latitude is None or longitude is None:
            return None
        if not loc:
            location_label = _reverse_geocode(latitude, longitude) or location_label
        resp = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": latitude,
                "longitude": longitude,
                "current": "temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m",
                "hourly": "precipitation_probability,temperature_2m,rain",
                "forecast_days": 1,
                "timezone": "auto",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None

    current = data.get("current") or {}
    hourly = data.get("hourly") or {}
    probs = [int(x or 0) for x in (hourly.get("precipitation_probability") or [])[:12]]
    hours = [str(x)[11:16] if "T" in str(x) else str(x) for x in (hourly.get("time") or [])[:12]]
    max_rain = max(probs) if probs else 0
    temp = current.get("temperature_2m")
    humidity = current.get("relative_humidity_2m")
    wind = current.get("wind_speed_10m")
    rain_now = current.get("rain") or current.get("precipitation") or 0
    verdict = "Yes, rain is likely today" if max_rain >= 55 or float(rain_now or 0) > 0 else "Rain looks unlikely today"

    if language == "hinglish":
        answer = (
            f"## 🌦 Weather Agent — {location_label}\n\n"
            f"**Verdict:** {verdict}.\n\n"
            f"| Metric | Now |\n|---|---:|\n| Temperature | {temp}°C |\n| Humidity | {humidity}% |\n| Wind | {wind} km/h |\n| Rain now | {rain_now} mm |\n| Max rain chance next 12h | {max_rain}% |\n\n"
            "Agar exact local forecast chahiye, browser location allow rakho ya city name ke saath poochho."
        )
    else:
        answer = (
            f"## 🌦 Weather Agent — {location_label}\n\n"
            f"**Verdict:** {verdict}.\n\n"
            f"| Metric | Now |\n|---|---:|\n| Temperature | {temp}°C |\n| Humidity | {humidity}% |\n| Wind | {wind} km/h |\n| Rain now | {rain_now} mm |\n| Max rain chance next 12h | {max_rain}% |\n\n"
            "For more precise results, allow location access or ask with a city name."
        )
    return answer, [{"title": "Open-Meteo Forecast API", "url": "https://open-meteo.com/"}], {
        "agent": "weather",
        "rain_probability_12h": max_rain,
        "chart": {"type": "bar", "title": "Rain chance next 12 hours", "labels": hours, "values": probs, "unit": "%"},
    }


def _news_topic(query: str) -> str:
    q = re.sub(r"\b(show|give|tell|me|latest|breaking|news|headlines|updates|today|current events|about|on|top|\d+)\b", " ", query, flags=re.IGNORECASE)
    q = re.sub(r"\s+", " ", q).strip(" ?.,")
    return q or "technology OR artificial intelligence OR world"


def _news_scope_queries(query: str, topic: str) -> list[tuple[str, str]]:
    q = query.lower()
    wants_broad = any(word in q for word in ["national", "state", "district", "local", "international", "all news", "all updates"])
    if not wants_broad:
        return [("Top", topic)]

    # No-key broad coverage. Users can include a state/district/city in the topic; otherwise India is used as the national anchor.
    local_topic = topic if topic and topic != "technology OR artificial intelligence OR world" else "India"
    return [
        ("National", f"India {local_topic}"),
        ("State / local", local_topic),
        ("International", f"world {topic}"),
    ]


def news_answer(query: str, language: str, max_items: int = 6) -> tuple[str, list[dict[str, str]], dict[str, Any]] | None:
    if not is_news_query(query):
        return None
    topic = _news_topic(query)
    clean_articles: list[dict[str, str]] = []
    seen_urls: set[str] = set()
    scope_queries = _news_scope_queries(query, topic)
    per_scope = max(2, min(max_items, 4)) if len(scope_queries) > 1 else max_items
    for scope, scope_query in scope_queries:
        try:
            resp = requests.get(
                "https://api.gdeltproject.org/api/v2/doc/doc",
                params={
                    "query": scope_query,
                    "mode": "ArtList",
                    "format": "json",
                    "maxrecords": per_scope,
                    "sort": "HybridRel",
                },
                timeout=10,
            )
            resp.raise_for_status()
            articles = resp.json().get("articles") or []
        except Exception:
            articles = []

        for article in articles[:per_scope]:
            title = str(article.get("title") or "").strip()
            url = str(article.get("url") or "").strip()
            domain = str(article.get("domain") or "").strip()
            seen = str(article.get("seendate") or "").strip()
            if title and url and url not in seen_urls:
                seen_urls.add(url)
                clean_articles.append({"title": title, "url": url, "domain": domain, "seen": seen, "scope": scope})
    if not clean_articles:
        return None

    now = datetime.now(timezone.utc).strftime("%B %d, %Y %H:%M UTC")
    lines = [f"## 📰 News Agent — latest results for {topic}", "", f"Checked: **{now}**", ""]
    for idx, article in enumerate(clean_articles, 1):
        source_note = f" — {article['domain']}" if article.get("domain") else ""
        scope_note = f"[{article.get('scope', 'Top')}] "
        lines.append(f"{idx}. {scope_note}**{article['title']}**{source_note}")
    lines.extend([
        "",
        "**Why this answer is different:** Credon used a dedicated no-key News Agent before normal model generation, so fresh-news questions do not rely only on static model memory.",
    ])
    if language == "hinglish":
        lines.append("\nAap kisi headline ka number bhejoge to main usko simple Hinglish me explain kar dunga.")
    else:
        lines.append("\nSend any headline number and I can explain it in simpler detail.")

    sources = [{"title": item["title"], "url": item["url"]} for item in clean_articles]
    return "\n".join(lines), sources, {
        "agent": "news",
        "topic": topic,
        "scopes": [scope for scope, _ in scope_queries],
        "tools": ["GDELT Doc API"],
        "freshness": now,
    }
