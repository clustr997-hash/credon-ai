import re
from typing import Any, Generator

from app.services.classification import analyze_query
from app.services.generation_v2 import generate_stream, _build_messages, _fallback_answer, _use_model

_PLANNER_SYSTEM = """You are Credon AI's internal Planning Agent.
Use this checklist silently before answering, but NEVER print it, NEVER use <plan> tags, and NEVER reveal internal analysis.

Silent checklist:
- Verify the user's real intent, including typos and conversational shorthand.
- Use previous chat context when the user says this/that/it or asks a short follow-up.
- Check whether important information is missing; ask only when truly required.
- Avoid repeating yourself and keep simple questions short.
- Use a table/checklist only when it improves readability.

Rules for the visible final response:
1. Answer the user's actual question directly.
2. Provide recommendations instead of just information when useful.
3. Adapt length: concise for simple chat, detailed for complex tasks.
4. Do not expose chain-of-thought, planner notes, XML tags, or debugging text.
5. Avoid repetitive phrases like "Thank you", "I'll improve", or "I will try". Be action-oriented.
"""

def build_pipeline_messages(query: str, sources: list[dict[str, Any]], target_language: str, analysis: dict[str, Any], context: str = "") -> list[dict[str, str]]:
    intent = analysis.get("intent", "General")
    mode = analysis.get("mode", "Casual chat")
    ref_content = analysis.get("referenced_content", "")

    # Base system prompt
    base_msgs = _build_messages(query, sources, target_language)
    system_msg = base_msgs[0]['content']

    # Inject planner/critic instructions
    system_msg += f"\n\n{_PLANNER_SYSTEM}"

    # Inject context awareness
    if ref_content or context:
        system_msg += f"\n\nContext the user is referring to:\n{ref_content or context}\nEnsure your answer addresses this specific context."

    system_msg += f"\n\nCurrent Intent: {intent}\nCurrent Mode: {mode}"

    return [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": base_msgs[1]['content']}
    ]

def generate_pipeline_stream(
    query: str,
    sources: list[dict[str, Any]],
    target_language: str,
    transcript: list[dict[str, str]],
    model: str | None = None,
    context: str = ""
) -> Generator[str, None, None]:
    if not _use_model():
        yield _fallback_answer(query, sources, target_language)
        return

    # Step 1: Intent & Context Detection
    analysis = analyze_query(query, transcript, model=model)
    print(f"[Pipeline] Analysis: {analysis}")

    # Step 2 & 3: Plan & Generate
    msgs = build_pipeline_messages(query, sources, target_language, analysis, context)

    had_output = False
    buffer = ""
    released = False

    for token in generate_stream(msgs, model=model):
        had_output = True
        buffer += token

        # Some models still emit planner tags despite instructions, sometimes split across tokens.
        # Hold a small prefix until we know whether a hidden plan is present, then only stream
        # the user-visible answer.
        if not released:
            lower = buffer.lower()
            if "</plan>" in lower:
                end = lower.index("</plan>") + len("</plan>")
                visible = buffer[end:].lstrip()
                buffer = ""
                released = True
                if visible:
                    yield visible
                continue
            if "<plan" in lower and len(buffer) < 6000:
                continue
            if len(buffer) < 64:
                continue
            released = True

        if released and buffer:
            # Defense-in-depth for inline/late planner leakage.
            cleaned = re.sub(r"(?is)<plan\b[^>]*>.*?</plan>", "", buffer)
            cleaned = re.sub(r"(?is)</?plan\b[^>]*>", "", cleaned)
            if cleaned:
                yield cleaned
            buffer = ""

    if not had_output:
        yield _fallback_answer(query, sources, target_language)
    elif not released and buffer:
        cleaned = re.sub(r"(?is)<plan\b[^>]*>.*?</plan>", "", buffer).strip()
        if cleaned:
            yield cleaned
