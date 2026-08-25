"""Multi-model orchestration layer with production-safe failover.

Supports local Ollama + cloud providers (DeepSeek, Groq) with
deterministic fallback order so behavior remains stable after deployment.
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from typing import Any, Generator, cast
import math
import hashlib

import requests

# ── Available model registry ─────────────────────────────────────

CLOUD_PROVIDERS = {"groq", "openrouter", "gemini", "deepseek"}


@dataclass
class ModelInfo:
    id: str
    label: str
    provider: str          # internal: "ollama" | "groq" | "openrouter" | "gemini" | "deepseek"
    description: str
    default: bool = False


# ── Credon model family (user-facing) ───────────────────────────
# Each brand id maps to a free-tier endpoint internally. The UI only
# ever sees the Credon name — provider routing stays server-side.
BRAND_MODELS: dict[str, dict[str, str]] = {
    "credon-alpha": {
        "provider": "groq",
        "api_model": "llama-3.3-70b-versatile",
        "label": "Credon Alpha",
        "description": "Fast, capable — the everyday default",
    },
    "credon-alpha-reasoning": {
        "provider": "groq",
        "api_model": "openai/gpt-oss-120b",
        "label": "Credon Alpha Reasoning",
        "description": "Thinks step by step — math, logic, code",
    },
    "credon-alpha-flash": {
        "provider": "groq",
        "api_model": "openai/gpt-oss-20b",
        "label": "Credon Alpha Flash",
        "description": "Quickest replies for simple tasks",
    },
    "credon-deep": {
        "provider": "openrouter",
        "api_model": "deepseek/deepseek-r1:free",
        "label": "Credon Deep",
        "description": "Extended reasoning for hard research",
    },
    "credon-scout": {
        "provider": "gemini",
        "api_model": "gemini-2.5-flash",
        "label": "Credon Scout",
        "description": "Multimodal — reads images and dense documents",
    },
}

_BRAND_CHAIN = [
    "credon-alpha",
    "credon-alpha-reasoning",
    "credon-alpha-flash",
    "credon-deep",
    "credon-scout",
]


def _brand_entry(model: str) -> dict[str, str] | None:
    return BRAND_MODELS.get(model)


def _static_models_from_brands() -> list[ModelInfo]:
    models: list[ModelInfo] = []
    for brand_id, entry in BRAND_MODELS.items():
        models.append(
            ModelInfo(
                brand_id,
                entry["label"],
                entry["provider"],
                entry["description"],
                default=brand_id == "credon-alpha",
            )
        )
    return models


_STATIC_MODELS: list[ModelInfo] = _static_models_from_brands()


def _ollama_url() -> str:
    return os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")


def _deepseek_url() -> str:
    return os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


def _deepseek_api_key() -> str:
    return os.getenv("DEEPSEEK_API_KEY", "").strip()


def _groq_url() -> str:
    return os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")


def _groq_api_key() -> str:
    return os.getenv("GROQ_API_KEY", "").strip()


def _openrouter_url() -> str:
    return os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")


def _openrouter_api_key() -> str:
    return os.getenv("OPENROUTER_API_KEY", "").strip()


def _gemini_url() -> str:
    return os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai").rstrip("/")


def _gemini_api_key() -> str:
    return os.getenv("GEMINI_API_KEY", "").strip()


def _provider_credentials(provider: str) -> tuple[str, str]:
    """Return (api_key, base_url) for a cloud provider.
    Mesh lanes (nvidia/cerebras/mistral/zai) resolve through the registry."""
    from . import mesh

    if provider in {"nvidia", "cerebras", "mistral", "zai"}:
        api_key, base_url, _ = mesh.lane_credentials(provider)
        return api_key, base_url
    if provider == "deepseek":
        return _deepseek_api_key(), _deepseek_url()
    if provider == "groq":
        return _groq_api_key(), _groq_url()
    if provider == "openrouter":
        return _openrouter_api_key(), _openrouter_url()
    if provider == "gemini":
        return _gemini_api_key(), _gemini_url()
    return "", ""


def _provider_headers(provider: str, api_key: str) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://credon-ai.local"
        headers["X-Title"] = "Credon AI"
    return headers


def _runtime_mode() -> str:
    """Runtime mode: auto | cloud | local."""
    mode = os.getenv("MODEL_RUNTIME_MODE", "auto").strip().lower()
    return mode if mode in {"auto", "cloud", "local"} else "auto"


def _deepseek_default_model() -> str:
    return os.getenv("DEEPSEEK_MODEL", "deepseek-reasoner").strip() or "deepseek-reasoner"


def _groq_default_model() -> str:
    model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip() or "llama-3.3-70b-versatile"
    return model if model.startswith("groq:") else f"groq:{model}"


def _openrouter_default_model() -> str:
    model = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free").strip()
    return model if model.startswith("or:") else f"or:{model}"


def _gemini_default_model() -> str:
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
    return model if model.startswith("gem:") else f"gem:{model}"


def _cloud_api_model(model: str) -> str:
    if model.startswith("mesh:"):
        return model.split("/", 1)[1] if "/" in model[5:] else model[5:]
    brand = _brand_entry(model)
    if brand:
        return brand["api_model"]
    if ":" in model and model.split(":", 1)[0] in {"groq", "or", "gem"}:
        return model.split(":", 1)[1]
    return model


def _cloud_provider_for_model(model: str) -> str | None:
    if model.startswith("mesh:"):
        return model[5:].split("/", 1)[0]
    brand = _brand_entry(model)
    if brand:
        return brand["provider"]
    if model.startswith("groq:"):
        return "groq"
    if model.startswith("or:"):
        return "openrouter"
    if model.startswith("gem:"):
        return "gemini"
    if model.startswith("deepseek"):
        return "deepseek"
    for item in _STATIC_MODELS:
        if item.id == model and item.provider in CLOUD_PROVIDERS:
            return item.provider
    return None


def _is_cloud_model(model: str) -> bool:
    return _cloud_provider_for_model(model) is not None


def list_available_models() -> list[dict[str, Any]]:
    """Return the Credon model family with availability flags.

    Provider names never leave this module — the API only exposes
    the Credon-branded family.
    """
    available: list[dict[str, Any]] = []
    for m in _STATIC_MODELS:
        provider = _cloud_provider_for_model(m.id)
        api_key, _ = _provider_credentials(provider) if provider else ("", "")
        available.append({
            "id": m.id,
            "label": m.label,
            "provider": "credon",
            "description": m.description,
            "default": m.default,
            "available": bool(api_key),
        })
    return available


def default_model() -> str:
    """Best default: the Credon brand model whose provider has a key,
    in family priority order."""
    for brand_id in _BRAND_CHAIN:
        entry = BRAND_MODELS[brand_id]
        api_key, _ = _provider_credentials(entry["provider"])
        if api_key:
            return brand_id

    mode = _runtime_mode()
    if mode != "cloud":
        env = os.getenv("OLLAMA_MODEL")
        if env:
            return env
    for m in _STATIC_MODELS:
        if m.default:
            return m.id
    return next((m.id for m in _STATIC_MODELS), "credon-alpha")


# ── Generation helpers ───────────────────────────────────────────

_available_models_cache: set[str] = set()
_cache_time: float = 0


def _refresh_ollama_cache() -> set[str]:
    global _available_models_cache, _cache_time
    now = time.time()
    if now - _cache_time <= 60 and _available_models_cache:
        return _available_models_cache
    try:
        resp = requests.get(f"{_ollama_url()}/api/tags", timeout=3)
        if not resp.ok:
            _available_models_cache = set()
            return _available_models_cache
        _available_models_cache = {m["name"] for m in resp.json().get("models", [])}
        _cache_time = now
    except Exception:
        _available_models_cache = set()
    return _available_models_cache


def _ollama_retry_candidates(chosen: str) -> list[str]:
    available = _refresh_ollama_cache()
    if not available:
        return [chosen]

    preferred_order = [
        chosen,
        "qwen3:8b",
        "deepseek-r1:8b",
        "qwen3:4b",
        "deepseek-r1:1.5b",
        "llama3.2:3b",
        "gemma3:4b",
        "phi4-mini:3.8b",
    ]
    ordered: list[str] = []
    for model_id in preferred_order:
        if model_id in available and model_id not in ordered:
            ordered.append(model_id)
    for model_id in sorted(available):
        if model_id not in ordered:
            ordered.append(model_id)
    return ordered or [chosen]

def _is_ollama_available(model: str | None = None) -> bool:
    """Health check — is Ollama responding AND does the model exist?"""
    available = _refresh_ollama_cache()
    if model:
        return model in available
    return bool(available)


def _fallback_builtin_answer(messages: list[dict[str, str]]) -> str:
    """Built-in intelligence when Ollama is not available.
    Uses Credon Brain's knowledge base + web sources.
    NEVER mentions being limited, in lite mode, or having issues."""
    from .credon_brain import credon_answer

    user_msg = ""
    for m in messages:
        if m.get("role") == "user":
            user_msg = m.get("content", "")

    # Extract the actual question (before sources)
    question = user_msg.split("--- Sources ---")[0].strip()
    question = re.sub(r"^Question:\s*", "", question).strip()
    question = question.split("--- Internal Analysis ---")[0].strip()

    # 1. Try Credon Brain's built-in knowledge
    brain_answer = credon_answer(question)
    if brain_answer:
        return brain_answer

    # 2. Extract source content and synthesize
    sources_text = ""
    if "--- Sources ---" in user_msg:
        sources_text = user_msg.split("--- Sources ---")[1].strip()

    if sources_text:
        source_lines: list[str] = []
        current_source: list[str] = []
        for line in sources_text.split("\n"):
            if line.startswith("Source ") and current_source:
                source_lines.append("\n".join(current_source))
                current_source = [line]
            else:
                current_source.append(line)
        if current_source:
            source_lines.append("\n".join(current_source))

        # Build structured sources for Brain
        parsed_sources: list[dict[str, str]] = []
        for src in source_lines[:4]:
            title_match = re.search(r"Title:\s*(.+)", src)
            url_match = re.search(r"URL:\s*(.+)", src)
            content_match = re.search(r"Content:\s*(.+)", src, re.DOTALL)
            parsed_sources.append({
                "title": title_match.group(1).strip() if title_match else "Source",
                "url": url_match.group(1).strip() if url_match else "",
                "snippet": content_match.group(1).strip()[:400] if content_match else "",
            })

        brain_with_sources = credon_answer(question, sources=parsed_sources)
        if brain_with_sources:
            return brain_with_sources

    # 3. DuckDuckGo web fallback when local/cloud generation and Credon Brain do not have enough context.
    try:
        from .retrieval_v2 import retrieve_sources

        web_sources = retrieve_sources(question, max_results=4)
    except Exception:
        web_sources = []
    if web_sources:
        brain_with_web = credon_answer(question, sources=web_sources)
        if brain_with_web:
            return brain_with_web
        source_points = "\n".join(
            f"- **{src.get('title') or 'Source'}**: {(src.get('snippet') or '').strip()[:220]}"
            for src in web_sources[:3]
            if (src.get('snippet') or '').strip()
        )
        if source_points:
            source_links = "\n".join(
                f"- [{src.get('title') or 'Source'}]({src.get('url')})"
                for src in web_sources[:3]
                if src.get('url')
            )
            return (
                f"**{question}**\n\n"
                "I found relevant web context and summarized the strongest points below:\n\n"
                f"{source_points}\n\n"
                f"**Sources:**\n{source_links}"
            )

    # 4. Honest fallback — NEVER says "building understanding" / "try enabling web search" / "continuously learning"
    return (
        f"**{question}**\n\n"
        f"I wasn't able to find a strong answer for this right now. "
        f"Here's what might help:\n\n"
        f"- Rephrase your question with more specific details\n"
        f"- Break it into smaller, focused sub-questions\n"
        f"- Provide additional context about what you need\n\n"
        f"**You might also want to know:**\n"
        f"- What specific aspect are you most interested in?\n"
        f"- Can you give an example of what you're looking for?\n"
        f"- Would a related topic be helpful?"
    )


def generate_stream(
    messages: list[dict[str, str]],
    model: str | None = None,
) -> Generator[str, None, None]:
    """Stream tokens with deterministic fallback: selected → cloud → local → Brain."""
    chosen = model or default_model()
    mode = _runtime_mode()

    cloud_candidates = _cloud_retry_candidates(chosen)
    for candidate in cloud_candidates:
        had_cloud_output = False
        for token in _generate_cloud_stream(messages, candidate):
            had_cloud_output = True
            yield token
        if had_cloud_output:
            return

        cloud_text = _generate_cloud_sync(messages, candidate)
        if cloud_text:
            yield cloud_text
            return

    if mode == "cloud":
        yield _fallback_builtin_answer(messages)
        return

    local_seed = chosen if not _is_cloud_model(chosen) else (os.getenv("OLLAMA_MODEL") or "qwen3:8b")
    if not _is_ollama_available(local_seed):
        print(f"[Credon] Ollama/{local_seed} unavailable, cloud exhausted, using Brain fallback")
        yield _fallback_builtin_answer(messages)
        return

    for candidate in _ollama_retry_candidates(local_seed):
        try:
            resp = requests.post(
                f"{_ollama_url()}/api/chat",
                json={"model": candidate, "messages": messages, "stream": True},
                stream=True,
                timeout=35,
            )
            resp.raise_for_status()
            import json as _json
            emitted = False
            for line in resp.iter_lines():
                if not line:
                    continue
                try:
                    chunk = _json.loads(line)
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        emitted = True
                        yield token
                    if chunk.get("done"):
                        return
                except _json.JSONDecodeError:
                    continue
            if emitted:
                return
        except Exception as exc:
            print(f"[Credon] Model stream error ({candidate}): {exc}")

    # Fallback: still give an answer
    yield _fallback_builtin_answer(messages)


def generate_sync(
    messages: list[dict[str, str]],
    model: str | None = None,
) -> str:
    """Synchronous generation with deterministic fallback: selected → cloud → local → Brain."""
    chosen = model or default_model()
    mode = _runtime_mode()

    for candidate in _cloud_retry_candidates(chosen):
        cloud_text = _generate_cloud_sync(messages, candidate)
        if cloud_text:
            return cloud_text

    if mode == "cloud":
        return _fallback_builtin_answer(messages)

    local_seed = chosen if not _is_cloud_model(chosen) else (os.getenv("OLLAMA_MODEL") or "qwen3:8b")
    if not _is_ollama_available(local_seed):
        print(f"[Credon] Ollama/{local_seed} unavailable for sync after cloud fallback")
        return _fallback_builtin_answer(messages)

    for candidate in _ollama_retry_candidates(local_seed):
        try:
            resp = requests.post(
                f"{_ollama_url()}/api/chat",
                json={"model": candidate, "messages": messages, "stream": False},
                timeout=25,
            )
            resp.raise_for_status()
            text = (resp.json().get("message", {}).get("content") or "").strip()
            if text:
                return text
        except Exception as exc:
            print(f"[Credon] Model sync error ({candidate}): {exc}")

    for candidate in _cloud_retry_candidates(chosen):
        cloud_text = _generate_cloud_sync(messages, candidate)
        if cloud_text:
            return cloud_text

    return _fallback_builtin_answer(messages)


def _cloud_retry_candidates(chosen: str) -> list[str]:
    """Score-ordered failover across the Credon Unlimited Mesh.

    The chosen brand model goes first; remaining lanes are ordered by the
    mesh routing score (headroom, speed, capability, cooldown health).
    """
    from . import mesh

    ordered: list[str] = []

    def _add(model_id: str | None) -> None:
        mid = (model_id or "").strip()
        if not mid or mid in ordered:
            return
        provider = _cloud_provider_for_model(mid)
        if not provider or provider not in CLOUD_PROVIDERS or provider == "deepseek":
            return
        api_key, _ = _provider_credentials(provider)
        if api_key:
            ordered.append(mid)

    _add(chosen)

    # Mesh-scored lanes → synthetic brand ids resolved per lane.
    try:
        for candidate in mesh.route(task="chat", tokens_needed=1500)[:6]:
            lane = candidate["lane"]
            model = candidate["model"]
            synthetic = f"mesh:{lane}/{model}"
            if synthetic not in ordered:
                ordered.append(synthetic)
    except Exception:
        pass

    # Brand-family fallbacks (registry-driven lanes already cover these
    # providers, but keep explicit order for registry-less setups).
    for brand_id in _BRAND_CHAIN:
        _add(brand_id)
    return ordered


def cloud_retry_candidates(chosen: str) -> list[str]:
    """Public wrapper for cloud retry order."""
    return _cloud_retry_candidates(chosen)


def _generate_cloud_sync(messages: list[dict[str, str]], model: str) -> str:
    from . import mesh

    provider = _cloud_provider_for_model(model)
    if not provider:
        return ""
    api_key, base_url = _provider_credentials(provider)
    if not api_key:
        return ""

    payload_text = " ".join(m.get("content", "") for m in messages)
    tokens = mesh.estimate_tokens(payload_text)
    started = time.time()
    try:
        resp = requests.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers=_provider_headers(provider, api_key),
            json={
                "model": _cloud_api_model(model),
                "messages": messages,
                "stream": False,
            },
            timeout=35,
        )
        if resp.status_code in (429, 500, 502, 503):
            mesh.report_cooldown(provider, resp.status_code)
            return ""
        resp.raise_for_status()
        data = resp.json()
        text = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )
        if text:
            mesh.record_usage(provider, tokens)
            mesh.report_success(provider, (time.time() - started) * 1000)
        return text
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else 0
        if status in (429, 500, 502, 503):
            mesh.report_cooldown(provider, status)
        print(f"[Credon] Cloud model error ({provider}:{model}): {exc}")
        return ""
    except Exception as exc:
        print(f"[Credon] Cloud model error ({provider}:{model}): {exc}")
        return ""


def generate_cloud_sync(messages: list[dict[str, str]], model: str) -> str:
    """Public wrapper for cloud sync generation."""
    return _generate_cloud_sync(messages, model)


def _generate_cloud_stream(
    messages: list[dict[str, str]], model: str
) -> Generator[str, None, None]:
    """Stream tokens from any OpenAI-compatible cloud provider (mesh-aware)."""
    from . import mesh

    provider = _cloud_provider_for_model(model)
    if not provider:
        return
    api_key, base_url = _provider_credentials(provider)
    if not api_key:
        return
    payload_text = " ".join(m.get("content", "") for m in messages)
    tokens = mesh.estimate_tokens(payload_text)
    started = time.time()
    first_token_at = 0.0
    try:
        import json as _json
        resp = requests.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers=_provider_headers(provider, api_key),
            json={
                "model": _cloud_api_model(model),
                "messages": messages,
                "stream": True,
            },
            stream=True,
            timeout=30,
        )
        if resp.status_code in (429, 500, 502, 503):
            mesh.report_cooldown(provider, resp.status_code)
            return
        resp.raise_for_status()
        emitted = False
        for line in resp.iter_lines():
            if not line:
                continue
            decoded = line.decode("utf-8", errors="ignore")
            if not decoded.startswith("data: "):
                continue
            payload_str = decoded[6:].strip()
            if payload_str == "[DONE]":
                break
            try:
                chunk = _json.loads(payload_str)
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                token = delta.get("content", "")
                if token:
                    if not emitted:
                        first_token_at = time.time()
                        mesh.report_success(provider, (first_token_at - started) * 1000)
                        mesh.record_usage(provider, tokens)
                    emitted = True
                    yield token
            except _json.JSONDecodeError:
                continue
        if not emitted:
            mesh.report_cooldown(provider, 0)
    except Exception as exc:
        print(f"[Credon] Cloud stream error ({provider}:{model}): {exc}")


def _fallback_embedding(text: str, dim: int = 256) -> list[float]:
    vec = [0.0] * dim
    tokens = re.findall(r"\w+", text.lower())
    if not tokens:
        return vec
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        idx = int(digest[:8], 16) % dim
        sign = -1.0 if int(digest[8:10], 16) % 2 else 1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def generate_embedding(text: str, model: str | None = None) -> list[float]:
    """Create embeddings using Ollama with automatic local-model failover.
    Falls back to deterministic hashing embeddings if Ollama is unavailable."""
    chosen = model or os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
    if not text.strip():
        return _fallback_embedding(text)

    if not _is_ollama_available():
        return _fallback_embedding(text)

    base_candidates = [
        chosen,
        os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
        "nomic-embed-text",
        "mxbai-embed-large",
        "all-minilm",
    ]
    seen_candidates: set[str] = set()
    candidates: list[str] = []
    for item in base_candidates:
        cid = (item or "").strip()
        if not cid or cid in seen_candidates:
            continue
        if "cloud" in cid:
            continue
        seen_candidates.add(cid)
        candidates.append(cid)

    for candidate in candidates:
        try:
            resp = requests.post(
                f"{_ollama_url()}/api/embeddings",
                json={"model": candidate, "prompt": text},
                timeout=4,
            )
            resp.raise_for_status()
            emb_payload = cast(dict[str, Any], resp.json())
            vec_any: Any = emb_payload.get("embedding")
            if isinstance(vec_any, list):
                vec = cast(list[Any], vec_any)
                if vec:
                    return [float(x) for x in vec]
        except Exception as exc:
            print(f"[Credon] Embedding error ({candidate}): {exc}")

    return _fallback_embedding(text)
