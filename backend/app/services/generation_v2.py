"""Enhanced grounded answer generation with thinking pipeline.

Flow:  search → think (interpret sources) → compose answer → suggest follow-ups.
Supports streaming and sync modes + multi-model selection.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from typing import Any, Generator

from app.services.models import generate_stream, generate_sync

# ── Prompts ──────────────────────────────────────────────────────

def _system_prompt() -> str:
    """Build system prompt with current date/time injected."""
    try:
        import zoneinfo
        ist = zoneinfo.ZoneInfo("Asia/Kolkata")
    except Exception:
        ist = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(timezone.utc).astimezone(ist)
    date_str = now.strftime("%A, %B %d, %Y at %I:%M %p IST")
    return (
        f"You are Credon AI - a knowledgeable, helpful assistant that explains things clearly.\n"
        f"Current date and time: {date_str}\n\n"
        f"Core Rules:\n"
        f"1. Answer from provided sources when available\n"
        f"2. For math/code questions, use your knowledge confidently\n"
        f"3. Use Markdown formatting (headings, lists, code blocks)\n"
        f"4. Match answer depth to question complexity:\n"
        f"   - Simple/factual questions: 2-4 sentences\n"
        f"   - 'What is X' questions: 150-300 words with structure (definition, key points, example)\n"
        f"   - 'Explain X' / 'How does X work': 300-600 words with headings, examples, and details\n"
        f"   - Complex/multi-part questions: 500-1000+ words with thorough breakdown\n"
        f"5. If sources are weak, say so and suggest refinement\n"
        f"6. Never mention 'sources say' - just state facts naturally\n"
        f"7. For math: show steps in LaTeX ($...$ or $$...$$)\n"
        f"8. End with 3 follow-up suggestions under '**You might also want to know:**'\n"
        f"9. CRITICAL language rule: Match the user's language exactly.\n"
        f"   - If user writes in English → respond in English\n"
        f"   - If user writes in Hinglish (Hindi+English in Latin script) → respond in Hinglish\n"
        f"   - If user explicitly asks for Hinglish/Hindi → respond in Hinglish\n"
        f"   - If user explicitly asks for English → respond in English\n"
        f"10. For simple questions (greetings, yes/no), give SHORT answers (1-3 sentences)\n"
        f"11. For complex topics, provide thorough explanations with examples, diagrams in text, and step-by-step breakdowns\n"
        f"12. Prefer direct answers by default. Do NOT add a 'Main Points' or 'Key points' section unless user explicitly asks for summary/bullets/MCQ/true-false format.\n"
        f"13. If code mode is not explicitly requested, explain concepts without code blocks.\n"
        f"14. Never say 'I'm building understanding', 'try enabling web search', or 'I'm continuously learning'\n\n"
        f"Be warm, natural, and direct - like a smart friend explaining things."
    )

_FOLLOWUP_SYSTEM = """\
You are Credon AI. The user is asking a follow-up about a previous answer.

Rules:
1. Use the provided previous answer context as the primary grounding.
2. Respond naturally like a helpful human expert, not like a search engine.
3. If the user asks to simplify, explain in plain language with short examples.
4. Keep language consistent with requested language.
5. Do not hallucinate new facts that are not supported by the provided context.
6. Keep follow-up replies direct. Do not add "Main Points"/"Key points" wrappers unless asked.
7. If user asks "tell me more", "go deeper", or similar, expand the same topic (do not switch to web-style generic search answer).
8. If user asks for a "different" answer, keep facts consistent but change explanation angle/examples.
"""

_THINKING_SYSTEM = """\
You are Credon AI's reasoning engine. Think step-by-step before answering, like an expert would.

Your job: Analyze the question and sources, then plan your response strategy.

Think naturally:
- "Hmm, the user wants to know about [X]. Let me see what the sources say..."
- "Looking at Source 1, it mentions [Y]. Source 2 adds [Z]..."
- "These sources seem to agree on [main point]..."
- "I notice [pattern/contradiction/gap]..."
- "So my approach will be: [strategy]..."

For math questions:
- "This is a [type] problem. I'll solve it by [method]..."
- "Let me break this down: step 1..."

For code questions:
- "This asks about [concept]. The best approach is [X] because..."
- "I'll explain using a simple example..."

Keep thinking focused and useful (80-150 words). This is your scratchpad - be honest about what you see.
"""


def _build_messages(
    query: str,
    sources: list[dict[str, Any]],
    target_language: str,
    thinking: str = "",
) -> list[dict[str, str]]:
    lang_hint = (
        "\nReply in natural Hinglish (Hindi+English in Latin script)."
        if target_language == "hinglish"
        else ""
    )
    analysis = f"\n\n--- Internal Analysis ---\n{thinking}" if thinking else ""

    if sources:
        source_block = "\n\n".join(
            f"Source {i+1}: {s['title']}\nURL: {s['url']}\nContent: {s['snippet'][:600]}"
            for i, s in enumerate(sources[:6])
        )
        user_msg = f"Question: {query}{lang_hint}{analysis}\n\n--- Sources ---\n{source_block}"
    else:
        # No sources — math, coding, general knowledge, or casual chat
        user_msg = f"Question: {query}{lang_hint}{analysis}"

    return [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": user_msg},
    ]


def _build_thinking_messages(
    query: str,
    sources: list[dict[str, Any]],
) -> list[dict[str, str]]:
    source_block = "\n".join(
        f"Source {i+1}: {s['title']}: {s['snippet'][:300]}"
        for i, s in enumerate(sources[:6])
    )
    return [
        {"role": "system", "content": _THINKING_SYSTEM},
        {"role": "user", "content": f"Question: {query}\n\nSources:\n{source_block}"},
    ]


# ── Fallback (no model) ─────────────────────────────────────────

def _fallback_answer(
    query: str, sources: list[dict[str, Any]], target_language: str
) -> str:
    """IMPROVED: Never mentions limitations, always provides value."""
    from .credon_brain import credon_answer

    # PRIORITY 1: Try Credon Brain (it has good knowledge!)
    brain_answer = credon_answer(query, sources=sources or None, target_language=target_language)
    if brain_answer and len(brain_answer) > 100:  # Good answer
        return brain_answer

    # PRIORITY 2: If we have sources, synthesize properly
    if sources and len(sources) >= 2:
        return credon_answer(query, sources=sources, target_language=target_language) or _basic_synthesis(query, sources, target_language)

    # PRIORITY 3: If Credon/local generation has no strong context, search DuckDuckGo and synthesize.
    try:
        from .retrieval_v2 import retrieve_sources

        web_sources = retrieve_sources(query, max_results=4)
    except Exception:
        web_sources = []
    if web_sources:
        return credon_answer(query, sources=web_sources, target_language=target_language) or _basic_synthesis(query, web_sources, target_language)

    # PRIORITY 4: Graceful response when strong context is unavailable
    if target_language == "hinglish":
        return (
            f"**'{query}'** ke baare mein:\n\n"
            "Maine internal reasoning use karke best possible response banaya hai, lekin is query ke liye context abhi limited hai.\n\n"
            "Agar aap exact format, scope, ya example de do, main turant refined answer de dunga.\n\n"
            "**Aap yeh try kar sakte ho:**\n"
            "- Is topic ka focused overview\n"
            "- Specific part ka deep explanation\n"
            "- Practical example ya use-case"
        )

    return (
        f"**About '{query}':**\n\n"
        "I used internal fallback reasoning to answer this, but reliable context for this exact request is still limited.\n\n"
        "Share constraints, expected format, or an example and I will provide a sharper answer immediately.\n\n"
        "**You might try:**\n"
        "- A focused overview of one aspect\n"
        "- A step-by-step version\n"
        "- A practical example"
    )


def _basic_synthesis(query: str, sources: list[dict[str, Any]], target_language: str) -> str:
    """Simple synthesis when brain doesn't have a perfect answer."""
    points: list[str] = []
    for s in sources[:3]:
        snippet = (s.get("snippet") or "").strip()[:200]
        if snippet:
            points.append(f"- {snippet}")

    if target_language == "hinglish":
        body = "\n".join(points) if points else "Sources se limited info mili"
        return (
            f"**{query}** ke baare mein jo mila:\n\n{body}\n\n"
            "**Sources:** " + ", ".join(f"[{s['title']}]({s['url']})" for s in sources[:3])
        )

    body = "\n".join(points) if points else "Limited information from sources"
    return (
        f"**About {query}:**\n\n{body}\n\n"
        "**Sources:** " + ", ".join(f"[{s['title']}]({s['url']})" for s in sources[:3])
    )


# ── Public API ───────────────────────────────────────────────────

def _use_model() -> bool:
    generation_enabled = os.getenv("USE_MODEL_GENERATION", "true").lower() == "true"
    if not generation_enabled:
        return False
    local_enabled = os.getenv("USE_LOCAL_MODEL", "true").lower() == "true"
    cloud_enabled = bool(os.getenv("DEEPSEEK_API_KEY", "").strip() or os.getenv("GROQ_API_KEY", "").strip())
    return local_enabled or cloud_enabled


def think_about_sources(
    query: str,
    sources: list[dict[str, Any]],
    model: str | None = None,
) -> str:
    """Run internal reasoning step on the sources.  Returns short analysis text.
    Also works without sources for math/code questions."""
    if not _use_model():
        return ""
    if not sources:
        # Still think for complex queries (math, code) even without sources
        msgs = [
            {"role": "system", "content": _THINKING_SYSTEM},
            {"role": "user", "content": f"Question: {query}\n\nNo web sources available. Analyze using your own knowledge."},
        ]
        return generate_sync(msgs, model=model)
    msgs = _build_thinking_messages(query, sources)
    return generate_sync(msgs, model=model)


def think_about_sources_stream(
    query: str,
    sources: list[dict[str, Any]],
    model: str | None = None,
) -> Generator[str, None, None]:
    """Stream thinking tokens word-by-word for DeepSeek-style live thinking display."""
    if not _use_model():
        return
    if not sources:
        msgs = [
            {"role": "system", "content": _THINKING_SYSTEM},
            {"role": "user", "content": f"Question: {query}\n\nNo web sources available. Analyze using your own knowledge."},
        ]
    else:
        msgs = _build_thinking_messages(query, sources)
    for token in generate_stream(msgs, model=model):
        yield token


def generate_answer_stream(
    query: str,
    sources: list[dict[str, Any]],
    target_language: str,
    model: str | None = None,
    thinking: str = "",
) -> Generator[str, None, None]:
    if not _use_model():
        yield _fallback_answer(query, sources, target_language)
        return
    msgs = _build_messages(query, sources, target_language, thinking=thinking)
    had_output = False
    for token in generate_stream(msgs, model=model):
        had_output = True
        yield token
    if not had_output:
        yield _fallback_answer(query, sources, target_language)


def generate_grounded_answer(
    query: str,
    sources: list[dict[str, Any]],
    target_language: str,
    model: str | None = None,
    thinking: str = "",
) -> str:
    if not _use_model():
        return _fallback_answer(query, sources, target_language)
    msgs = _build_messages(query, sources, target_language, thinking=thinking)

    # Use orchestrator for parallel multi-model queries when available
    try:
        from app.services.orchestrator import orchestrate_sync
        result = orchestrate_sync(
            msgs, query=query,
            sources=sources or None,
            model_hint=model,
        )
    except Exception:
        result = generate_sync(msgs, model=model)

    if not result:
        return _fallback_answer(query, sources, target_language)

    degraded_markers = [
        "analyzing the query and searching my knowledge base",
        "building a comprehensive response based on available information",
        "while i'm building a deeper understanding",
        "i'm building a deeper understanding",
        "i'm continuously learning",
        "try enabling web search",
        "i'm building understanding",
        "here's what i found so far",
        "here's what i can suggest while",
        "based on my analysis of",
        "i don't have enough information yet",
        "still developing my knowledge",
        "currently building my understanding",
    ]
    result_lower = result.lower()
    if any(marker in result_lower for marker in degraded_markers):
        return _fallback_answer(query, sources, target_language)

    return result


def generate_followup_from_context(
    query: str,
    context: str,
    target_language: str,
    model: str | None = None,
) -> str:
    def _context_fallback() -> str:
        chunks = [c.strip() for c in context.replace("\n", " ").split(".") if c.strip()]
        lead = chunks[0] if chunks else context[:220]
        extra = chunks[1:3]
        if target_language == "hinglish":
            extra_block = "\n".join(f"- {x}." for x in extra)
            return (
                f"Simple terms mein: {lead}.\n\n"
                f"Main points:\n"
                f"{extra_block if extra_block else '- Is context ke basis par yahi core point hai.'}"
            )
        extra_block = "\n".join(f"- {x}." for x in extra)
        return (
            f"In simple terms: {lead}.\n\n"
            f"Key points:\n"
            f"{extra_block if extra_block else '- This is the main takeaway from the previous context.'}"
        )

    if not context.strip():
        return _fallback_answer(query, [], target_language)

    lang_hint = (
        "Reply in natural Hinglish (Hindi+English in Latin script)."
        if target_language == "hinglish"
        else "Reply only in English."
    )
    messages = [
        {"role": "system", "content": _FOLLOWUP_SYSTEM},
        {
            "role": "user",
            "content": (
                f"User follow-up: {query}\n\n"
                f"{lang_hint}\n\n"
                f"Previous answer context:\n{context[:2200]}"
            ),
        },
    ]

    result = generate_sync(messages, model=model)
    if not result:
        return _context_fallback()

    degraded_markers = [
        "analyzing the query and searching my knowledge base",
        "building a comprehensive response based on available information",
        "while i'm building a deeper understanding",
        "i'm building a deeper understanding",
        "i'm continuously learning",
        "try enabling web search",
        "here's what i can suggest while",
        "i'm building understanding",
        "here's what i found so far",
        "based on my analysis of",
        "i don't have enough information yet",
        "still developing my knowledge",
        "currently building my understanding",
    ]
    result_lower = result.lower()
    if any(marker in result_lower for marker in degraded_markers):
        return _context_fallback()

    if "User follow-up:" in result:
        return _context_fallback()

    return result
