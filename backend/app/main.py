from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from dotenv import load_dotenv
from pathlib import Path
import os
import random
import re
from datetime import datetime, timedelta, timezone
from time import time
from typing import Any, cast
import requests
from app.routes.chat import router as chat_router
from app.routes.ingest import router as ingest_router
from app.routes.generate import router as generate_router
from app.routes.agent import router as agent_router
from app.routes.platform import router as platform_router, run_due_jobs
from app.routes.selfevolve import router as selfevolve_router
from app.services.knowledge_store import list_user_knowledge_snippets, postgres_health
from app.services.chat_store import firestore_health
from app.services.models import generate_sync
from app.services.retrieval_v2 import retrieve_sources

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

app = FastAPI(
    title="Credon AI API",
    version="0.1.0",
    description=(
        "Credon AI — Intelligent Research Assistant API.\n\n"
        "Provides chat (streaming + sync), knowledge ingestion, "
        "model listing, session history, and feedback endpoints.\n\n"
        "**Base path:** `/api/v1`"
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)


def _cors_origins() -> list[str]:
    configured = os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    )
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_origin_regex=os.getenv(
        "CORS_ALLOW_ORIGIN_REGEX",
        r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$",
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(chat_router, prefix="/api/v1", tags=["Chat"])
app.include_router(ingest_router, prefix="/api/v1", tags=["Ingest"])
app.include_router(generate_router, prefix="/api/v1", tags=["Generate"])
app.include_router(agent_router, prefix="/api/v1", tags=["Agent"])
app.include_router(platform_router, prefix="/api/v1", tags=["Platform"])
app.include_router(selfevolve_router, prefix="/api/v1", tags=["Self-evolution"])


@app.get("/", include_in_schema=False)
def root():
    """Redirect root to API docs."""
    return RedirectResponse(url="/docs")


@app.get("/health", tags=["System"])
def health() -> dict[str, str]:
    """Health check endpoint. Also opportunistically runs due scheduled jobs."""
    try:
        run_due_jobs()
    except Exception:
        pass
    return {"status": "ok"}


@app.get("/health/mesh", tags=["System"])
def health_mesh() -> dict[str, object]:
    """Live Credon Unlimited Mesh status — lanes, cooldowns, token windows."""
    from app.services.mesh import mesh_status

    return mesh_status()


def _safe_bool_env(name: str) -> bool:
    return bool(os.getenv(name, "").strip())


def _provider_check_openai_compatible(
    name: str, key_env: str, default_base: str
) -> dict[str, object]:
    """Generic /models readiness probe for OpenAI-compatible providers."""
    api_key = os.getenv(key_env, "").strip()
    base_url = os.getenv(f"{key_env.rsplit('_API_KEY', 1)[0]}_BASE_URL", default_base).rstrip("/")
    if not api_key:
        return {"configured": False, "ok": False, "error": "missing_api_key"}
    try:
        resp = requests.get(
            f"{base_url}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=6,
        )
        return {
            "configured": True,
            "ok": resp.ok,
            "http_status": resp.status_code,
            "error": "" if resp.ok else "provider_unreachable_or_auth_failed",
        }
    except Exception as exc:
        return {"configured": True, "ok": False, "error": str(exc)}


def _provider_check_deepseek() -> dict[str, object]:
    return _provider_check_openai_compatible("deepseek", "DEEPSEEK_API_KEY", "https://api.deepseek.com")


def _provider_check_groq() -> dict[str, object]:
    return _provider_check_openai_compatible("groq", "GROQ_API_KEY", "https://api.groq.com/openai/v1")


def _provider_check_openrouter() -> dict[str, object]:
    return _provider_check_openai_compatible("openrouter", "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1")


def _provider_check_gemini() -> dict[str, object]:
    return _provider_check_openai_compatible("gemini", "GEMINI_API_KEY", "https://generativelanguage.googleapis.com/v1beta/openai")


def _provider_check_serper() -> dict[str, object]:
    api_key = os.getenv("SERPER_API_KEY", "").strip()
    if not api_key:
        return {"configured": False, "ok": False, "error": "missing_api_key"}
    try:
        resp = requests.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            json={"q": "credon health", "num": 1},
            timeout=5,
        )
        return {
            "configured": True,
            "ok": resp.ok,
            "http_status": resp.status_code,
            "error": "" if resp.ok else "provider_unreachable_or_auth_failed",
        }
    except Exception as exc:
        return {"configured": True, "ok": False, "error": str(exc)}


def _provider_check_langsearch() -> dict[str, object]:
    api_key = os.getenv("LANGSEARCH_API_KEY", "").strip()
    base_url = os.getenv("LANGSEARCH_BASE_URL", "https://api.langsearch.com/v1/web-search").rstrip("/")
    if not api_key:
        return {"configured": False, "ok": False, "error": "missing_api_key"}
    try:
        resp = requests.post(
            base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={"query": "credon health", "top_k": 1},
            timeout=5,
        )
        return {
            "configured": True,
            "ok": resp.ok,
            "http_status": resp.status_code,
            "error": "" if resp.ok else "provider_unreachable_or_auth_failed",
        }
    except Exception as exc:
        return {"configured": True, "ok": False, "error": str(exc)}


def _provider_check_ollama() -> dict[str, object]:
    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    enabled = os.getenv("USE_LOCAL_MODEL", "true").lower() == "true"
    if not enabled:
        return {"configured": False, "ok": False, "error": "disabled_by_env"}
    try:
        resp = requests.get(f"{base_url}/api/tags", timeout=3)
        return {
            "configured": True,
            "ok": resp.ok,
            "http_status": resp.status_code,
            "error": "" if resp.ok else "ollama_unreachable",
        }
    except Exception as exc:
        return {"configured": True, "ok": False, "error": str(exc)}


@app.get("/health/providers", tags=["System"])
def health_providers() -> dict[str, object]:
    """Live provider readiness checks for model and retrieval services."""
    checks = {
        "groq": _provider_check_groq(),
        "openrouter": _provider_check_openrouter(),
        "gemini": _provider_check_gemini(),
        "deepseek": _provider_check_deepseek(),
        "serper": _provider_check_serper(),
        "langsearch": _provider_check_langsearch(),
        "ollama": _provider_check_ollama(),
        "firestore": firestore_health(),
        "supabase": postgres_health(),
    }
    ready_count = sum(1 for item in checks.values() if bool(item.get("ok")))
    return {
        "status": "ok",
        "runtime": {
            "model_runtime_mode": os.getenv("MODEL_RUNTIME_MODE", "auto"),
            "use_model_generation": os.getenv("USE_MODEL_GENERATION", "true").lower() == "true",
            "use_web_search": os.getenv("USE_WEB_SEARCH", "true").lower() == "true",
            "keys_present": {
                "GROQ_API_KEY": _safe_bool_env("GROQ_API_KEY"),
                "OPENROUTER_API_KEY": _safe_bool_env("OPENROUTER_API_KEY"),
                "GEMINI_API_KEY": _safe_bool_env("GEMINI_API_KEY"),
                "DEEPSEEK_API_KEY": _safe_bool_env("DEEPSEEK_API_KEY"),
                "SERPER_API_KEY": _safe_bool_env("SERPER_API_KEY"),
                "LANGSEARCH_API_KEY": _safe_bool_env("LANGSEARCH_API_KEY"),
            },
        },
        "checks": checks,
        "ready_providers": ready_count,
    }


_SUGGESTIONS_CACHE_TTL_SEC = 600.0
_SUGGESTIONS_CACHE: dict[str, tuple[float, list[str]]] = {}

_FALLBACK_TRENDING_PROMPTS = [
    "What are the biggest AI trends to watch in 2026?",
    "How are AI agents changing everyday work?",
    "What is quantum computing and why does it matter now?",
    "Which skills will be most valuable for tech jobs in 2026?",
    "How is climate tech evolving worldwide this year?",
    "What are India’s fastest-growing startup sectors in 2026?",
    "How can students use AI tools without cheating?",
    "What is multimodal AI in simple words?",
    "How are robots and AI being used in healthcare?",
    "What cybersecurity risks are rising with generative AI?",
    "How does machine learning power recommendation systems?",
    "What are the latest breakthroughs in space technology?",
]


def _clean_suggestion_line(line: str) -> str:
    item = re.sub(r"^\s*(?:[-•*]|\d+[.)])\s*", "", line).strip().strip('"')
    item = re.sub(r"\s+", " ", item)
    return item[:110].rstrip(" .")


def _question_from_source(title: str, snippet: str) -> str:
    text = _clean_suggestion_line(title or snippet)
    text = re.sub(r"\s*[-|–—].*$", "", text).strip()
    text = re.sub(r"\b(live updates?|breaking|explained)\b", "", text, flags=re.I).strip(" :-")
    if not text:
        return "What are people talking about in tech today?"
    if text.endswith("?"):
        return text
    lowered = text.lower()
    if any(word in lowered for word in ["trend", "trends", "future", "forecast", "report"]):
        return f"What should I know about {text}?"
    return f"Explain {text} simply"


def _wikipedia_trending_prompts() -> list[str]:
    """Keyless 'most read' topics from the Wikimedia featured feed.

    Works from server IPs (unlike DuckDuckGo), so trending starter prompts stay
    fresh in production even when web search is blocked.
    """
    prompts: list[str] = []
    deadline = time() + 4.5  # hard cap on total cache-miss latency added here
    for delta in (1, 2):  # yesterday first; the day before is a rare fallback
        remaining = deadline - time()
        if remaining <= 0:
            break
        day = (datetime.now(timezone.utc) - timedelta(days=delta)).strftime("%Y/%m/%d")
        try:
            resp = requests.get(
                f"https://en.wikipedia.org/api/rest_v1/feed/featured/{day}",
                headers={"User-Agent": "CredonAI/1.0 (https://credonai.web.app; trending)"},
                timeout=min(3.0, remaining),
            )
            if not resp.ok:
                continue
            articles = cast(list[Any], resp.json().get("mostread", {}).get("articles", []))
        except Exception:
            continue
        for art in articles:
            if not isinstance(art, dict):
                continue
            title = str((art.get("titles", {}) or {}).get("normalized") or art.get("title") or "").replace("_", " ").strip()
            low = title.lower()
            if not title or ":" in title or low.startswith("main page") or "deaths in" in low:
                continue
            prompt = f"What's the story behind {title} that's trending right now?"
            if prompt not in prompts:
                prompts.append(prompt)
            if len(prompts) >= 12:
                break
        if prompts:
            break
    return prompts


def _trending_web_prompts() -> list[str]:
    cache_key = "global_trending_prompts"
    cached = _SUGGESTIONS_CACHE.get(cache_key)
    now = time()
    if cached and now - cached[0] < _SUGGESTIONS_CACHE_TTL_SEC:
        return list(cached[1])

    queries = [
        "2026 trending technology AI science startup topics India worldwide",
        "latest AI technology trends 2026 students developers business",
    ]
    prompts: list[str] = []
    prompts.extend(_wikipedia_trending_prompts())
    for query in queries:
        try:
            for src in retrieve_sources(query, max_results=8):
                prompt = _question_from_source(str(src.get("title") or ""), str(src.get("snippet") or ""))
                if 18 <= len(prompt) <= 120 and prompt not in prompts:
                    prompts.append(prompt)
        except Exception:
            continue

    prompts.extend(p for p in _FALLBACK_TRENDING_PROMPTS if p not in prompts)
    _SUGGESTIONS_CACHE[cache_key] = (now, prompts[:24])
    return prompts[:24]


@app.get("/api/suggestions", tags=["System"])
def api_suggestions(user_id: str = Query(..., min_length=1)) -> dict[str, list[str]]:
    snippets = list_user_knowledge_snippets(user_id=user_id, limit=6)
    cleaned: list[str] = []

    if snippets:
        prompt = (
            "Generate 8 short, distinct user questions based on these notes. "
            "Return each as a plain line without numbering.\n\n" + "\n".join(snippets[:6])
        )
        text = generate_sync([{"role": "user", "content": prompt}])
        for line in text.splitlines():
            item = _clean_suggestion_line(line)
            if item and item not in cleaned:
                cleaned.append(item)

    if len(cleaned) < 8:
        cleaned.extend(p for p in _trending_web_prompts() if p not in cleaned)

    selected = cleaned[:4] if len(cleaned) <= 4 else random.sample(cleaned, k=4)
    return {"suggestions": selected}
