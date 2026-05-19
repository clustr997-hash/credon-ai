from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from dotenv import load_dotenv
from pathlib import Path
import os
import requests
from app.routes.chat import router as chat_router
from app.routes.ingest import router as ingest_router
from app.routes.generate import router as generate_router
from app.services.knowledge_store import list_user_knowledge_snippets
from app.services.models import generate_sync

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


@app.get("/", include_in_schema=False)
def root():
    """Redirect root to API docs."""
    return RedirectResponse(url="/docs")


@app.get("/health", tags=["System"])
def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}


def _safe_bool_env(name: str) -> bool:
    return bool(os.getenv(name, "").strip())


def _provider_check_deepseek() -> dict[str, object]:
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
    if not api_key:
        return {"configured": False, "ok": False, "error": "missing_api_key"}
    try:
        resp = requests.get(
            f"{base_url}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=4,
        )
        return {
            "configured": True,
            "ok": resp.ok,
            "http_status": resp.status_code,
            "error": "" if resp.ok else "provider_unreachable_or_auth_failed",
        }
    except Exception as exc:
        return {"configured": True, "ok": False, "error": str(exc)}


def _provider_check_groq() -> dict[str, object]:
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    base_url = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
    if not api_key:
        return {"configured": False, "ok": False, "error": "missing_api_key"}
    try:
        resp = requests.get(
            f"{base_url}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=4,
        )
        return {
            "configured": True,
            "ok": resp.ok,
            "http_status": resp.status_code,
            "error": "" if resp.ok else "provider_unreachable_or_auth_failed",
        }
    except Exception as exc:
        return {"configured": True, "ok": False, "error": str(exc)}


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
        "deepseek": _provider_check_deepseek(),
        "groq": _provider_check_groq(),
        "serper": _provider_check_serper(),
        "langsearch": _provider_check_langsearch(),
        "ollama": _provider_check_ollama(),
    }
    ready_count = sum(1 for item in checks.values() if bool(item.get("ok")))
    return {
        "status": "ok",
        "runtime": {
            "model_runtime_mode": os.getenv("MODEL_RUNTIME_MODE", "auto"),
            "use_model_generation": os.getenv("USE_MODEL_GENERATION", "true").lower() == "true",
            "use_web_search": os.getenv("USE_WEB_SEARCH", "true").lower() == "true",
            "keys_present": {
                "DEEPSEEK_API_KEY": _safe_bool_env("DEEPSEEK_API_KEY"),
                "GROQ_API_KEY": _safe_bool_env("GROQ_API_KEY"),
                "SERPER_API_KEY": _safe_bool_env("SERPER_API_KEY"),
                "LANGSEARCH_API_KEY": _safe_bool_env("LANGSEARCH_API_KEY"),
            },
        },
        "checks": checks,
        "ready_providers": ready_count,
    }


@app.get("/api/suggestions", tags=["System"])
def api_suggestions(user_id: str = Query(..., min_length=1)) -> dict[str, list[str]]:
    snippets = list_user_knowledge_snippets(user_id=user_id, limit=6)
    if snippets:
        prompt = (
            "Generate 4 short, distinct user questions based on these notes. "
            "Return each as a plain line without numbering.\n\n" + "\n".join(snippets[:6])
        )
    else:
        prompt = (
            'Provide 4 unique, curiosity-driven, trending topics in India or worldwide for 2026 as question prompts. '
            'Return only 4 lines, no numbering.'
        )

    text = generate_sync([{"role": "user", "content": prompt}])
    lines = [ln.strip("-• 	") for ln in text.splitlines() if ln.strip()]
    cleaned: list[str] = []
    for ln in lines:
        item = ln.split('.', 1)[-1].strip() if re.match(r"^\d+[.)]", ln) else ln
        if item and item not in cleaned:
            cleaned.append(item)
        if len(cleaned) >= 4:
            break
    if not cleaned:
        cleaned = [
            "What major AI breakthroughs are expected in 2026?",
            "How is climate tech evolving worldwide this year?",
            "What are India’s fastest-growing startup sectors in 2026?",
            "Which global trends will shape jobs over the next 5 years?",
        ]
    return {"suggestions": cleaned[:4]}
