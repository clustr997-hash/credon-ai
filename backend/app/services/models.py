"""Multi-model orchestration layer with production-safe failover.

Supports local Ollama + cloud providers (DeepSeek, Groq) with
deterministic fallback order so behavior remains stable after deployment.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Generator, cast
import math
import hashlib

import requests

# ── Available model registry ─────────────────────────────────────

@dataclass
class ModelInfo:
    id: str
    label: str
    provider: str          # "ollama" | "deepseek" | "groq"
    description: str
    default: bool = False


# Populated at startup; enriched by /models endpoint
_STATIC_MODELS: list[ModelInfo] = [
    ModelInfo("qwen3:8b", "Qwen 3 8B", "ollama", "Fast, balanced reasoning", default=True),
    ModelInfo("qwen3:4b", "Qwen 3 4B", "ollama", "Lightweight and quick"),
    ModelInfo("deepseek-r1:1.5b", "DeepSeek R1 1.5B", "ollama", "Compact local reasoning model"),
    ModelInfo("deepseek-r1:8b", "DeepSeek R1 8B", "ollama", "Deep reasoning model"),
    ModelInfo("deepseek-reasoner", "DeepSeek R1 (Cloud)", "deepseek", "DeepSeek cloud reasoning model"),
    ModelInfo("deepseek-chat", "DeepSeek Chat (Cloud)", "deepseek", "DeepSeek cloud chat model"),
    ModelInfo("groq:llama-3.3-70b-versatile", "Groq Llama 3.3 70B", "groq", "Groq cloud fallback model"),
    ModelInfo("groq:deepseek-r1-distill-llama-70b", "Groq DeepSeek R1 Distill 70B", "groq", "Groq reasoning fallback model"),
    ModelInfo("llama3.2:3b", "Llama 3.2 3B", "ollama", "Meta's compact model"),
    ModelInfo("gemma3:4b", "Gemma 3 4B", "ollama", "Google's efficient model"),
    ModelInfo("phi4-mini:3.8b", "Phi-4 Mini", "ollama", "Microsoft reasoning model"),
]


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


def _runtime_mode() -> str:
    """Runtime mode: auto | cloud | local."""
    mode = os.getenv("MODEL_RUNTIME_MODE", "auto").strip().lower()
    return mode if mode in {"auto", "cloud", "local"} else "auto"


def _deepseek_default_model() -> str:
    return os.getenv("DEEPSEEK_MODEL", "deepseek-reasoner").strip() or "deepseek-reasoner"


def _groq_default_model() -> str:
    model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip() or "llama-3.3-70b-versatile"
    return model if model.startswith("groq:") else f"groq:{model}"


def _cloud_api_model(model: str) -> str:
    if model.startswith("groq:"):
        return model.split(":", 1)[1]
    return model


def _cloud_provider_for_model(model: str) -> str | None:
    if model.startswith("groq:"):
        return "groq"
    if model.startswith("deepseek"):
        return "deepseek"
    for item in _STATIC_MODELS:
        if item.id == model and item.provider in {"deepseek", "groq"}:
            return item.provider
    return None


def _is_cloud_model(model: str) -> bool:
    return _cloud_provider_for_model(model) is not None


def list_available_models() -> list[dict[str, Any]]:
    """Return models actually available on the local Ollama instance,
    intersected with our known registry (+ any extras detected)."""
    static_ids = {m.id for m in _STATIC_MODELS}
    available: list[dict[str, Any]] = []

    # Ask Ollama for running models
    try:
        resp = requests.get(f"{_ollama_url()}/api/tags", timeout=5)
        resp.raise_for_status()
        payload = cast(dict[str, Any], resp.json())
        remote_list = cast(list[Any], payload.get("models", []))
        remote_models: set[str] = set()
        for item in remote_list:
            if not isinstance(item, dict):
                continue
            entry = cast(dict[str, Any], item)
            model_name = entry.get("name")
            if isinstance(model_name, str) and model_name:
                remote_models.add(model_name)
    except Exception:
        remote_models = set()

    for m in _STATIC_MODELS:
        if m.provider in {"deepseek", "groq"}:
            provider_available = bool(_deepseek_api_key()) if m.provider == "deepseek" else bool(_groq_api_key())
            available.append({
                "id": m.id,
                "label": m.label,
                "provider": "cloud",
                "description": m.description,
                "default": m.default,
                "available": provider_available,
            })
            continue
        available.append({
            "id": m.id,
            "label": m.label,
            "provider": m.provider,
            "description": m.description,
            "default": m.default,
            "available": m.id in remote_models,
        })

    # Add any Ollama-local models not in our registry
    for name in sorted(remote_models - static_ids):
        available.append({
            "id": name,
            "label": name,
            "provider": "ollama",
            "description": "Detected on local Ollama",
            "default": False,
            "available": True,
        })

    return available


def default_model() -> str:
    mode = _runtime_mode()
    env = os.getenv("OLLAMA_MODEL")
    if mode != "cloud" and env:
        return env

    if mode in {"auto", "cloud"}:
        if _deepseek_api_key():
            return _deepseek_default_model()
        if _groq_api_key():
            return _groq_default_model()

    if mode == "cloud":
        return _deepseek_default_model()

    for m in _STATIC_MODELS:
        if m.default and m.provider == "ollama":
            return m.id
    return _STATIC_MODELS[0].id if _STATIC_MODELS else "qwen3:8b"


# ── Generation helpers ───────────────────────────────────────────

_available_models_cache: set[str] = set()
_cache_time: float = 0


def _refresh_ollama_cache() -> set[str]:
    import time
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
    ordered: list[str] = []

    def _add(model_id: str | None) -> None:
        mid = (model_id or "").strip()
        if not mid or mid in ordered:
            return
        provider = _cloud_provider_for_model(mid)
        if provider == "deepseek" and _deepseek_api_key():
            ordered.append(mid)
        elif provider == "groq" and _groq_api_key():
            ordered.append(mid)

    _add(chosen)
    _add(_deepseek_default_model())
    _add("deepseek-chat")
    _add(_groq_default_model())
    _add("groq:deepseek-r1-distill-llama-70b")
    return ordered


def cloud_retry_candidates(chosen: str) -> list[str]:
    """Public wrapper for cloud retry order."""
    return _cloud_retry_candidates(chosen)


def _generate_cloud_sync(messages: list[dict[str, str]], model: str) -> str:
    provider = _cloud_provider_for_model(model)
    if not provider:
        return ""
    api_key = _deepseek_api_key() if provider == "deepseek" else _groq_api_key()
    base_url = _deepseek_url() if provider == "deepseek" else _groq_url()
    if not api_key:
        return ""

    try:
        resp = requests.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": _cloud_api_model(model),
                "messages": messages,
                "stream": False,
            },
            timeout=35,
        )
        resp.raise_for_status()
        data = resp.json()
        return (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )
    except Exception as exc:
        print(f"[Credon] Cloud model error ({provider}:{model}): {exc}")
        return ""


def generate_cloud_sync(messages: list[dict[str, str]], model: str) -> str:
    """Public wrapper for cloud sync generation."""
    return _generate_cloud_sync(messages, model)


def _generate_cloud_stream(
    messages: list[dict[str, str]], model: str
) -> Generator[str, None, None]:
    """Stream tokens from cloud API (DeepSeek/Groq)."""
    provider = _cloud_provider_for_model(model)
    if not provider:
        return
    api_key = _deepseek_api_key() if provider == "deepseek" else _groq_api_key()
    base_url = _deepseek_url() if provider == "deepseek" else _groq_url()
    if not api_key:
        return
    try:
        import json as _json
        resp = requests.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": _cloud_api_model(model),
                "messages": messages,
                "stream": True,
            },
            stream=True,
            timeout=30,
        )
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            decoded = line.decode("utf-8", errors="ignore")
            if not decoded.startswith("data: "):
                continue
            payload_str = decoded[6:].strip()
            if payload_str == "[DONE]":
                return
            try:
                chunk = _json.loads(payload_str)
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                token = delta.get("content", "")
                if token:
                    yield token
            except _json.JSONDecodeError:
                continue
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
