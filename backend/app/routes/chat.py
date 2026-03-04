from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from typing import Literal, cast
import re
import json as _json
import logging
from app.models.schemas import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ChatSessionSummary,
    ChatTranscriptResponse,
    ImageResult,
    Source,
    FeedbackRequest,
)
from app.services.chat_store import get_transcript, list_sessions, save_message
from app.services.memory_answer import (
    memory_based_answer,
    personal_query_fallback,
    is_personal_query,
)
from app.services.generation_v2 import (
    generate_grounded_answer,
    generate_answer_stream,
    think_about_sources,
    think_about_sources_stream,
    generate_followup_from_context,
)
from app.services.models import list_available_models
from app.services.retrieval_v2 import retrieve_sources, search_images
from app.services.credon_brain import (
    credon_answer,
    credon_think,
    learn_from_conversation,
)
from app.services.knowledge_store import retrieve_knowledge_context
from app.services.answer_validator import (
    validate_answer,
    extract_suggestions,
    trim_answer_suggestions,
)
from app.utils.language import detect_language
from time import perf_counter

router = APIRouter()
logger = logging.getLogger(__name__)


def _public_model() -> dict[str, str | bool]:
    return {
        "id": "credon-alpha-1",
        "label": "Credon Alpha 1",
        "provider": "credon",
        "description": "Adaptive routing engine for speed + accuracy",
        "default": True,
        "available": True,
    }


def _is_greeting(query: str) -> bool:
    """Detect greetings/small-talk that should NEVER trigger web search."""
    q = query.strip().lower()
    greeting_patterns = [
        r"^hi+$", r"^hello+$", r"^hey+$", r"^hii+$", r"^hola$",
        r"^good (morning|afternoon|evening|night)",
        r"^thanks?$", r"^thank you", r"^bye$", r"^ok$", r"^okay$",
        r"^yo+$", r"^sup$", r"^what'?s? up",
    ]
    return any(re.search(p, q) for p in greeting_patterns)


def _is_simple_query(query: str) -> bool:
    q = query.strip().lower()
    if _is_greeting(q):
        return True
    memory_patterns = [
        r"who am i", r"what is my name", r"my name is",
        r"remember my", r"you know me",
    ]
    if any(re.search(p, q) for p in memory_patterns):
        return True
    if len(q.split()) <= 4:
        return True
    return False


def _is_profile_recall_query(query: str) -> bool:
    q = query.strip().lower()
    patterns = [
        r"who am i", r"what is my name", r"my name is",
        r"remember my", r"you know me", r"what did i tell you about",
    ]
    return any(re.search(p, q) for p in patterns)


def _is_arithmetic_query(query: str) -> bool:
    q = query.strip().lower()
    if re.search(r"\b(what is|calculate|compute|solve)\b", q):
        q = re.sub(r"\b(what is|calculate|compute|solve|equals|=|\?)\b", " ", q)
    return bool(re.fullmatch(r"[\d\s\+\-\*/\(\)\.]+", q.strip())) and any(
        op in q for op in "+-*/"
    )


def _query_complexity_features(query: str) -> dict[str, float]:
    words = query.split()
    word_count = len(words)
    length_score = min(word_count / 25.0, 1.0)
    entities = re.findall(r"\b([A-Z][a-z]+|\d{4}|\d+%?)\b", query)
    entity_score = min(len(entities) / 6.0, 1.0)
    intent_markers = len(re.findall(r"\b(compare|analy[sz]e|why|how|explain|trade-?off|strategy)\b", query.lower()))
    intent_score = min(intent_markers / 3.0, 1.0)
    complexity = min(1.0, (length_score * 0.45) + (entity_score * 0.25) + (intent_score * 0.30))
    return {
        "word_count": float(word_count),
        "length_score": length_score,
        "entity_score": entity_score,
        "intent_score": intent_score,
        "complexity": complexity,
    }


def _retrieval_evidence_quality(sources: list[dict[str, str]]) -> dict[str, float]:
    source_count = len(sources)
    source_score = min(source_count / 4.0, 1.0)
    snippet_lengths = [len((s.get("snippet") or s.get("content") or "").strip()) for s in sources]
    snippet_quality = min((sum(min(length, 240) for length in snippet_lengths) / (max(len(snippet_lengths), 1) * 240.0)), 1.0)
    evidence_score = (source_score * 0.6) + (snippet_quality * 0.4)
    return {
        "source_count": float(source_count),
        "source_score": source_score,
        "snippet_quality": snippet_quality,
        "evidence_score": evidence_score,
    }


def _routing_intent(query: str) -> str:
    if _is_greeting(query):
        return "greeting"
    if _is_arithmetic_query(query):
        return "arithmetic"
    if _is_profile_recall_query(query):
        return "profile_recall"
    return "general"


def _is_math_query(query: str) -> bool:
    """Detect math/calculation queries for smart model routing."""
    q = query.lower()
    math_indicators = [
        r"\d+\s*[+\-*/^]\s*\d+", r"solve", r"calculate", r"integral",
        r"derivative", r"equation", r"\bmath\b", r"factor", r"simplify",
        r"\bsum\b", r"product", r"limit", r"sqrt", r"root",
        r"trigonometr", r"logarithm", r"\blog\b", r"\bsin\b", r"\bcos\b",
        r"\bprobability\b", r"\bpercent\b", r"\bratio\b", r"\bfraction\b",
        r"area", r"volume", r"perimeter", r"circumference",
        r"algebra", r"geometry", r"calculus", r"matrix", r"vector",
    ]
    return any(re.search(p, q) for p in math_indicators)


def _web_result_budget(query: str) -> int:
    q = query.lower().strip()
    explicit = re.search(r"\btop\s+(\d{1,2})\b", q)
    if explicit:
        requested = int(explicit.group(1))
        return max(6, min(50, requested))

    words = len(q.split())
    if words >= 30:
        return 25
    if words >= 18:
        return 15
    return 10


def _should_try_brain_first(query: str) -> bool:
    return _routing_intent(query) in {"greeting", "arithmetic", "profile_recall"}


def _routing_score(
    query: str,
    sources: list[dict[str, str]],
    has_model: bool,
    use_web: bool,
) -> tuple[float, str, dict[str, object]]:
    intent = _routing_intent(query)
    complexity = _query_complexity_features(query)
    evidence = _retrieval_evidence_quality(sources)
    latency_budget_score = 1.0 if len(query.split()) <= 8 else 0.7 if len(query.split()) <= 20 else 0.4
    model_score = 1.0 if has_model else 0.35
    deterministic_boost = 1.0 if intent in {"greeting", "arithmetic", "profile_recall"} else 0.0
    score = (
        (deterministic_boost * 0.42)
        + ((1.0 - complexity["complexity"]) * 0.28)
        + (evidence["evidence_score"] * 0.16)
        + (latency_budget_score * 0.08)
        + ((1.0 - model_score) * 0.06)
    )
    if use_web and intent == "general":
        score -= 0.08
    score = max(0.0, min(score, 1.0))
    reason = "deterministic_intent_confident" if score >= 0.78 and deterministic_boost else "model_generation_required"
    diagnostics: dict[str, object] = {
        "intent": intent,
        "complexity": complexity,
        "evidence": evidence,
        "model_available": has_model,
        "latency_budget_score": latency_budget_score,
        "score": round(score, 4),
        "reason": reason,
    }
    return score, reason, diagnostics


def _log_routing(route: str, reason: str, score: float, diagnostics: dict[str, object]) -> None:
    logger.info(
        "routing_decision route=%s reason=%s score=%.4f diagnostics=%s",
        route,
        reason,
        score,
        diagnostics,
    )


def _has_available_model() -> bool:
    try:
        models = list_available_models()
        return any(bool(m.get("available")) for m in models)
    except Exception:
        return False


def _choose_internal_model(query: str, use_web: bool) -> str:
    """Smart model routing — pick the best model for the task.
    Uses progressive selection: simple→fast, math/code→reasoning, complex→powerful.
    Falls back to cloud models when no local Ollama models are available."""
    try:
        all_models = list_available_models()
        local: set[str] = {
            str(m.get("id"))
            for m in all_models
            if bool(m.get("available")) and str(m.get("provider")) == "ollama"
        }
        cloud: set[str] = {
            str(m.get("id"))
            for m in all_models
            if bool(m.get("available")) and str(m.get("provider")) == "cloud"
        }
    except Exception:
        local = set()
        cloud = set()

    def pick(candidates: list[str]) -> str:
        # Try local Ollama models first
        for candidate in candidates:
            if candidate in local:
                return candidate
        # Fallback to cloud models
        for candidate in ["deepseek-chat"]:
            if candidate in cloud:
                return candidate
        return candidates[0]

    if _is_simple_query(query):
        return pick(["qwen3:4b", "deepseek-r1:1.5b", "qwen3:8b", "deepseek-r1:8b"])
    if _is_math_query(query):
        return pick(["qwen3:8b", "deepseek-r1:8b", "deepseek-r1:1.5b", "qwen3:4b"])
    return pick(["qwen3:8b", "deepseek-r1:8b", "deepseek-r1:1.5b", "qwen3:4b"])


def _is_visual_query_local(query: str) -> bool:
    q = query.lower()
    return any(
        marker in q
        for marker in [
            "image",
            "picture",
            "photo",
            "logo",
            "diagram",
            "show me",
            "screenshot",
        ]
    )


def _clean_answer(text: str) -> str:
    out = re.sub(r"\[(\d+)\]", "", text)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def _merge_sources(primary: list[dict[str, str]], secondary: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    merged: list[dict[str, str]] = []
    for item in primary + secondary:
        url = item.get("url", "")
        key = url or item.get("title", "")
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged


def _extract_reply_context(query: str, reply_to: str | None) -> tuple[str, str, bool]:
    cleaned = query.strip()
    context = (reply_to or "").strip()
    has_attachment_marker = "[user attached" in cleaned.lower()
    cleaned = re.sub(r"\n?\[User attached[^\]]*\]", "", cleaned, flags=re.IGNORECASE).strip()
    marker = "[replying to previous answer]:"
    lower = cleaned.lower()
    idx = lower.find(marker)
    if idx >= 0:
        head = cleaned[:idx].strip()
        tail = cleaned[idx + len(marker):].strip()
        cleaned = head
        if not context and tail:
            context = tail
    return cleaned, context, has_attachment_marker


def _is_contextual_followup(query: str) -> bool:
    q = query.lower().strip()
    patterns = [
        r"^can you explain this",
        r"^explain this",
        r"^simplify",
        r"^make it simple",
        r"^in simpler terms",
        r"^summarize this",
        r"^tl;dr",
    ]
    return any(re.search(p, q) for p in patterns)


def _is_ambiguous_short_followup(query: str) -> bool:
    q = query.lower().strip()
    if len(q.split()) > 3:
        return False
    return q in {"explain", "simplify", "why", "how", "details", "more", "elaborate"}


def _is_numbered_followup(query: str) -> tuple[bool, int]:
    """Detect numbered follow-up selection like '1', '2', 'first', 'second', 'yes'."""
    q = query.strip().lower()
    # Direct number
    if q in {"1", "2", "3"}:
        return True, int(q)
    # Words
    word_map = {"first": 1, "second": 2, "third": 3, "one": 1, "two": 2, "three": 3}
    if q in word_map:
        return True, word_map[q]
    # "yes" means first suggestion
    if q in {"yes", "yeah", "yep", "sure", "ok", "okay", "go ahead"}:
        return True, 1
    # "option 1", "number 2", etc.
    m = re.match(r"(?:option|number|#)\s*(\d)", q)
    if m:
        return True, int(m.group(1))
    return False, 0


def _resolve_numbered_followup(
    number: int, transcript: list[dict[str, str]]
) -> str | None:
    """Extract the Nth suggestion from the last assistant message."""
    for item in reversed(transcript):
        if item.get("role") == "assistant":
            text = item.get("text", "")
            suggestions = extract_suggestions(text)
            if 1 <= number <= len(suggestions):
                return suggestions[number - 1]
            break
    return None


def _smart_source_ratio(query: str, use_web: bool) -> dict[str, float]:
    """Determine the ideal mixing ratio for different sources.

    Returns weights (sum = 1.0) for: web_search, model, brain.
    Default for complex queries: 60% web, 25% model, 15% brain.
    """
    q = query.lower().strip()
    words = len(q.split())

    if _is_greeting(q):
        return {"web_search": 0.0, "model": 0.0, "brain": 1.0}
    if _is_math_query(q):
        return {"web_search": 0.0, "model": 0.85, "brain": 0.15}
    if not use_web:
        return {"web_search": 0.0, "model": 0.70, "brain": 0.30}
    # Simple factual question
    if words <= 6:
        return {"web_search": 0.50, "model": 0.30, "brain": 0.20}
    # Medium complexity
    if words <= 15:
        return {"web_search": 0.60, "model": 0.25, "brain": 0.15}
    # Complex / research queries
    return {"web_search": 0.65, "model": 0.25, "brain": 0.10}


def _apply_cross_check(
    query: str,
    answer: str,
    sources: list[dict[str, str]],
    thinking: str,
    model_used: str,
    confidence: str,
) -> tuple[str, str]:
    """Cross-check the answer and adjust confidence.
    Returns (adjusted_answer, adjusted_confidence)."""
    report = validate_answer(query, answer, sources, thinking, model_used)
    # If cross-check says low but we had many sources, trust the sources
    if report["confidence"] == "low" and len(sources) >= 3:
        return answer, "medium"
    if not report["valid"]:
        return answer, "low"
    return answer, report["confidence"] if report["confidence"] != confidence else confidence


def _latest_assistant_context(transcript: list[dict[str, str]]) -> str:
    for item in reversed(transcript):
        if item.get("role") == "assistant":
            text = item.get("text", "").strip()
            if text:
                return text
    return ""


# ── Models endpoint ──────────────────────────────────────────────

@router.get("/models")
def get_models() -> dict[str, object]:
    """Return all available models including Ollama local + cloud."""
    all_models = list_available_models()
    public = [_public_model()]
    for m in all_models:
        if m.get("available"):
            public.append({
                "id": m["id"],
                "label": m.get("label", m["id"]),
                "provider": m.get("provider", "ollama"),
                "description": m.get("description", ""),
                "default": False,
                "available": True,
            })
    return {
        "models": public,
        "default": "credon-alpha-1",
    }


# ── Non-streaming chat ──────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest) -> ChatResponse:
    start = perf_counter()
    cleaned_query, reply_context, has_attachment_marker = _extract_reply_context(payload.query, payload.reply_to)
    target_language = cast(
        Literal["en", "hinglish"],
        payload.language if payload.language != "auto" else detect_language(cleaned_query),
    )

    save_message(payload.user_id, payload.session_id, "user", cleaned_query)
    transcript = get_transcript(payload.user_id, payload.session_id)

    followup_mode = _is_contextual_followup(cleaned_query) or _is_ambiguous_short_followup(cleaned_query)
    if followup_mode and not reply_context:
        reply_context = _latest_assistant_context(transcript)

    # Numbered follow-up detection: "1", "2", "yes" → resolve to suggestion
    is_numbered, follow_number = _is_numbered_followup(cleaned_query)
    if is_numbered:
        resolved = _resolve_numbered_followup(follow_number, transcript)
        if resolved:
            cleaned_query = resolved
            followup_mode = False  # Treat as a fresh query

    if has_attachment_marker and not reply_context and not followup_mode:
        attachment_message = (
            "I can help with your image, but I currently received only an attachment marker, not the actual image bytes. "
            "Please add a short description of what is in the image (or send an image URL), and I will explain it clearly."
            if target_language == "en"
            else "Main image help kar sakta hoon, lekin abhi mujhe sirf attachment marker mila hai, actual image bytes nahi. "
            "Image ka short description do (ya image URL bhejo), phir main clearly explain karunga."
        )
        save_message(payload.user_id, payload.session_id, "assistant", attachment_message)
        elapsed = int((perf_counter() - start) * 1000)
        return ChatResponse(
            answer=attachment_message,
            language=target_language,
            confidence="high",
            sources=[],
            images=[],
            latency_ms=elapsed,
            metadata={"routing": {"selected_route": "attachment_guard", "reason": "missing_attachment_bytes", "score": 1.0}},
        )

    if followup_mode and reply_context:
        chosen_model = payload.model or _choose_internal_model(cleaned_query, False)
        followup_answer = generate_followup_from_context(
            cleaned_query,
            reply_context,
            target_language,
            model=chosen_model,
        )
        answer = _clean_answer(followup_answer)
        save_message(payload.user_id, payload.session_id, "assistant", answer)
        elapsed = int((perf_counter() - start) * 1000)
        return ChatResponse(
            answer=answer,
            language=target_language,
            confidence="high",
            sources=[],
            images=[],
            latency_ms=elapsed,
            metadata={"routing": {"selected_route": "followup_generation", "reason": "contextual_followup", "score": 1.0}},
        )

    memory_answer = memory_based_answer(cleaned_query, transcript, target_language)
    if memory_answer:
        save_message(payload.user_id, payload.session_id, "assistant", memory_answer)
        elapsed = int((perf_counter() - start) * 1000)
        return ChatResponse(
            answer=memory_answer,
            language=target_language,
            confidence="high",
            sources=[],
            latency_ms=elapsed,
            metadata={"routing": {"selected_route": "memory_shortcut", "reason": "memory_match", "score": 1.0}},
        )

    # Personal profile questions should not trigger web search.
    personal_fallback = personal_query_fallback(cleaned_query, transcript, target_language)
    if personal_fallback:
        save_message(payload.user_id, payload.session_id, "assistant", personal_fallback)
        elapsed = int((perf_counter() - start) * 1000)
        return ChatResponse(
            answer=personal_fallback,
            language=target_language,
            confidence="high",
            sources=[],
            images=[],
            latency_ms=elapsed,
            metadata={"routing": {"selected_route": "personal_fallback", "reason": "profile_query", "score": 1.0}},
        )

    has_model = _has_available_model()

    quick_knowledge = retrieve_knowledge_context(payload.user_id, cleaned_query, top_k=3)
    quick_score, quick_reason, quick_diagnostics = _routing_score(
        cleaned_query,
        quick_knowledge,
        has_model=has_model,
        use_web=payload.use_web,
    )
    quick_route = _should_try_brain_first(cleaned_query) and quick_score >= 0.78

    if quick_route:
        _log_routing("credon_answer", quick_reason, quick_score, quick_diagnostics)
        brain_answer = credon_answer(cleaned_query, sources=quick_knowledge or None, target_language=target_language)
        if brain_answer:
            answer = _clean_answer(brain_answer)
            save_message(payload.user_id, payload.session_id, "assistant", answer)
            learn_from_conversation(cleaned_query, answer, "high")
            elapsed = int((perf_counter() - start) * 1000)
            return ChatResponse(
                answer=answer,
                language=target_language,
                confidence="high",
                sources=[Source(title=item["title"], url=item["url"]) for item in quick_knowledge],
                images=[],
                latency_ms=elapsed,
                metadata={"routing": {"selected_route": "credon_answer", **quick_diagnostics}},
            )

    _log_routing("model_generation", quick_reason, quick_score, quick_diagnostics)

    use_web = payload.use_web and not is_personal_query(cleaned_query) and not followup_mode
    chosen_model = payload.model or _choose_internal_model(cleaned_query, use_web)

    knowledge_results = retrieve_knowledge_context(payload.user_id, cleaned_query, top_k=4)
    web_results = retrieve_sources(cleaned_query, max_results=_web_result_budget(cleaned_query)) if use_web else []
    results = _merge_sources(knowledge_results, web_results)

    if len(results) >= 4:
        confidence = "high"
    elif len(results) >= 2:
        confidence = "medium"
    else:
        confidence = "low"

    if not has_model:
        brain_answer = credon_answer(cleaned_query, sources=results or None, target_language=target_language)
        if brain_answer:
            answer = _clean_answer(brain_answer)
            save_message(payload.user_id, payload.session_id, "assistant", answer)
            learn_from_conversation(cleaned_query, answer, confidence)
            elapsed = int((perf_counter() - start) * 1000)
            return ChatResponse(
                answer=answer,
                language=target_language,
                confidence=confidence,
                sources=[Source(title=item["title"], url=item["url"]) for item in results],
                images=[],
                latency_ms=elapsed,
                metadata={
                    "routing": {
                        "selected_route": "credon_answer_fallback",
                        "score": round(quick_score, 4),
                        "reason": "model_unavailable",
                    }
                },
            )

    # Thinking step
    thinking = think_about_sources(cleaned_query, results, model=chosen_model)

    answer = generate_grounded_answer(
        cleaned_query, results, target_language,
        model=chosen_model, thinking=thinking,
    )
    answer = _clean_answer(answer)

    # Extract suggestions + trim from body
    suggestions = extract_suggestions(answer)
    answer = trim_answer_suggestions(answer)

    # Cross-check answer quality
    answer, confidence = _apply_cross_check(
        cleaned_query, answer, results, thinking, chosen_model, confidence
    )

    save_message(payload.user_id, payload.session_id, "assistant", answer)
    # Self-learning: save this Q&A so Credon gets smarter
    learn_from_conversation(cleaned_query, answer, confidence)

    # Image search for visual queries
    images: list[ImageResult] = []
    if use_web and _is_visual_query_local(cleaned_query):
        raw_images = search_images(cleaned_query, max_results=4)
        images = [ImageResult(**img) for img in raw_images]

    elapsed = int((perf_counter() - start) * 1000)

    return ChatResponse(
        answer=answer,
        language=target_language,
        confidence=confidence,  # type: ignore[arg-type]
        sources=[Source(title=item["title"], url=item["url"]) for item in results],
        images=images,
        suggestions=suggestions,
        thinking=thinking,
        latency_ms=elapsed,
        metadata={
            "routing": {
                "selected_route": "model_generation",
                "score": round(quick_score, 4),
                "reason": quick_reason,
            }
        },
    )


# ── Streaming SSE endpoint ───────────────────────────────────────

@router.post("/chat/stream")
def chat_stream(payload: ChatRequest):
    """SSE endpoint with thinking → searching → answering stages."""
    start = perf_counter()
    cleaned_query, reply_context, has_attachment_marker = _extract_reply_context(payload.query, payload.reply_to)
    target_language = cast(
        Literal["en", "hinglish"],
        payload.language if payload.language != "auto" else detect_language(cleaned_query),
    )

    save_message(payload.user_id, payload.session_id, "user", cleaned_query)
    transcript = get_transcript(payload.user_id, payload.session_id)

    followup_mode = _is_contextual_followup(cleaned_query) or _is_ambiguous_short_followup(cleaned_query)
    if followup_mode and not reply_context:
        reply_context = _latest_assistant_context(transcript)

    # Numbered follow-up detection: "1", "2", "yes" → resolve to suggestion
    is_numbered, follow_number = _is_numbered_followup(cleaned_query)
    if is_numbered:
        resolved = _resolve_numbered_followup(follow_number, transcript)
        if resolved:
            cleaned_query = resolved
            followup_mode = False

    if has_attachment_marker and not reply_context and not followup_mode:
        attachment_message = (
            "I can help with your image, but I currently received only an attachment marker, not the actual image bytes. "
            "Please add a short description of what is in the image (or send an image URL), and I will explain it clearly."
            if target_language == "en"
            else "Main image help kar sakta hoon, lekin abhi mujhe sirf attachment marker mila hai, actual image bytes nahi. "
            "Image ka short description do (ya image URL bhejo), phir main clearly explain karunga."
        )
        save_message(payload.user_id, payload.session_id, "assistant", attachment_message)
        elapsed = int((perf_counter() - start) * 1000)

        def _attachment_events():
            yield f"data: {_json.dumps({'type': 'token', 'content': attachment_message})}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'confidence': 'high', 'sources': [], 'images': [], 'latency_ms': elapsed, 'metadata': {'routing': {'selected_route': 'attachment_guard_stream', 'reason': 'missing_attachment_bytes', 'score': 1.0}}})}\n\n"

        return StreamingResponse(_attachment_events(), media_type="text/event-stream")

    if followup_mode and reply_context:
        chosen_model = payload.model or _choose_internal_model(cleaned_query, False)
        answer_text = _clean_answer(
            generate_followup_from_context(
                cleaned_query,
                reply_context,
                target_language,
                model=chosen_model,
            )
        )
        save_message(payload.user_id, payload.session_id, "assistant", answer_text)
        elapsed = int((perf_counter() - start) * 1000)

        def _followup_events():
            yield f"data: {_json.dumps({'type': 'token', 'content': answer_text})}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'confidence': 'high', 'sources': [], 'images': [], 'latency_ms': elapsed, 'metadata': {'routing': {'selected_route': 'followup_generation_stream', 'reason': 'contextual_followup', 'score': 1.0}}})}\n\n"

        return StreamingResponse(_followup_events(), media_type="text/event-stream")

    # Fast path: memory-based answer
    memory_answer = memory_based_answer(cleaned_query, transcript, target_language)
    if memory_answer:
        save_message(payload.user_id, payload.session_id, "assistant", memory_answer)
        elapsed = int((perf_counter() - start) * 1000)

        def _mem_events():
            yield f"data: {_json.dumps({'type': 'token', 'content': memory_answer})}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'confidence': 'high', 'sources': [], 'images': [], 'latency_ms': elapsed, 'metadata': {'routing': {'selected_route': 'memory_shortcut_stream', 'reason': 'memory_match', 'score': 1.0}}})}\n\n"

        return StreamingResponse(_mem_events(), media_type="text/event-stream")

    personal_fallback = personal_query_fallback(cleaned_query, transcript, target_language)
    if personal_fallback:
        save_message(payload.user_id, payload.session_id, "assistant", personal_fallback)
        elapsed = int((perf_counter() - start) * 1000)

        def _personal_events():
            yield f"data: {_json.dumps({'type': 'token', 'content': personal_fallback})}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'confidence': 'high', 'sources': [], 'images': [], 'latency_ms': elapsed, 'metadata': {'routing': {'selected_route': 'personal_fallback_stream', 'reason': 'profile_query', 'score': 1.0}}})}\n\n"

        return StreamingResponse(_personal_events(), media_type="text/event-stream")

    has_model = _has_available_model()

    quick_knowledge = retrieve_knowledge_context(payload.user_id, cleaned_query, top_k=3)
    quick_score, quick_reason, quick_diagnostics = _routing_score(
        cleaned_query,
        quick_knowledge,
        has_model=has_model,
        use_web=payload.use_web,
    )
    quick_route = _should_try_brain_first(cleaned_query) and quick_score >= 0.78
    if quick_route:
        _log_routing("credon_answer_stream", quick_reason, quick_score, quick_diagnostics)
        brain_answer = credon_answer(cleaned_query, sources=quick_knowledge or None, target_language=target_language)
        if brain_answer:
            thinking = credon_think(cleaned_query, sources=quick_knowledge or None)
            answer_text = _clean_answer(brain_answer)
            save_message(payload.user_id, payload.session_id, "assistant", answer_text)
            learn_from_conversation(cleaned_query, answer_text, "high")
            elapsed = int((perf_counter() - start) * 1000)
            source_payload = [{"title": s["title"], "url": s["url"]} for s in quick_knowledge]

            def _brain_events():
                yield f"data: {_json.dumps({'type': 'status', 'stage': 'thinking', 'message': 'Evaluating intent and context...'})}\n\n"
                if thinking:
                    yield f"data: {_json.dumps({'type': 'thinking', 'content': thinking})}\n\n"
                if source_payload:
                    yield f"data: {_json.dumps({'type': 'sources', 'sources': source_payload, 'confidence': 'high', 'images': []})}\n\n"
                yield f"data: {_json.dumps({'type': 'token', 'content': answer_text})}\n\n"
                yield f"data: {_json.dumps({'type': 'done', 'confidence': 'high', 'sources': source_payload, 'images': [], 'latency_ms': elapsed, 'metadata': {'routing': {'selected_route': 'credon_answer_stream', **quick_diagnostics}}})}\n\n"

            return StreamingResponse(_brain_events(), media_type="text/event-stream")
    _log_routing("model_generation_stream", quick_reason, quick_score, quick_diagnostics)

    use_web = payload.use_web and not is_personal_query(cleaned_query) and not followup_mode
    chosen_model = payload.model or _choose_internal_model(cleaned_query, use_web)

    # Full pipeline with thinking stages
    def _stream_events():
        results = []
        knowledge_results = retrieve_knowledge_context(payload.user_id, cleaned_query, top_k=4)
        if use_web:
            yield f"data: {_json.dumps({'type': 'status', 'stage': 'searching', 'message': 'Searching knowledge sources...'})}\n\n"
            web_results = retrieve_sources(cleaned_query, max_results=_web_result_budget(cleaned_query))
            results = _merge_sources(knowledge_results, web_results)
        else:
            results = knowledge_results

        sources_payload = [{"title": s["title"], "url": s["url"]} for s in results]

        if len(results) >= 4:
            confidence = "high"
        elif len(results) >= 2:
            confidence = "medium"
        else:
            confidence = "low"

        if not has_model:
            brain_answer = credon_answer(cleaned_query, sources=results or None, target_language=target_language)
            if brain_answer:
                answer_text = _clean_answer(brain_answer)
                thinking = credon_think(cleaned_query, sources=results or None)
                suggestions = extract_suggestions(answer_text)
                answer_text = trim_answer_suggestions(answer_text)
                save_message(payload.user_id, payload.session_id, "assistant", answer_text)
                learn_from_conversation(cleaned_query, answer_text, confidence)
                elapsed = int((perf_counter() - start) * 1000)
                if thinking:
                    yield f"data: {_json.dumps({'type': 'thinking', 'content': thinking})}\n\n"
                yield f"data: {_json.dumps({'type': 'sources', 'sources': sources_payload, 'confidence': confidence, 'images': []})}\n\n"
                yield f"data: {_json.dumps({'type': 'token', 'content': answer_text})}\n\n"
                yield f"data: {_json.dumps({'type': 'done', 'latency_ms': elapsed, 'suggestions': suggestions, 'metadata': {'routing': {'selected_route': 'credon_answer_fallback_stream', 'score': round(quick_score, 4), 'reason': 'model_unavailable'}}})}\n\n"
                return

        # Stage 2: Thinking / Evaluating — stream word by word
        yield f"data: {_json.dumps({'type': 'status', 'stage': 'thinking', 'message': 'Thinking deeply about this...'})}\n\n"

        thinking_tokens: list[str] = []
        for token in think_about_sources_stream(cleaned_query, results, model=chosen_model):
            thinking_tokens.append(token)
            yield f"data: {_json.dumps({'type': 'thinking_token', 'content': token})}\n\n"

        thinking = "".join(thinking_tokens)
        if thinking:
            yield f"data: {_json.dumps({'type': 'thinking_done', 'content': thinking})}\n\n"

        # Image search for visual queries
        images_payload: list[dict[str, str]] = []
        if use_web and _is_visual_query_local(cleaned_query):
            raw_images = search_images(cleaned_query, max_results=4)
            images_payload = raw_images

        # Send sources + images early
        yield f"data: {_json.dumps({'type': 'sources', 'sources': sources_payload, 'confidence': confidence, 'images': images_payload})}\n\n"

        # Stage 3: Generating
        yield f"data: {_json.dumps({'type': 'status', 'stage': 'generating', 'message': 'Composing response...'})}\n\n"

        full_answer: list[str] = []
        for token in generate_answer_stream(
            cleaned_query, results, target_language,
            model=chosen_model, thinking=thinking,
        ):
            full_answer.append(token)
            yield f"data: {_json.dumps({'type': 'token', 'content': token})}\n\n"

        answer_text = _clean_answer("".join(full_answer))

        # Extract suggestions before trimming
        suggestions = extract_suggestions(answer_text)
        answer_text = trim_answer_suggestions(answer_text)

        # Cross-check answer quality
        _, adj_confidence = _apply_cross_check(
            cleaned_query, answer_text, results, thinking, chosen_model, confidence
        )

        save_message(payload.user_id, payload.session_id, "assistant", answer_text)
        learn_from_conversation(cleaned_query, answer_text, adj_confidence)
        elapsed = int((perf_counter() - start) * 1000)
        yield f"data: {_json.dumps({'type': 'done', 'latency_ms': elapsed, 'confidence': adj_confidence, 'suggestions': suggestions, 'metadata': {'routing': {'selected_route': 'model_generation_stream', 'score': round(quick_score, 4), 'reason': quick_reason}}})}\n\n"

    return StreamingResponse(_stream_events(), media_type="text/event-stream")


# ── Session history ──────────────────────────────────────────────

@router.get("/chats/{user_id}", response_model=list[ChatSessionSummary])
def get_user_sessions(user_id: str) -> list[ChatSessionSummary]:
    sessions = list_sessions(user_id)
    return [
        ChatSessionSummary(
            session_id=str(item["session_id"]),
            last_updated=str(item["last_updated"]),
            message_count=int(item["message_count"]),
            preview=str(item.get("preview", "")),
        )
        for item in sessions
    ]


@router.get("/chats/{user_id}/{session_id}", response_model=ChatTranscriptResponse)
def get_user_transcript(user_id: str, session_id: str) -> ChatTranscriptResponse:
    transcript = get_transcript(user_id, session_id)
    messages = [
        ChatMessage(
            role=cast(Literal["user", "assistant"], item.get("role", "assistant")),
            text=item.get("text", ""),
            created_at=item.get("created_at", ""),
        )
        for item in transcript
    ]
    return ChatTranscriptResponse(user_id=user_id, session_id=session_id, messages=messages)


@router.post("/feedback")
def submit_feedback(payload: FeedbackRequest):
    print(
        "[Credon Feedback]",
        {
            "user_id": payload.user_id,
            "session_id": payload.session_id,
            "vote": payload.vote,
            "preview": payload.message_text[:120],
        },
    )
    return {"ok": True}
