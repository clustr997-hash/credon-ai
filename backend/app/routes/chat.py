from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from typing import Any, Iterator, Literal, cast
import re
import json as _json
import logging
from collections import OrderedDict
from threading import Lock
from app.models.schemas import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ChatSessionSummary,
    ChatTranscriptResponse,
    ImageResult,
    Source,
    FeedbackRequest,
    NotificationTokenRequest,
    NotificationTestRequest,
)
from app.services.chat_store import delete_session, get_transcript, list_sessions, rename_session, save_message
from app.services.memory_answer import (
    memory_based_answer,
    personal_query_fallback,
    profile_update_acknowledgement,
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
    register_feedback,
)
from app.services.knowledge_store import retrieve_knowledge_context
from app.services.answer_validator import (
    validate_answer,
    extract_suggestions,
    trim_answer_suggestions,
)
from app.services.push_store import save_user_push_token
from app.services.push_notify import send_test_push
from app.services.free_agents import manager_plan, news_answer, weather_answer
from app.utils.language import detect_language
from time import perf_counter, time

router = APIRouter()
logger = logging.getLogger(__name__)

_FAST_CACHE_TTL_SEC = 180.0
_FAST_CACHE_MAX = 200
_FAST_RESPONSE_CACHE: "OrderedDict[str, tuple[float, dict[str, Any]]]" = OrderedDict()
_FAST_CACHE_LOCK = Lock()


def _normalize_query_key(query: str) -> str:
    return re.sub(r"\s+", " ", query.strip().lower())[:500]


def _response_cache_key(
    *,
    user_id: str,
    query: str,
    language: Literal["en", "hinglish"],
    use_web: bool,
    deep_think: bool,
    code_mode: bool,
    detail_pref: str,
    news_top_n: int,
) -> str:
    return "|".join(
        [
            user_id,
            language,
            _normalize_query_key(query),
            "web1" if use_web else "web0",
            "deep1" if deep_think else "deep0",
            "code1" if code_mode else "code0",
            f"detail:{detail_pref}",
            f"news:{news_top_n}",
        ]
    )


def _response_cache_get(key: str) -> dict[str, Any] | None:
    now = time()
    with _FAST_CACHE_LOCK:
        value = _FAST_RESPONSE_CACHE.get(key)
        if not value:
            return None
        ts, payload = value
        if (now - ts) > _FAST_CACHE_TTL_SEC:
            _FAST_RESPONSE_CACHE.pop(key, None)
            return None
        _FAST_RESPONSE_CACHE.move_to_end(key)
        return dict(payload)


def _response_cache_set(key: str, payload: dict[str, Any]) -> None:
    with _FAST_CACHE_LOCK:
        _FAST_RESPONSE_CACHE[key] = (time(), dict(payload))
        _FAST_RESPONSE_CACHE.move_to_end(key)
        while len(_FAST_RESPONSE_CACHE) > _FAST_CACHE_MAX:
            _FAST_RESPONSE_CACHE.popitem(last=False)


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
    if any(k in q for k in ["about you", "who are you", "what can you do", "tell me about you", "founder"]):
        return False
    greeting_patterns = [
        r"^hi+$", r"^hello+$", r"^hey+$", r"^hii+$", r"^hola$",
        r"^good (morning|afternoon|evening|night)",
        r"^thanks?$", r"^thank you", r"^bye$", r"^ok$", r"^okay$",
        r"^yo+$", r"^sup$", r"^what'?s? up",
    ]
    return any(re.search(p, q) for p in greeting_patterns)


def _is_intro_query(query: str) -> bool:
    q = query.strip().lower()
    patterns = [
        r"^what can you do\??$",
        r"^who are you\??$",
        r"^what is this\??$",
        r"^what are you\??$",
        r"^tell me about you\??$",
        r"^about you\??$",
        r"^i am talking about you\??$",
        r"^what is credon\??$",
        r"^introduce yourself\??$",
        r"^what can credon do\??$",
    ]
    return any(re.search(p, q) for p in patterns)

def _is_founder_query(query: str) -> bool:
    q = query.strip().lower()
    return any(
        phrase in q
        for phrase in [
            "who is founder",
            "who founded credon",
            "founder of credon",
            "credon founder",
            "who made credon",
            "who created credon",
        ]
    )


def _greeting_response(query: str, language: Literal["en", "hinglish"]) -> str | None:
    if _is_founder_query(query):
        if language == "hinglish":
            return "Credon AI ke founder **Swapnil Shinde** hain — 19-year-old CSE student."
        return "Credon AI was founded by **Swapnil Shinde**, a 19-year-old CSE student."

    if _is_greeting(query):
        if language == "hinglish":
            return "Hey! 👋 Main Credon AI hoon. Aap kya explore karna chahte ho aaj?"
        return "Hey! 👋 I’m Credon AI. What would you like to explore today?"

    if _is_intro_query(query):
        if language == "hinglish":
            return (
                "Main Credon AI hoon — main web research, concepts explain, coding help, math solve, aur documents/images analyze kar sakta hoon. "
                "Aap koi bhi specific question bhejo, main step-by-step help karunga."
            )
        return (
            "I’m Credon AI — I can do web research, explain concepts, help with coding, solve math, and analyze documents/images. "
            "Ask any specific question and I’ll help step by step."
        )

    return None


def _is_realtime_query(query: str) -> bool:
    """Detect queries about current time, date, day, or live info."""
    q = query.strip().lower()
    realtime_patterns = [
        r"\bwhat\s+(is\s+)?(the\s+)?(current\s+)?time\b",
        r"\bwhat\s+time\s+is\s+it\b",
        r"\bwhat\s+(is\s+)?today\b",
        r"\bwhat\s+(day|date)\s+(is\s+)?(it\s+)?today\b",
        r"\bwhat\s+is\s+(the\s+)?(current\s+)?date\b",
        r"\bwhich\s+day\s+is\s+(it\s+)?today\b",
        r"\b(tell|give)\s+me\s+(the\s+)?(time|date|day)\b",
        r"\bcurrent\s+(time|date|day)\b",
        r"\btoday'?s?\s+(date|day)\b",
        r"\btime\s+(now|right\s+now)\b",
        r"\bdate\s+today\b",
        r"\bwhat\s+is\s+time\s+now\b",
        r"\bwhat\s+day\s+of\s+the\s+week\b",
        r"\bdin\s+kya\s+hai\b",
        r"\bkya\s+(time|samay|din|date)\b",
        r"\baaj\s+(kya|kaun)\s+(din|date|day)\b",
        r"\babhi\s+(kya\s+)?(time|samay)\b",
    ]
    return any(re.search(p, q) for p in realtime_patterns)


def _realtime_response(query: str, language: str) -> str:
    """Generate real-time response for time/date/day queries using system clock."""
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td

    q = query.lower()
    _location_tz: dict[str, tuple[str, str]] = {
        "india": ("Asia/Kolkata", "India (IST, UTC+5:30)"),
        "pune": ("Asia/Kolkata", "Pune, India (IST)"),
        "mumbai": ("Asia/Kolkata", "Mumbai, India (IST)"),
        "delhi": ("Asia/Kolkata", "Delhi, India (IST)"),
        "kolkata": ("Asia/Kolkata", "Kolkata, India (IST)"),
        "chennai": ("Asia/Kolkata", "Chennai, India (IST)"),
        "bangalore": ("Asia/Kolkata", "Bangalore, India (IST)"),
        "hyderabad": ("Asia/Kolkata", "Hyderabad, India (IST)"),
        "new york": ("America/New_York", "New York (EST/EDT)"),
        "london": ("Europe/London", "London (GMT/BST)"),
        "tokyo": ("Asia/Tokyo", "Tokyo (JST, UTC+9)"),
        "sydney": ("Australia/Sydney", "Sydney (AEST/AEDT)"),
        "dubai": ("Asia/Dubai", "Dubai (GST, UTC+4)"),
        "singapore": ("Asia/Singapore", "Singapore (SGT, UTC+8)"),
        "los angeles": ("America/Los_Angeles", "Los Angeles (PST/PDT)"),
        "pakistan": ("Asia/Karachi", "Pakistan (PKT, UTC+5)"),
        "nepal": ("Asia/Kathmandu", "Nepal (NPT, UTC+5:45)"),
        "bangladesh": ("Asia/Dhaka", "Bangladesh (BST, UTC+6)"),
    }

    tz_key = "Asia/Kolkata"
    location_label = "India (IST, UTC+5:30)"
    for loc, (tz_name, label) in _location_tz.items():
        if loc in q:
            tz_key = tz_name
            location_label = label
            break

    try:
        import zoneinfo
        tz = zoneinfo.ZoneInfo(tz_key)
    except Exception:
        tz = _tz(_td(hours=5, minutes=30))

    now = _dt.now(_tz.utc).astimezone(tz)
    time_str = now.strftime("%I:%M %p")
    date_str = now.strftime("%B %d, %Y")
    day_str = now.strftime("%A")

    if language == "hinglish":
        return (
            f"**Abhi ka time aur date ({location_label}):**\n\n"
            f"- \u23f0 **Time:** {time_str}\n"
            f"- \U0001f4c5 **Date:** {date_str}\n"
            f"- \U0001f4c6 **Day:** {day_str}\n\n"
            f"Kisi aur city ka time chahiye? Bas poochho! "
            f"Jaise: \"Tokyo ka time kya hai?\""
        )

    return (
        f"**Current Time & Date ({location_label}):**\n\n"
        f"- \u23f0 **Time:** {time_str}\n"
        f"- \U0001f4c5 **Date:** {date_str}\n"
        f"- \U0001f4c6 **Day:** {day_str}\n\n"
        f"Need the time for a different location? Just ask! "
        f"For example: \"What is the time in Tokyo?\""
    )


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


def _is_programming_query(query: str) -> bool:
    q = query.lower()
    patterns = [
        r"\b(code|program|script|function|class|algorithm|debug|bug|refactor)\b",
        r"\b(python|javascript|typescript|java|c\+\+|c#|go|rust|php|ruby|swift|kotlin|sql|html|css)\b",
        r"\b(api|endpoint|json|regex|database|query|docker|kubernetes|fastapi|next\.js|react|node)\b",
        r"```",
    ]
    return any(re.search(pattern, q) for pattern in patterns)


def _detect_requested_code_language(query: str) -> str | None:
    q = query.lower()
    language_patterns: list[tuple[str, list[str]]] = [
        ("c++", [r"\bc\+\+\b", r"\bcpp\b"]),
        ("c", [r"\bc language\b", r"\bc code\b", r"\bin c\b", r"\bc\b"]),
        ("python", [r"\bpython\b", r"\bpy\b"]),
        ("javascript", [r"\bjavascript\b", r"\bjs\b"]),
        ("typescript", [r"\btypescript\b", r"\bts\b"]),
        ("java", [r"\bjava\b"]),
        ("go", [r"\bgolang\b", r"\bgo\b"]),
        ("rust", [r"\brust\b"]),
        ("php", [r"\bphp\b"]),
        ("sql", [r"\bsql\b"]),
    ]
    for language, patterns in language_patterns:
        for pattern in patterns:
            if re.search(pattern, q):
                return language
    return None


def _code_enhanced_query(query: str, code_mode_requested: bool) -> tuple[str, bool]:
    # Respect explicit UI toggle only. If code mode is OFF, do not force code-style output.
    code_mode_active = code_mode_requested
    if not code_mode_active:
        return query, False
    requested_language = _detect_requested_code_language(query)
    language_rule = (
        f"Use ONLY {requested_language} for code examples unless the user explicitly asks for another language. "
        if requested_language
        else "If user asks for a specific language, use only that language and avoid switching to other languages. "
    )
    code_instruction = (
        "You are in CODE MODE. Return practical, runnable code. "
        "Use proper fenced code blocks with language tags. "
        "Keep explanation concise and include steps to run/test. "
        "If there are multiple approaches, pick one best default first. "
        f"{language_rule}"
        "If user shares broken code, first explain the issue, then provide corrected code. "
        "If user asks in Hinglish or asks for Hinglish, explain in Hinglish while keeping code syntax standard."
    )
    return f"{query}\n\n[{code_instruction}]", True


def _web_result_budget(query: str, *, deep_think: bool = True, master_mode: bool = False) -> int:
    q = query.lower().strip()
    explicit_top_n = _extract_top_n_request(q)
    if explicit_top_n is not None:
        return max(6, min(30 if master_mode else 40, explicit_top_n))

    if _is_news_query(q):
        return 8 if deep_think else 6

    if _is_simple_query(q):
        return 4 if deep_think else 3

    words = len(q.split())
    if words >= 30:
        base = 12
    elif words >= 18:
        base = 10
    else:
        base = 8

    if master_mode:
        base = min(base, 8)

    if not deep_think:
        return max(4, min(base, 7))
    return base


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
        for candidate in ["deepseek-reasoner", "deepseek-chat", "groq:llama-3.3-70b-versatile"]:
            if candidate in cloud:
                return candidate
        return candidates[0]

    if _is_simple_query(query):
        return pick(["qwen3:4b", "deepseek-r1:1.5b", "qwen3:8b", "deepseek-r1:8b", "deepseek-chat", "groq:llama-3.3-70b-versatile"])
    if _is_math_query(query):
        return pick(["qwen3:8b", "deepseek-r1:8b", "deepseek-reasoner", "deepseek-chat", "groq:deepseek-r1-distill-llama-70b", "qwen3:4b"])
    return pick(["qwen3:8b", "deepseek-r1:8b", "deepseek-reasoner", "deepseek-chat", "groq:llama-3.3-70b-versatile", "qwen3:4b"])


def _is_visual_query_local(query: str) -> bool:
    q = query.lower()
    explicit_visual = any(
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
    educational_visual = bool(re.search(r"\b(explain|what is|overview|compare|history of|types of)\b", q)) and len(q.split()) >= 3
    return explicit_visual or educational_visual



def _is_direct_image_request(query: str) -> bool:
    q = query.lower().strip()
    if re.search(r"\b(show|find|get|display|search)\b.*\b(image|images|photo|photos|picture|pictures|wallpaper|logo)\b", q):
        return True
    if re.search(r"\b(image|photo|picture|wallpaper)\s+(of|for)\b", q):
        return True
    return False

def _image_search_query(query: str) -> str:
    q = re.sub(r"\b(please|show|find|get|display|search|me|some|images?|photos?|pictures?|wallpaper)\b", " ", query, flags=re.IGNORECASE)
    q = re.sub(r"\s+", " ", q).strip(" ?.,:-")
    return q or query.strip()

def _image_answer(query: str, count: int, language: str) -> str:
    subject = _image_search_query(query)
    if count > 0:
        return (
            f"Here are source-linked reference image cards for **{subject}**. Open each card/source URL to verify image rights before reuse; results from license-friendly sources are preferred when available, but rights are not guaranteed."
            if language == "en"
            else f"**{subject}** ke source-linked reference image cards yahan hain. Reuse se pehle har card/source URL open karke image rights verify karo; license-friendly sources prefer kiye gaye hain, par rights guarantee nahi hain."
        )
    return (
        f"I could not fetch image cards for **{subject}** right now. Try again, or ask me to create a prompt for generating one."
        if language == "en"
        else f"Abhi **{subject}** ke image cards fetch nahi ho paaye. Dobara try karo, ya main image generation prompt bana sakta hoon."
    )


def _image_response_metadata() -> dict[str, Any]:
    return {
        "image_cards": {
            "type": "source_linked_reference_images",
            "rights_notice": "Open each source URL to verify license and reuse rights before downloading, saving, or publishing.",
            "license_safe_sources_preferred": ["Wikimedia Commons", "Unsplash", "Pexels", "Pixabay"],
        }
    }

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


def _query_source_overlap_score(query: str, source: dict[str, str]) -> float:
    def _domain_score(url: str) -> float:
        u = (url or "").lower()
        if u.startswith("credon://knowledge/"):
            return 0.95
        if any(token in u for token in ["wikipedia.org", ".edu", ".gov", ".ac."]):
            return 0.9
        if any(token in u for token in ["arxiv.org", "nature.com", "sciencedirect.com", "ieee.org"]):
            return 0.88
        if any(token in u for token in ["medium.com", "quora.com", "reddit.com"]):
            return 0.62
        if u.startswith("http://") or u.startswith("https://"):
            return 0.74
        return 0.5

    query_words = set(re.findall(r"\w{4,}", query.lower()))
    combined = f"{source.get('title', '')} {source.get('snippet', '')}"
    source_words = set(re.findall(r"\w{4,}", combined.lower()))
    if not query_words or not source_words:
        return 0.0

    overlap = len(query_words & source_words) / max(len(query_words), 1)
    snippet = source.get("snippet", "")
    title = source.get("title", "")
    url = source.get("url", "")

    snippet_quality = min(len(snippet) / 320.0, 1.0)
    title_quality = min(len(title) / 80.0, 1.0)
    domain_quality = _domain_score(url)
    # Penalize snippets dominated by symbols/noise.
    noise_chars = len(re.findall(r"[^a-zA-Z0-9\s\.,:\-\(\)\[\]/]", snippet))
    noise_ratio = noise_chars / max(len(snippet), 1)
    noise_penalty = min(noise_ratio * 0.3, 0.2)

    base = (
        (overlap * 0.5)
        + (snippet_quality * 0.2)
        + (title_quality * 0.1)
        + (domain_quality * 0.2)
    )
    return max(0.0, min(1.0, base - noise_penalty))


def _evaluate_sources(query: str, sources: list[dict[str, str]], keep: int = 8) -> tuple[list[dict[str, str]], dict[str, float | int]]:
    if not sources:
        return [], {
            "input_sources": 0,
            "selected_sources": 0,
            "avg_score": 0.0,
            "min_selected_score": 0.0,
            "dropped_low_quality": 0,
        }

    scored: list[tuple[float, dict[str, str]]] = []
    for source in sources:
        score = _query_source_overlap_score(query, source)
        scored.append((score, source))

    scored.sort(key=lambda item: item[0], reverse=True)
    quality_threshold = 0.12 if len(scored) >= 4 else 0.08
    selected = [item[1] for item in scored[:keep] if item[0] >= quality_threshold]
    if not selected:
        selected = [item[1] for item in scored[: min(keep, len(scored))]]

    top_scores = [item[0] for item in scored[: min(keep, len(scored))]]
    avg_score = sum(top_scores) / max(len(top_scores), 1)
    min_selected_score = min(top_scores[: len(selected)]) if selected else 0.0
    dropped_low_quality = sum(1 for item in scored[:keep] if item[0] < quality_threshold)

    diagnostics: dict[str, float | int] = {
        "input_sources": len(sources),
        "selected_sources": len(selected),
        "avg_score": round(avg_score, 4),
        "min_selected_score": round(float(min_selected_score), 4),
        "dropped_low_quality": dropped_low_quality,
    }
    return selected, diagnostics


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
        r"^tell me more",
        r"^more details",
        r"^go deeper",
        r"^continue",
        r"^go on",
    ]
    return any(re.search(p, q) for p in patterns)


def _is_ambiguous_short_followup(query: str) -> bool:
    q = query.lower().strip()
    if len(q.split()) > 5:
        return False
    if q.startswith("for "):
        return True
    return q in {"explain", "simplify", "why", "how", "details", "more", "elaborate", "tell me more", "go deeper", "go on"}


def _is_reference_followup(query: str) -> bool:
    """Detect short deictic follow-ups that usually refer to previous context."""
    q = query.strip().lower()
    if not q:
        return False
    patterns = [
        r"\b(this|that|it|these|those|above|previous|earlier)\b",
        r"\b(explain|summarize|simplify|short|brief|details)\s+(this|that|it)\b",
        r"\babout\s+(this|that|it)\b",
        r"\b(in|from)\s+(this|that)\s+(pdf|file|image|doc|document)\b",
    ]
    if any(re.search(p, q) for p in patterns):
        return True
    return len(q.split()) <= 7 and q in {
        "explain this",
        "summarize this",
        "what about this",
        "what about that",
        "from this pdf",
        "from this image",
    }


def _is_news_query(query: str) -> bool:
    q = query.lower()
    return bool(re.search(r"\b(news|headlines|breaking|current events|latest updates)\b", q))


def _extract_top_n_request(query: str) -> int | None:
    q = query.lower()
    match = re.search(r"\btop\s+(\d{1,2})\b", q)
    if match:
        return max(3, min(50, int(match.group(1))))
    match = re.search(r"\b(\d{1,2})\s+(news|headlines|updates)\b", q)
    if match:
        return max(3, min(50, int(match.group(1))))
    return None


def _is_variation_request(query: str) -> bool:
    q = query.lower()
    patterns = [
        r"\bdifferent answer\b",
        r"\banswer differently\b",
        r"\banother way\b",
        r"\banother perspective\b",
        r"\bdifferent approach\b",
        r"\bdon't repeat\b",
    ]
    return any(re.search(p, q) for p in patterns)


def _safe_int(value: object, default: int = 0) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except Exception:
            return default
    return default


def _detail_preference(query: str, transcript: list[dict[str, Any]]) -> Literal["short", "detailed", "default"]:
    q = query.lower()
    short_markers = [
        "short", "brief", "in short", "tldr", "tl;dr", "one line", "2 lines", "summary",
    ]
    detailed_markers = [
        "in detail", "detailed", "deep", "step by step", "elaborate", "full explain", "long answer",
    ]
    if any(marker in q for marker in short_markers):
        return "short"
    if any(marker in q for marker in detailed_markers):
        return "detailed"

    for item in reversed(transcript[-10:]):
        if str(item.get("role", "")).lower() != "user":
            continue
        text = str(item.get("text", "")).lower()
        if any(marker in text for marker in short_markers):
            return "short"
        if any(marker in text for marker in detailed_markers):
            return "detailed"
    return "default"


def _shape_query_for_user_intent(
    query_for_model: str,
    original_query: str,
    transcript: list[dict[str, Any]],
) -> tuple[str, dict[str, object]]:
    detail_pref = _detail_preference(original_query, transcript)
    explicit_top_n = _extract_top_n_request(original_query)
    news_top_n = explicit_top_n if explicit_top_n is not None else (10 if _is_news_query(original_query) else 0)

    hints: list[str] = []
    if detail_pref == "short":
        hints.append("Keep the response concise: 3-5 bullets or one short paragraph.")
    elif detail_pref == "detailed":
        hints.append("Give a detailed, structured response with key highlights and practical points.")

    if news_top_n > 0:
        hints.append(
            f"For this news query, provide Top {news_top_n} updates for today with numbered points, why each matters, and a short source note."
        )

    if _is_math_query(original_query):
        hints.append("For math/problem solving, show step-by-step solution and final answer clearly.")
    if _is_variation_request(original_query):
        hints.append("Provide a meaningfully different angle/approach than earlier responses and avoid repeating the same wording.")

    if not hints:
        return query_for_model, {"detail_preference": detail_pref}

    shaped = query_for_model + "\n\n[Response style instructions: " + " ".join(hints) + "]"
    meta: dict[str, object] = {"detail_preference": detail_pref}
    if news_top_n > 0:
        meta["news_top_n"] = news_top_n
    return shaped, meta


def _is_pdf_reference_query(query: str) -> bool:
    q = query.strip().lower()
    patterns = [
        r"\b(this|that|my|the)\s+pdf\b",
        r"\b(pdf|document|file)\s*(uploaded|upload|above|shared)\b",
        r"\btell\s+me\s+about\s+this\s+pdf\b",
        r"\bsummarize\s+(this|the)\s+pdf\b",
    ]
    return any(re.search(pattern, q) for pattern in patterns)


def _latest_non_user_context(transcript: list[dict[str, Any]], current_query: str) -> str:
    """Get latest useful context from transcript excluding current user echo."""
    normalized_current = current_query.strip().lower()
    for item in reversed(transcript):
        role = str(item.get("role", "")).lower()
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        if role == "assistant":
            return text
        if role == "user" and text.lower() != normalized_current:
            return text
    return ""


def _contextual_query(query: str, transcript: list[dict[str, Any]]) -> str:
    """Augment ambiguous follow-ups with nearby transcript context for retrieval/generation."""
    if not (
        _is_reference_followup(query)
        or _is_ambiguous_short_followup(query)
        or _is_contextual_followup(query)
    ):
        return query
    context = _latest_non_user_context(transcript, query)
    if not context:
        return query
    compact = context.replace("\n", " ").strip()[:700]
    return f"{query}\n\nContext from previous chat: {compact}"


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
    number: int, transcript: list[dict[str, Any]]
) -> str | None:
    """Extract the Nth suggestion from the last assistant message.
    Checks stored metadata suggestions first, then falls back to text extraction."""
    for item in reversed(transcript):
        if item.get("role") == "assistant":
            # Check stored suggestions in metadata first
            meta = item.get("metadata")
            if isinstance(meta, dict):
                stored = meta.get("suggestions")  # type: ignore[union-attr]
                if isinstance(stored, list) and 1 <= number <= len(stored):  # type: ignore[arg-type]
                    return str(stored[number - 1])  # type: ignore[arg-type]
            # Fallback: extract from text
            text: str = item.get("text", "")
            suggestions = extract_suggestions(text)
            if 1 <= number <= len(suggestions):
                return suggestions[number - 1]
            break
    return None


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


def _maybe_prefer_brain_answer(
    query: str,
    model_answer: str,
    sources: list[dict[str, str]],
    target_language: str,
    thinking: str,
    model_used: str,
) -> tuple[str, str]:
    """Arbitrate between model answer and brain synthesis using validator metrics.

    Returns (chosen_answer, chosen_source) where chosen_source is "model" or "brain".
    """
    model_report = validate_answer(query, model_answer, sources, thinking, model_used)
    brain_candidate = credon_answer(query, sources=sources or None, target_language=target_language)
    if not brain_candidate:
        return model_answer, "model"

    brain_answer = _clean_answer(brain_candidate)
    brain_report = validate_answer(query, brain_answer, sources, "", "credon-brain")

    model_score = (
        (0.45 * float(model_report.get("relevancy_score", 0.0)))
        + (0.45 * float(model_report.get("source_coverage", 0.0)))
        + (0.10 if bool(model_report.get("valid")) else 0.0)
    )
    brain_score = (
        (0.45 * float(brain_report.get("relevancy_score", 0.0)))
        + (0.45 * float(brain_report.get("source_coverage", 0.0)))
        + (0.10 if bool(brain_report.get("valid")) else 0.0)
    )

    prefer_brain = False
    if brain_report.get("confidence") == "high" and model_report.get("confidence") != "high":
        prefer_brain = True
    elif brain_score >= model_score + 0.08:
        prefer_brain = True

    return (brain_answer, "brain") if prefer_brain else (model_answer, "model")


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
    """Return only the public Credon Alpha 1 model.
    All model selection and orchestration happens internally."""
    return {
        "models": [_public_model()],
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
    working_query = _contextual_query(cleaned_query, transcript)
    working_query, code_mode_active = _code_enhanced_query(working_query, payload.code_mode)
    working_query, intent_meta = _shape_query_for_user_intent(working_query, cleaned_query, transcript)
    cache_key = _response_cache_key(
        user_id=payload.user_id,
        query=cleaned_query,
        language=target_language,
        use_web=payload.use_web,
        deep_think=payload.deep_think,
        code_mode=code_mode_active,
        detail_pref=str(intent_meta.get("detail_preference", "default")),
        news_top_n=_safe_int(intent_meta.get("news_top_n", 0), 0),
    )

    agent_plan = manager_plan(cleaned_query, use_web=payload.use_web, deep_think=payload.deep_think, code_mode=payload.code_mode)

    followup_mode = (
        _is_contextual_followup(cleaned_query)
        or _is_ambiguous_short_followup(cleaned_query)
        or _is_reference_followup(cleaned_query)
    )
    if followup_mode and not reply_context:
        reply_context = _latest_assistant_context(transcript)

    if not followup_mode and not reply_context and not has_attachment_marker:
        cached = _response_cache_get(cache_key)
        if cached:
            cached_answer = str(cached.get("answer", "")).strip()
            if cached_answer:
                save_message(
                    payload.user_id,
                    payload.session_id,
                    "assistant",
                    cached_answer,
                    thinking=str(cached.get("thinking", "")),
                    confidence=str(cached.get("confidence", "medium")),
                    sources=cast(list[dict[str, str]], cached.get("sources", [])),
                    metadata={
                        "routing": {
                            "selected_route": "response_cache",
                            "reason": "recent_similar_query",
                            "score": 1.0,
                        },
                        "intent": intent_meta,
                    },
                )
                elapsed = int((perf_counter() - start) * 1000)
                return ChatResponse(
                    answer=cached_answer,
                    language=target_language,
                    confidence=cast(Literal["high", "medium", "low"], cached.get("confidence", "medium")),
                    sources=[Source(title=s.get("title", ""), url=s.get("url", "")) for s in cast(list[dict[str, str]], cached.get("sources", []))],
                    images=[ImageResult(**img) for img in cast(list[dict[str, str]], cached.get("images", []))] if cached.get("images") else [],
                    suggestions=cast(list[str], cached.get("suggestions", [])),
                    thinking=str(cached.get("thinking", "")),
                    latency_ms=elapsed,
                    metadata={"routing": {"selected_route": "response_cache", "reason": "recent_similar_query", "score": 1.0}},
                )

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

    if followup_mode and reply_context and not _is_pdf_reference_query(cleaned_query):
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

    profile_update = profile_update_acknowledgement(cleaned_query, transcript, target_language)
    if profile_update:
        save_message(payload.user_id, payload.session_id, "assistant", profile_update)
        elapsed = int((perf_counter() - start) * 1000)
        return ChatResponse(
            answer=profile_update,
            language=target_language,
            confidence="high",
            sources=[],
            images=[],
            latency_ms=elapsed,
            metadata={"routing": {"selected_route": "profile_update_ack", "reason": "first_person_profile_update", "score": 1.0}},
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

    news = news_answer(cleaned_query, target_language, max_items=_safe_int(intent_meta.get("news_top_n", 6), 6) or 6)
    if news:
        news_reply, news_sources, news_meta = news
        metadata = {"routing": {"selected_route": "news_agent", "reason": "free_gdelt_news", "score": 1.0}, "agent_plan": agent_plan, **news_meta}
        save_message(payload.user_id, payload.session_id, "assistant", news_reply, confidence="high", sources=news_sources, metadata=metadata)
        elapsed = int((perf_counter() - start) * 1000)
        return ChatResponse(answer=news_reply, language=target_language, confidence="high", sources=[Source(title=s["title"], url=s["url"]) for s in news_sources], images=[], suggestions=["Explain headline 1 simply", "Show only India-related updates", "Give a timeline"], thinking="News Agent used GDELT free API.", latency_ms=elapsed, metadata=metadata)

    weather = weather_answer(cleaned_query, target_language, payload.latitude, payload.longitude)
    if weather:
        weather_reply, weather_sources, weather_meta = weather
        metadata = {"routing": {"selected_route": "weather_agent", "reason": "free_open_meteo", "score": 1.0}, "agent_plan": agent_plan, **weather_meta}
        save_message(payload.user_id, payload.session_id, "assistant", weather_reply, confidence="high", sources=weather_sources, metadata=metadata)
        elapsed = int((perf_counter() - start) * 1000)
        return ChatResponse(answer=weather_reply, language=target_language, confidence="high", sources=[Source(title=s["title"], url=s["url"]) for s in weather_sources], images=[], suggestions=["Show hourly rain chances", "What about tomorrow?"], thinking="Weather Agent used Open-Meteo free API.", latency_ms=elapsed, metadata=metadata)

    # Real-time queries (time, date, day) — answered instantly from system clock
    if _is_realtime_query(cleaned_query):
        realtime_reply = _realtime_response(cleaned_query, target_language)
        save_message(payload.user_id, payload.session_id, "assistant", realtime_reply)
        elapsed = int((perf_counter() - start) * 1000)
        return ChatResponse(
            answer=realtime_reply,
            language=target_language,
            confidence="high",
            sources=[],
            images=[],
            suggestions=[],
            thinking="Real-time query — answered from system clock.",
            latency_ms=elapsed,
            metadata={"routing": {"selected_route": "realtime_shortcut", "reason": "realtime_query", "score": 1.0}},
        )

    if _is_direct_image_request(cleaned_query):
        image_query = _image_search_query(cleaned_query)
        raw_images = search_images(image_query, max_results=6)
        image_reply = _image_answer(cleaned_query, len(raw_images), target_language)
        image_sources = [
            {"title": img.get("title") or img.get("source_url") or "Image source", "url": img.get("source_url") or img.get("image_url") or ""}
            for img in raw_images
            if img.get("source_url") or img.get("image_url")
        ]
        metadata = {
            "routing": {"selected_route": "image_search", "reason": "direct_image_request", "score": 1.0},
            "agent_plan": manager_plan(cleaned_query, use_web=True, deep_think=False, code_mode=False),
            **_image_response_metadata(),
        }
        save_message(payload.user_id, payload.session_id, "assistant", image_reply, confidence="high" if raw_images else "low", sources=image_sources, metadata=metadata)
        elapsed = int((perf_counter() - start) * 1000)
        return ChatResponse(
            answer=image_reply,
            language=target_language,
            confidence="high" if raw_images else "low",
            sources=[Source(title=s["title"], url=s["url"]) for s in image_sources],
            images=[ImageResult(**img) for img in raw_images],
            suggestions=["Show more images", "Create an image generation prompt", "Find official sources"],
            thinking="Image request detected — searched image results.",
            latency_ms=elapsed,
            metadata=metadata,
        )

    greeting_reply = _greeting_response(cleaned_query, target_language)
    if greeting_reply:
        save_message(payload.user_id, payload.session_id, "assistant", greeting_reply)
        elapsed = int((perf_counter() - start) * 1000)
        return ChatResponse(
            answer=greeting_reply,
            language=target_language,
            confidence="high",
            sources=[],
            images=[],
            suggestions=[],
            thinking="",
            latency_ms=elapsed,
            metadata={"routing": {"selected_route": "greeting_shortcut", "reason": "simple_greeting_or_intro", "score": 1.0}},
        )

    instant_mode = (not payload.use_web) and (not payload.deep_think)
    if instant_mode:
        chosen_model = payload.model or _choose_internal_model(cleaned_query, False)
        fast_answer = credon_answer(cleaned_query, sources=None, target_language=target_language)
        if not fast_answer:
            fast_answer = generate_grounded_answer(
                working_query,
                [],
                target_language,
                model=chosen_model,
                thinking="",
            )
        answer = _clean_answer(fast_answer)
        suggestions = extract_suggestions(answer)
        answer = trim_answer_suggestions(answer)
        save_message(payload.user_id, payload.session_id, "assistant", answer)
        learn_from_conversation(cleaned_query, answer, "high")
        elapsed = int((perf_counter() - start) * 1000)
        return ChatResponse(
            answer=answer,
            language=target_language,
            confidence="high",
            sources=[],
            images=[],
            suggestions=suggestions,
            thinking="",
            latency_ms=elapsed,
            metadata={"routing": {"selected_route": "instant_mode", "reason": "web_off_deepthink_off", "score": 1.0}},
        )

    has_model = _has_available_model()

    quick_knowledge = retrieve_knowledge_context(payload.user_id, working_query, top_k=3) if not _is_greeting(cleaned_query) else []
    if quick_knowledge:
        quick_knowledge, _ = _evaluate_sources(cleaned_query, quick_knowledge, keep=3)
    quick_score, quick_reason, quick_diagnostics = _routing_score(
        working_query,
        quick_knowledge,
        has_model=has_model,
        use_web=payload.use_web,
    )
    quick_route = _should_try_brain_first(cleaned_query) and quick_score >= 0.78

    if quick_route:
        _log_routing("credon_answer", quick_reason, quick_score, quick_diagnostics)
        brain_answer = credon_answer(working_query, sources=quick_knowledge or None, target_language=target_language)
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

    retrieval_allowed = not _is_greeting(cleaned_query)
    master_mode_active = payload.use_web and payload.deep_think and code_mode_active
    use_web = (
        payload.use_web
        and retrieval_allowed
        and not is_personal_query(cleaned_query)
        and not followup_mode
        and not _is_pdf_reference_query(cleaned_query)
        and (not code_mode_active or master_mode_active)
    )
    chosen_model = payload.model or _choose_internal_model(cleaned_query, use_web)

    knowledge_results = retrieve_knowledge_context(payload.user_id, working_query, top_k=4 if payload.deep_think else 3) if retrieval_allowed else []
    web_results = retrieve_sources(
        working_query,
        max_results=_web_result_budget(cleaned_query, deep_think=payload.deep_think),
    ) if use_web else []
    merged_results = _merge_sources(knowledge_results, web_results)
    results, eval_diag = _evaluate_sources(cleaned_query, merged_results)

    if len(results) >= 4:
        confidence = "high"
    elif len(results) >= 2:
        confidence = "medium"
    else:
        confidence = "low"

    if not has_model:
        brain_answer = credon_answer(working_query, sources=results or None, target_language=target_language)
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
                    },
                    "evaluator": eval_diag,
                },
            )

    # Thinking step
    thinking = think_about_sources(working_query, results, model=chosen_model) if payload.deep_think else ""

    raw_model_answer = generate_grounded_answer(
        working_query, results, target_language,
        model=chosen_model, thinking=thinking,
    )
    model_answer = _clean_answer(raw_model_answer)

    if payload.deep_think:
        answer, arbitration_source = _maybe_prefer_brain_answer(
            working_query,
            model_answer,
            results,
            target_language,
            thinking,
            chosen_model,
        )
    else:
        answer, arbitration_source = model_answer, "model"

    # Extract suggestions + trim from selected answer
    suggestions = extract_suggestions(answer)
    answer = trim_answer_suggestions(answer)

    # Cross-check answer quality
    if payload.deep_think or len(results) >= 2:
        answer, confidence = _apply_cross_check(
            working_query, answer, results, thinking, chosen_model, confidence
        )

    sources_payload = [{"title": item["title"], "url": item["url"]} for item in results]
    route_meta = {
        "routing": {
            "selected_route": "model_generation",
            "score": round(quick_score, 4),
            "reason": quick_reason,
        },
        "mode": {"code_mode": code_mode_active, "master_mode": master_mode_active},
        "intent": intent_meta,
        "agent_plan": agent_plan,
        "answer_arbitration": {"chosen": arbitration_source},
        "evaluator": eval_diag,
    }
    save_message(
        payload.user_id, payload.session_id, "assistant", answer,
        thinking=thinking, confidence=confidence,
        sources=sources_payload, metadata={**route_meta, "suggestions": suggestions},
    )
    # Self-learning: save this Q&A so Credon gets smarter
    learn_from_conversation(cleaned_query, answer, confidence)

    # Image search for visual queries
    images: list[ImageResult] = []
    if use_web and _is_visual_query_local(cleaned_query):
        raw_images = search_images(cleaned_query, max_results=3)
        images = [ImageResult(**img) for img in raw_images]

    elapsed = int((perf_counter() - start) * 1000)

    _response_cache_set(
        cache_key,
        {
            "answer": answer,
            "confidence": confidence,
            "sources": sources_payload,
            "images": [img.model_dump() for img in images],
            "suggestions": suggestions,
            "thinking": thinking,
        },
    )

    return ChatResponse(
        answer=answer,
        language=target_language,
        confidence=confidence,  # type: ignore[arg-type]
        sources=[Source(title=item["title"], url=item["url"]) for item in results],
        images=images,
        suggestions=suggestions,
        thinking=thinking,
        latency_ms=elapsed,
        metadata={**route_meta, **(_image_response_metadata() if images else {})},
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
    working_query = _contextual_query(cleaned_query, transcript)
    working_query, code_mode_active = _code_enhanced_query(working_query, payload.code_mode)
    working_query, intent_meta = _shape_query_for_user_intent(working_query, cleaned_query, transcript)
    cache_key = _response_cache_key(
        user_id=payload.user_id,
        query=cleaned_query,
        language=target_language,
        use_web=payload.use_web,
        deep_think=payload.deep_think,
        code_mode=code_mode_active,
        detail_pref=str(intent_meta.get("detail_preference", "default")),
        news_top_n=_safe_int(intent_meta.get("news_top_n", 0), 0),
    )

    agent_plan = manager_plan(cleaned_query, use_web=payload.use_web, deep_think=payload.deep_think, code_mode=payload.code_mode)

    followup_mode = (
        _is_contextual_followup(cleaned_query)
        or _is_ambiguous_short_followup(cleaned_query)
        or _is_reference_followup(cleaned_query)
    )
    if followup_mode and not reply_context:
        reply_context = _latest_assistant_context(transcript)

    if not followup_mode and not reply_context and not has_attachment_marker:
        cached = _response_cache_get(cache_key)
        if cached and str(cached.get("answer", "")).strip():
            cached_answer = str(cached.get("answer", "")).strip()
            cached_conf = cast(Literal["high", "medium", "low"], str(cached.get("confidence", "medium")))
            cached_sources = cast(list[dict[str, str]], cached.get("sources", []))
            cached_images = cast(list[dict[str, str]], cached.get("images", []))
            cached_suggestions = cast(list[str], cached.get("suggestions", []))
            cached_thinking = str(cached.get("thinking", ""))
            save_message(
                payload.user_id,
                payload.session_id,
                "assistant",
                cached_answer,
                thinking=cached_thinking,
                confidence=cached_conf,
                sources=cached_sources,
                metadata={
                    "routing": {
                        "selected_route": "response_cache_stream",
                        "reason": "recent_similar_query",
                        "score": 1.0,
                    },
                    "intent": intent_meta,
                },
            )
            elapsed = int((perf_counter() - start) * 1000)

            def _cached_events():
                if cached_thinking:
                    yield f"data: {_json.dumps({'type': 'thinking', 'content': cached_thinking})}\n\n"
                if cached_sources or cached_images:
                    yield f"data: {_json.dumps({'type': 'sources', 'sources': cached_sources, 'confidence': cached_conf, 'images': cached_images})}\n\n"
                yield f"data: {_json.dumps({'type': 'token', 'content': cached_answer})}\n\n"
                yield f"data: {_json.dumps({'type': 'done', 'confidence': cached_conf, 'sources': cached_sources, 'images': cached_images, 'suggestions': cached_suggestions, 'latency_ms': elapsed, 'metadata': {'routing': {'selected_route': 'response_cache_stream', 'reason': 'recent_similar_query', 'score': 1.0}}})}\n\n"

            return StreamingResponse(_cached_events(), media_type="text/event-stream")

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

    if followup_mode and reply_context and not _is_pdf_reference_query(cleaned_query):
        chosen_model = payload.model or _choose_internal_model(cleaned_query, False)
        answer_text = _clean_answer(
            generate_followup_from_context(
                working_query,
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

    profile_update = profile_update_acknowledgement(cleaned_query, transcript, target_language)
    if profile_update:
        save_message(payload.user_id, payload.session_id, "assistant", profile_update)
        elapsed = int((perf_counter() - start) * 1000)

        def _profile_update_events():
            yield f"data: {_json.dumps({'type': 'token', 'content': profile_update})}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'confidence': 'high', 'sources': [], 'images': [], 'latency_ms': elapsed, 'metadata': {'routing': {'selected_route': 'profile_update_ack_stream', 'reason': 'first_person_profile_update', 'score': 1.0}}})}\n\n"

        return StreamingResponse(_profile_update_events(), media_type="text/event-stream")

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

    news = news_answer(cleaned_query, target_language, max_items=_safe_int(intent_meta.get("news_top_n", 6), 6) or 6)
    if news:
        news_reply, news_sources, news_meta = news
        metadata = {"routing": {"selected_route": "news_agent_stream", "reason": "free_gdelt_news", "score": 1.0}, "agent_plan": agent_plan, **news_meta}
        save_message(payload.user_id, payload.session_id, "assistant", news_reply, confidence="high", sources=news_sources, metadata=metadata)
        elapsed = int((perf_counter() - start) * 1000)
        def _news_events():
            yield f"data: {_json.dumps({'type': 'status', 'stage': 'searching', 'message': 'News Agent is checking live sources...'})}\n\n"
            yield f"data: {_json.dumps({'type': 'sources', 'sources': news_sources, 'confidence': 'high', 'images': []})}\n\n"
            yield f"data: {_json.dumps({'type': 'token', 'content': news_reply})}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'confidence': 'high', 'sources': news_sources, 'images': [], 'suggestions': ['Explain headline 1 simply', 'Show only India-related updates', 'Give a timeline'], 'latency_ms': elapsed, 'metadata': metadata})}\n\n"
        return StreamingResponse(_news_events(), media_type="text/event-stream")

    weather = weather_answer(cleaned_query, target_language, payload.latitude, payload.longitude)
    if weather:
        weather_reply, weather_sources, weather_meta = weather
        metadata = {"routing": {"selected_route": "weather_agent_stream", "reason": "free_open_meteo", "score": 1.0}, "agent_plan": agent_plan, **weather_meta}
        save_message(payload.user_id, payload.session_id, "assistant", weather_reply, confidence="high", sources=weather_sources, metadata=metadata)
        elapsed = int((perf_counter() - start) * 1000)
        def _weather_events():
            yield f"data: {_json.dumps({'type': 'status', 'stage': 'searching', 'message': 'Weather Agent is checking live forecast...'})}\n\n"
            yield f"data: {_json.dumps({'type': 'sources', 'sources': weather_sources, 'confidence': 'high', 'images': []})}\n\n"
            yield f"data: {_json.dumps({'type': 'token', 'content': weather_reply})}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'confidence': 'high', 'sources': weather_sources, 'images': [], 'suggestions': ['Show hourly rain chances', 'What about tomorrow?'], 'latency_ms': elapsed, 'metadata': metadata})}\n\n"
        return StreamingResponse(_weather_events(), media_type="text/event-stream")

    # Real-time queries (time, date, day) — instant from system clock
    if _is_realtime_query(cleaned_query):
        realtime_reply = _realtime_response(cleaned_query, target_language)
        save_message(payload.user_id, payload.session_id, "assistant", realtime_reply)
        elapsed = int((perf_counter() - start) * 1000)

        def _realtime_events():
            yield f"data: {_json.dumps({'type': 'thinking', 'content': 'Real-time query detected — using system clock.'})}\n\n"
            yield f"data: {_json.dumps({'type': 'thinking_done', 'content': 'Real-time query detected — using system clock.'})}\n\n"
            yield f"data: {_json.dumps({'type': 'token', 'content': realtime_reply})}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'confidence': 'high', 'sources': [], 'images': [], 'suggestions': [], 'latency_ms': elapsed, 'metadata': {'routing': {'selected_route': 'realtime_shortcut_stream'}}})}\n\n"

        return StreamingResponse(_realtime_events(), media_type="text/event-stream")

    if _is_direct_image_request(cleaned_query):
        image_query = _image_search_query(cleaned_query)
        raw_images = search_images(image_query, max_results=6)
        image_reply = _image_answer(cleaned_query, len(raw_images), target_language)
        image_sources = [
            {"title": img.get("title") or img.get("source_url") or "Image source", "url": img.get("source_url") or img.get("image_url") or ""}
            for img in raw_images
            if img.get("source_url") or img.get("image_url")
        ]
        metadata = {
            "routing": {"selected_route": "image_search_stream", "reason": "direct_image_request", "score": 1.0},
            "agent_plan": manager_plan(cleaned_query, use_web=True, deep_think=False, code_mode=False),
            **_image_response_metadata(),
        }
        save_message(payload.user_id, payload.session_id, "assistant", image_reply, confidence="high" if raw_images else "low", sources=image_sources, metadata=metadata)
        elapsed = int((perf_counter() - start) * 1000)

        def _image_events():
            yield f"data: {_json.dumps({'type': 'status', 'stage': 'searching', 'message': 'Finding image cards...'})}\n\n"
            yield f"data: {_json.dumps({'type': 'sources', 'sources': image_sources, 'confidence': 'high' if raw_images else 'low', 'images': raw_images})}\n\n"
            yield f"data: {_json.dumps({'type': 'token', 'content': image_reply})}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'confidence': 'high' if raw_images else 'low', 'sources': image_sources, 'images': raw_images, 'suggestions': ['Show more images', 'Create an image generation prompt', 'Find official sources'], 'latency_ms': elapsed, 'metadata': metadata})}\n\n"

        return StreamingResponse(_image_events(), media_type="text/event-stream")

    greeting_reply = _greeting_response(cleaned_query, target_language)
    if greeting_reply:
        save_message(payload.user_id, payload.session_id, "assistant", greeting_reply)
        elapsed = int((perf_counter() - start) * 1000)

        def _greeting_events():
            yield f"data: {_json.dumps({'type': 'token', 'content': greeting_reply})}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'confidence': 'high', 'sources': [], 'images': [], 'suggestions': [], 'thinking': '', 'latency_ms': elapsed, 'metadata': {'routing': {'selected_route': 'greeting_shortcut_stream', 'reason': 'simple_greeting_or_intro', 'score': 1.0}}})}\n\n"

        return StreamingResponse(_greeting_events(), media_type="text/event-stream")

    instant_mode = (not payload.use_web) and (not payload.deep_think)
    if instant_mode:
        chosen_model = payload.model or _choose_internal_model(cleaned_query, False)
        fast_answer = credon_answer(cleaned_query, sources=None, target_language=target_language)
        if not fast_answer:
            fast_answer = generate_grounded_answer(
                working_query,
                [],
                target_language,
                model=chosen_model,
                thinking="",
            )
        answer_text = _clean_answer(fast_answer)
        suggestions = extract_suggestions(answer_text)
        answer_text = trim_answer_suggestions(answer_text)
        save_message(payload.user_id, payload.session_id, "assistant", answer_text)
        learn_from_conversation(cleaned_query, answer_text, "high")
        elapsed = int((perf_counter() - start) * 1000)

        def _instant_events():
            yield f"data: {_json.dumps({'type': 'token', 'content': answer_text})}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'confidence': 'high', 'sources': [], 'images': [], 'suggestions': suggestions, 'latency_ms': elapsed, 'metadata': {'routing': {'selected_route': 'instant_mode_stream', 'reason': 'web_off_deepthink_off', 'score': 1.0}}})}\n\n"

        return StreamingResponse(_instant_events(), media_type="text/event-stream")

    has_model = _has_available_model()

    quick_knowledge = retrieve_knowledge_context(payload.user_id, working_query, top_k=3) if not _is_greeting(cleaned_query) else []
    if quick_knowledge:
        quick_knowledge, _ = _evaluate_sources(cleaned_query, quick_knowledge, keep=3)
    quick_score, quick_reason, quick_diagnostics = _routing_score(
        working_query,
        quick_knowledge,
        has_model=has_model,
        use_web=payload.use_web,
    )
    quick_route = _should_try_brain_first(cleaned_query) and quick_score >= 0.78
    if quick_route:
        _log_routing("credon_answer_stream", quick_reason, quick_score, quick_diagnostics)
        brain_answer = credon_answer(working_query, sources=quick_knowledge or None, target_language=target_language)
        if brain_answer:
            thinking = credon_think(working_query, sources=quick_knowledge or None) if payload.deep_think else ""
            answer_text = _clean_answer(brain_answer)
            source_payload = [{"title": s["title"], "url": s["url"]} for s in quick_knowledge]
            save_message(
                payload.user_id, payload.session_id, "assistant", answer_text,
                thinking=thinking, confidence="high",
                sources=source_payload,
            )
            learn_from_conversation(cleaned_query, answer_text, "high")
            elapsed = int((perf_counter() - start) * 1000)

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

    retrieval_allowed = not _is_greeting(cleaned_query)
    master_mode_active = payload.use_web and payload.deep_think and code_mode_active
    use_web = (
        payload.use_web
        and retrieval_allowed
        and not is_personal_query(cleaned_query)
        and not followup_mode
        and not _is_pdf_reference_query(cleaned_query)
        and (not code_mode_active or master_mode_active)
    )
    chosen_model = payload.model or _choose_internal_model(cleaned_query, use_web)

    # Full pipeline with thinking stages
    def _stream_events() -> Iterator[str]:
        try:
            yield from _stream_events_inner()
        except Exception as exc:
            # RESILIENCE: If anything crashes, always return a Brain answer
            logger.error("Stream pipeline error: %s", exc, exc_info=True)
            brain_recovery = credon_answer(cleaned_query, sources=None, target_language=target_language)
            if not brain_recovery:
                brain_recovery = (
                    f"I'm working on answering **\"{cleaned_query}\"**. "
                    "Let me try a different approach — rephrase your question or try again in a moment.\n\n"
                    "**You might also want to know:**\n"
                    "- Can you break this question into parts?\n"
                    "- Try a more specific version?\n"
                    "- Ask about a related topic?"
                )
            save_message(payload.user_id, payload.session_id, "assistant", brain_recovery)
            elapsed = int((perf_counter() - start) * 1000)
            yield f"data: {_json.dumps({'type': 'token', 'content': brain_recovery})}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'confidence': 'medium', 'sources': [], 'images': [], 'latency_ms': elapsed, 'metadata': {'routing': {'selected_route': 'error_recovery_stream', 'reason': str(exc)[:120]}}})}\n\n"

    def _stream_events_inner():
        results = []
        knowledge_results = retrieve_knowledge_context(payload.user_id, working_query, top_k=4 if payload.deep_think else 3) if retrieval_allowed else []
        if use_web:
            yield f"data: {_json.dumps({'type': 'status', 'stage': 'searching', 'message': 'Searching knowledge sources...'})}\n\n"
            web_results = retrieve_sources(
                working_query,
                max_results=_web_result_budget(cleaned_query, deep_think=payload.deep_think),
            )
            merged_results = _merge_sources(knowledge_results, web_results)
            results, eval_diag = _evaluate_sources(cleaned_query, merged_results)
        else:
            results, eval_diag = _evaluate_sources(cleaned_query, knowledge_results)

        sources_payload = [{"title": s["title"], "url": s["url"]} for s in results]

        if len(results) >= 4:
            confidence = "high"
        elif len(results) >= 2:
            confidence = "medium"
        else:
            confidence = "low"

        if not has_model:
            brain_answer = credon_answer(working_query, sources=results or None, target_language=target_language)
            if brain_answer:
                answer_text = _clean_answer(brain_answer)
                thinking = credon_think(working_query, sources=results or None) if payload.deep_think else ""
                suggestions = extract_suggestions(answer_text)
                answer_text = trim_answer_suggestions(answer_text)
                save_message(
                    payload.user_id, payload.session_id, "assistant", answer_text,
                    thinking=thinking, confidence=confidence,
                    sources=sources_payload,
                )
                learn_from_conversation(cleaned_query, answer_text, confidence)
                elapsed = int((perf_counter() - start) * 1000)
                if thinking:
                    yield f"data: {_json.dumps({'type': 'thinking', 'content': thinking})}\n\n"
                yield f"data: {_json.dumps({'type': 'sources', 'sources': sources_payload, 'confidence': confidence, 'images': []})}\n\n"
                yield f"data: {_json.dumps({'type': 'token', 'content': answer_text})}\n\n"
                yield f"data: {_json.dumps({'type': 'done', 'latency_ms': elapsed, 'suggestions': suggestions, 'metadata': {'routing': {'selected_route': 'credon_answer_fallback_stream', 'score': round(quick_score, 4), 'reason': 'model_unavailable'}, 'evaluator': eval_diag}})}\n\n"
                return

        # Stage 2: Thinking / Evaluating — only for complex queries
        should_think = payload.deep_think and (len(results) >= 2 or _is_math_query(cleaned_query) or len(cleaned_query.split()) > 8)
        if should_think:
            yield f"data: {_json.dumps({'type': 'status', 'stage': 'thinking', 'message': 'Analyzing sources and reasoning...'})}\n\n"

            thinking_tokens: list[str] = []
            for token in think_about_sources_stream(working_query, results, model=chosen_model):
                thinking_tokens.append(token)
                yield f"data: {_json.dumps({'type': 'thinking_token', 'content': token})}\n\n"

            thinking = "".join(thinking_tokens)
            if thinking:
                yield f"data: {_json.dumps({'type': 'thinking_done', 'content': thinking})}\n\n"
        else:
            thinking = ""

        # Image search for visual queries
        images_payload: list[dict[str, Any]] = []
        if use_web and _is_visual_query_local(cleaned_query):
            raw_images = search_images(cleaned_query, max_results=3)
            images_payload = raw_images

        # Send sources + images early
        yield f"data: {_json.dumps({'type': 'sources', 'sources': sources_payload, 'confidence': confidence, 'images': images_payload, 'metadata': _image_response_metadata() if images_payload else {}})}\n\n"

        # Stage 3: Generating
        yield f"data: {_json.dumps({'type': 'status', 'stage': 'generating', 'message': 'Composing response...'})}\n\n"

        full_answer: list[str] = []
        token_budget_sec = 15 if not payload.deep_think else 45
        budget_started = perf_counter()
        for token in generate_answer_stream(
            working_query, results, target_language,
            model=chosen_model, thinking=thinking,
        ):
            full_answer.append(token)
            yield f"data: {_json.dumps({'type': 'token', 'content': token})}\n\n"
            if (perf_counter() - budget_started) >= token_budget_sec and len("".join(full_answer).strip()) >= 120:
                break

        answer_text = _clean_answer("".join(full_answer))

        # If model returned empty/degraded, fall back to Brain
        if not answer_text or len(answer_text.strip()) < 20:
            brain_fallback = credon_answer(cleaned_query, sources=results or None, target_language=target_language)
            if brain_fallback and len(brain_fallback) > len(answer_text or ""):
                answer_text = _clean_answer(brain_fallback)
                yield f"data: {_json.dumps({'type': 'token', 'content': answer_text})}\n\n"

        # Extract suggestions before trimming
        suggestions = extract_suggestions(answer_text)
        answer_text = trim_answer_suggestions(answer_text)

        # Cross-check answer quality
        _, adj_confidence = _apply_cross_check(
            working_query, answer_text, results, thinking, chosen_model, confidence
        )

        save_message(
            payload.user_id, payload.session_id, "assistant", answer_text,
            thinking=thinking, confidence=adj_confidence,
            sources=sources_payload,
            metadata={
                "routing": {"selected_route": "model_generation_stream", "score": round(quick_score, 4), "reason": quick_reason},
                "mode": {"code_mode": code_mode_active, "master_mode": master_mode_active},
                "intent": intent_meta,
                "agent_plan": agent_plan,
                "evaluator": eval_diag,
            },
        )
        learn_from_conversation(cleaned_query, answer_text, adj_confidence)
        _response_cache_set(
            cache_key,
            {
                "answer": answer_text,
                "confidence": adj_confidence,
                "sources": sources_payload,
                "images": images_payload,
                "suggestions": suggestions,
                "thinking": thinking,
            },
        )
        elapsed = int((perf_counter() - start) * 1000)
        done_metadata = {
            'routing': {'selected_route': 'model_generation_stream', 'score': round(quick_score, 4), 'reason': quick_reason},
            'mode': {'code_mode': code_mode_active, 'master_mode': master_mode_active},
            'intent': intent_meta,
            'agent_plan': agent_plan,
            'evaluator': eval_diag,
            **(_image_response_metadata() if images_payload else {}),
        }
        yield f"data: {_json.dumps({'type': 'done', 'latency_ms': elapsed, 'confidence': adj_confidence, 'suggestions': suggestions, 'metadata': done_metadata})}\n\n"

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
    messages: list[ChatMessage] = []
    for item in transcript:
        raw_sources_any = item.get("sources")
        raw_sources: list[dict[str, Any]] = []
        if isinstance(raw_sources_any, list):
            source_items = cast(list[object], raw_sources_any)
            for source_item_obj in source_items:
                if isinstance(source_item_obj, dict):
                    raw_sources.append(cast(dict[str, Any], source_item_obj))
        sources = [
            Source(title=str(source_item.get("title", "")), url=str(source_item.get("url", "")))
            for source_item in raw_sources
            if "title" in source_item and "url" in source_item
        ]
        raw_meta = item.get("metadata")
        meta: dict[str, Any] = cast(dict[str, Any], raw_meta) if isinstance(raw_meta, dict) else {}
        messages.append(ChatMessage(
            role=cast(Literal["user", "assistant"], item.get("role", "assistant")),
            text=item.get("text", ""),
            created_at=item.get("created_at", ""),
            thinking=item.get("thinking", ""),
            confidence=item.get("confidence", ""),
            sources=sources,
            metadata=meta,
        ))
    return ChatTranscriptResponse(user_id=user_id, session_id=session_id, messages=messages)


@router.patch("/chats/{user_id}/{session_id}")
def rename_user_session(user_id: str, session_id: str, payload: dict[str, str]) -> dict[str, bool]:
    rename_session(user_id, session_id, (payload.get("preview") or "New conversation").strip()[:120])
    return {"ok": True}


@router.delete("/chats/{user_id}/{session_id}")
def delete_user_session(user_id: str, session_id: str) -> dict[str, bool]:
    delete_session(user_id, session_id)
    return {"ok": True}


@router.post("/feedback")
def submit_feedback(payload: FeedbackRequest):
    """Accept feedback and use it for self-learning.
    Downvotes remove bad answers from the learned DB.
    Upvotes boost answer confidence."""
    print(
        "[Credon Feedback]",
        {
            "user_id": payload.user_id,
            "session_id": payload.session_id,
            "vote": payload.vote,
            "reason": payload.reason,
            "category": payload.category,
            "preview": payload.message_text[:120],
        },
    )
    try:
        from app.services.credon_brain import learned_qa_ref, save_learned_ref, lock_ref

        question_hint = ""
        transcript = get_transcript(payload.user_id, payload.session_id)
        target_answer = payload.message_text.strip()
        target_norm = re.sub(r"\s+", " ", target_answer.lower())
        for idx in range(len(transcript) - 1, -1, -1):
            item = transcript[idx]
            if str(item.get("role", "")).lower() != "assistant":
                continue
            item_text = str(item.get("text", "")).strip()
            item_norm = re.sub(r"\s+", " ", item_text.lower())
            if not item_norm:
                continue
            if item_norm == target_norm or item_norm[:120] == target_norm[:120]:
                for j in range(idx - 1, -1, -1):
                    prev = transcript[j]
                    if str(prev.get("role", "")).lower() == "user":
                        question_hint = str(prev.get("text", "")).strip()
                        break
                break

        if question_hint:
            register_feedback(
                question=question_hint,
                answer=payload.message_text,
                vote=payload.vote,
                category=payload.category,
                reason=payload.reason,
            )

        _qa_list = learned_qa_ref()
        _save_fn = save_learned_ref()
        answer_preview = payload.message_text[:100].lower().strip()
        with lock_ref:
            for entry in _qa_list:
                stored = entry.get("answer", "")[:100].lower().strip()
                if stored == answer_preview:
                    if payload.vote == "down":
                        _qa_list.remove(entry)
                        _save_fn()
                        print("[Credon Feedback] Removed bad answer from learned DB")
                    elif payload.vote == "up":
                        entry["confidence"] = "high"
                        _save_fn()
                        print("[Credon Feedback] Boosted answer confidence to 'high'")
                    break
    except Exception as exc:
        print(f"[Credon Feedback] Error updating learned DB: {exc}")

    return {"ok": True}


@router.post("/notifications/token")
def register_notification_token(payload: NotificationTokenRequest) -> dict[str, object]:
    """Register/update a user's push notification token."""
    token = payload.token.strip()
    save_user_push_token(payload.user_id, token, payload.platform)
    return {
        "ok": True,
        "user_id": payload.user_id,
        "platform": payload.platform,
        "token_preview": f"{token[:12]}...{token[-8:]}",
    }


@router.post("/notifications/test")
def send_notification_test(payload: NotificationTestRequest) -> dict[str, object]:
    """Send a test push notification to all registered tokens for a user."""
    result = send_test_push(payload.user_id, payload.title.strip(), payload.body.strip())
    return cast(dict[str, object], result)
