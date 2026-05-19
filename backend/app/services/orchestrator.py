"""Credon Alpha 1 — Multi-model Orchestration Engine.

This is the core intelligence behind Credon AI's "Adaptive Routing Engine".
Instead of using a single model, Credon queries multiple AI models in parallel,
evaluates each response, and selects/merges the best answer.

Flow:
1. Send query to all available cloud models in parallel
2. Score each response for quality, relevance, and structure
3. Select the best response (or merge best parts)
4. Post-evaluate for coherence and factual consistency
5. Return the final answer

The user never sees which model was used — they just see "Credon Alpha 1".
"""

from __future__ import annotations

import concurrent.futures
import re
import time
from enum import Enum
from typing import Any, Generator

from app.services.models import (
    generate_sync as _single_model_sync,
    generate_stream as _single_model_stream,
    default_model,
    generate_cloud_sync,
    cloud_retry_candidates,
)

# ── Response scoring ─────────────────────────────────────────────


def _score_response(
    query: str,
    response: str,
    sources: list[dict[str, Any]] | None = None,
) -> float:
    """Score a model response for quality on a 0-1 scale."""
    if not response or len(response.strip()) < 20:
        return 0.0

    score = 0.0
    text = response.strip()
    words = len(text.split())

    # 1. Length score (substantial but not bloated)
    if 50 <= words <= 600:
        score += 0.25
    elif words > 600:
        score += 0.15  # might be verbose
    elif words >= 20:
        score += 0.1

    # 2. Query relevance — keyword overlap
    q_words = set(re.findall(r"\w{3,}", query.lower()))
    r_words = set(re.findall(r"\w{3,}", text.lower()))
    if q_words:
        overlap = len(q_words & r_words) / len(q_words)
        score += overlap * 0.25

    # 3. Structure bonus (markdown formatting)
    if re.search(r"^#{1,3}\s", text, re.MULTILINE):
        score += 0.08
    if re.search(r"^[-*]\s", text, re.MULTILINE):
        score += 0.04
    if "```" in text:
        score += 0.04
    if re.search(r"\$.*?\$", text):
        score += 0.04  # LaTeX math

    # 4. Penalty for AI-limitation markers
    bad_markers = [
        "i don't have access to real-time",
        "i cannot provide real-time",
        "as an ai language model",
        "i'm unable to",
        "my training data",
        "i was trained on data",
        "i cannot browse the internet",
        "my knowledge cutoff",
        "i don't have the ability",
        "as a large language model",
    ]
    for marker in bad_markers:
        if marker in text.lower():
            score -= 0.35

    # 5. Source grounding bonus
    if sources:
        source_text = " ".join(
            (s.get("snippet") or "") + " " + (s.get("title") or "")
            for s in sources
        ).lower()
        source_words = set(re.findall(r"\w{4,}", source_text))
        if source_words and r_words:
            grounding = len(r_words & source_words) / max(len(r_words), 1)
            score += grounding * 0.15

    return max(0.0, min(1.0, score))


# ── Post-evaluation ──────────────────────────────────────────────


def _post_evaluate(
    query: str,
    answer: str,
    sources: list[dict[str, Any]] | None = None,
) -> tuple[str, bool]:
    """Post-evaluate answer for coherence.  Returns (answer, is_ok)."""
    if not answer or len(answer.strip()) < 10:
        return answer, False

    # Check query-answer alignment
    q_words = set(re.findall(r"\w{3,}", query.lower()))
    a_words = set(re.findall(r"\w{3,}", answer.lower()))

    if q_words and len(q_words) >= 3 and not (q_words & a_words):
        return answer, False  # Completely unrelated

    # Too short for a complex query
    if len(answer.strip()) < 30 and len(query.split()) > 8:
        return answer, False

    return answer, True


# ── Intent routing ───────────────────────────────────────────────

class IntentType(str, Enum):
    GENERAL_CHAT = "GENERAL_CHAT"
    CODING_TASK = "CODING_TASK"
    FACTUAL_KNOWLEDGE = "FACTUAL_KNOWLEDGE"
    MATH_QUESTION = "MATH_QUESTION"


def _classify_intent(query: str) -> IntentType:
    q = query.strip().lower()
    if re.fullmatch(r"(hi|hello|hey|who are you|what are you|good morning|good evening)[!.? ]*", q):
        return IntentType.GENERAL_CHAT
    if re.search(r"\b(solve|calculate|integrate|differentiate|equation|algebra|derivative|probability|mean|median|matrix|\d+\s*[+\-*/]\s*\d+)\b", q):
        return IntentType.MATH_QUESTION
    if re.search(r"\b(code|debug|bug|fix|python|javascript|java|c\+\+|typescript|sql|function|api|compile|refactor)\b", q):
        return IntentType.CODING_TASK
    if re.search(r"\b(latest|news|trend|what is|explain|compare|research|source|evidence|history|facts?)\b", q):
        return IntentType.FACTUAL_KNOWLEDGE
    return IntentType.GENERAL_CHAT


def _general_chat_reply(query: str) -> str:
    q = query.lower()
    if "who are you" in q or "what are you" in q:
        return "Hey! I’m Credon AI, your assistant for chat, research, coding help, and problem solving. What do you want to explore today?"
    return "Hey there! 👋 I’m Credon AI. How can I help you today?"


# ── Public orchestration API ─────────────────────────────────────


def orchestrate_sync(
    messages: list[dict[str, str]],
    query: str,
    sources: list[dict[str, Any]] | None = None,
    model_hint: str | None = None,
) -> str:
    """Multi-model orchestration: query models in parallel, pick best.

    If only one model available, falls back to single-model generation.
    Always returns a non-empty answer.
    """
    intent = _classify_intent(query)
    if intent == IntentType.GENERAL_CHAT:
        return _general_chat_reply(query)

    chosen = model_hint or default_model()
    candidates = cloud_retry_candidates(chosen)

    # If no cloud candidates or just one, use standard generation
    if len(candidates) <= 1:
        return _single_model_sync(messages, model=model_hint)

    # Limit to 3 models for speed
    models_to_try = candidates[:3]
    results: dict[str, str] = {}

    t0 = time.time()
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            futures = {
                pool.submit(generate_cloud_sync, messages, m): m
                for m in models_to_try
            }
            done, _ = concurrent.futures.wait(futures.keys(), timeout=30)
            for future in done:
                model_id = futures[future]
                try:
                    text = future.result(timeout=1)
                    if text and len(text.strip()) > 20:
                        results[model_id] = text
                except Exception:
                    continue
    except Exception as exc:
        print(f"[Credon Alpha] Parallel query error: {exc}")

    elapsed = round(time.time() - t0, 2)

    if not results:
        print(f"[Credon Alpha] No parallel results in {elapsed}s, falling back to sequential")
        return _single_model_sync(messages, model=model_hint)

    # Score all results
    scored: list[tuple[float, str, str]] = []
    for model_id, text in results.items():
        score = _score_response(query, text, sources)
        scored.append((score, model_id, text))

    scored.sort(key=lambda x: x[0], reverse=True)
    best_score, best_model, best_text = scored[0]

    # Post-evaluate best answer
    best_text, is_ok = _post_evaluate(query, best_text, sources)

    if not is_ok and len(scored) > 1:
        # Try second best
        _, second_model, second_text = scored[1]
        second_text, second_ok = _post_evaluate(query, second_text, sources)
        if second_ok:
            best_text = second_text
            best_model = second_model
            best_score = scored[1][0]

    print(
        f"[Credon Alpha] Selected {best_model} "
        f"(score={best_score:.2f}) from {len(results)} models in {elapsed}s"
    )

    return best_text


def orchestrate_stream(
    messages: list[dict[str, str]],
    query: str,
    sources: list[dict[str, Any]] | None = None,
    model_hint: str | None = None,
) -> Generator[str, None, None]:
    """Stream tokens from the best available model.

    For streaming, we can't easily compare multiple models,
    so we use priority-based selection with fast failover.
    """
    # For streaming, use the standard stream with smart model selection.
    # The standard generate_stream already has excellent fallback logic.
    yield from _single_model_stream(messages, model=model_hint)
