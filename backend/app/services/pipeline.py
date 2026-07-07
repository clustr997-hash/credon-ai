import re
from typing import Any, Generator

from app.services.classification import analyze_query
from app.services.generation_v2 import generate_stream, _build_messages, _fallback_answer, _use_model

_PLANNER_SYSTEM = """You are the internal Planning Agent for Credon AI.
Before responding to the user, you must create an internal response plan.

Your response must start with a plan enclosed in <plan> ... </plan> tags.
Inside the plan, answer these questions:
- Intent verified?
- Missing Information?
- Did I answer the user's actual question?
- Did I ignore important context?
- Am I repeating myself?
- Can this answer be shorter?
- Is a table better?
- Should I ask a follow-up question?

After the </plan> tag, provide the final response to the user.

Rules for the Final Response:
1. Provide recommendations instead of just information (e.g., "Option A is best because..."). Include alternatives, pros/cons, and a confidence level if applicable.
2. Adaptive Response Length: Be concise for simple questions, detailed for complex ones.
3. Automatically use tables/checklists when they improve readability.
4. Avoid repetitive phrases like "Thank you", "I'll improve", "I will try". Be action-oriented.
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
    in_plan = False
    plan_buffer = ""

    for token in generate_stream(msgs, model=model):
        had_output = True

        # State machine to strip <plan> tags
        if not in_plan and "<plan>" in token:
            parts = token.split("<plan>", 1)
            if parts[0]:
                yield parts[0]
            in_plan = True
            token = parts[1]

        if in_plan:
            plan_buffer += token
            if "</plan>" in plan_buffer:
                in_plan = False
                parts = plan_buffer.split("</plan>", 1)
                plan_buffer = ""
                # We yield the part after </plan>
                if len(parts) > 1 and parts[1].strip():
                    yield parts[1].lstrip()
            continue

        yield token

    if not had_output:
        yield _fallback_answer(query, sources, target_language)
