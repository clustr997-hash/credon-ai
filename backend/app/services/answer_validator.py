"""Answer validation and cross-checking module.

Multi-parameter cross-check before presenting answer to user:
1. Relevancy check — does the answer actually address the question?
2. Source consistency — does the answer align with provided sources?
3. Hallucination detection — flag unsupported claims
4. Confidence calibration — adjust confidence based on evidence quality
5. Length appropriateness — simple questions get simple answers
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher  # noqa: F401 – kept for future use
from typing import Any


def _word_overlap(text_a: str, text_b: str) -> float:
    """Jaccard similarity between two texts."""
    words_a = set(re.findall(r"\w+", text_a.lower()))
    words_b = set(re.findall(r"\w+", text_b.lower()))
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union)


def _source_coverage(answer: str, sources: list[dict[str, Any]]) -> float:
    """How much of the answer is grounded in sources (0-1)."""
    if not sources:
        return 0.0
    source_text = " ".join(
        s.get("snippet", "") + " " + s.get("title", "") for s in sources
    ).lower()
    answer_sentences = [s.strip() for s in re.split(r"[.!?\n]", answer) if len(s.strip()) > 15]
    if not answer_sentences:
        return 0.5
    grounded = sum(1 for s in answer_sentences if _word_overlap(s, source_text) > 0.15)
    return grounded / len(answer_sentences)


def _detect_hallucination_markers(answer: str) -> list[str]:
    """Detect phrases that may indicate hallucination."""
    markers: list[str] = []
    hallucination_patterns = [
        (r"as of \d{4}", "Contains specific date claims — verify"),
        (r"\b\d{1,3}(\.\d+)?%\b", "Contains percentage claims — verify with sources"),
        (r"according to .{5,50}(said|stated|reported)", "Attribution claim — check source"),
    ]
    for pattern, msg in hallucination_patterns:
        if re.search(pattern, answer, re.IGNORECASE):
            markers.append(msg)
    return markers


def _is_answer_relevant(query: str, answer: str) -> float:
    """Score 0-1 for how relevant the answer is to the query."""
    query_keywords = set(re.findall(r"\w{3,}", query.lower()))
    answer_lower = answer.lower()
    if not query_keywords:
        return 0.5
    hits = sum(1 for kw in query_keywords if kw in answer_lower)
    return min(1.0, hits / max(len(query_keywords), 1))


def _appropriate_length(query: str, answer: str) -> bool:
    """Check if answer length matches query complexity."""
    query_words = len(query.split())
    answer_words = len(answer.split())
    # Simple question (<=5 words) should get concise answer
    if query_words <= 5 and answer_words > 500:
        return False
    # Very long query probably needs detailed answer
    if query_words >= 20 and answer_words < 30:
        return False
    return True


def validate_answer(
    query: str,
    answer: str,
    sources: list[dict[str, Any]],
    thinking: str = "",
    model_used: str = "",
) -> dict[str, Any]:
    """Cross-check answer quality and return validation report.

    Returns:
        {
            "valid": bool,
            "confidence": "low" | "medium" | "high",
            "relevancy_score": float,
            "source_coverage": float,
            "hallucination_flags": list[str],
            "length_ok": bool,
            "diagnostics": {
                "model": str,
                "source_count": int,
                "thinking_present": bool,
            }
        }
    """
    relevancy = _is_answer_relevant(query, answer)
    coverage = _source_coverage(answer, sources)
    hallucination_flags = _detect_hallucination_markers(answer)
    length_ok = _appropriate_length(query, answer)

    # Confidence calibration
    if relevancy >= 0.5 and coverage >= 0.4 and not hallucination_flags:
        confidence = "high"
    elif relevancy >= 0.3 and (coverage >= 0.2 or not sources):
        confidence = "medium"
    else:
        confidence = "low"

    # Override: if plenty of sources and good relevancy, always high
    if len(sources) >= 4 and relevancy >= 0.4:
        confidence = "high"

    valid = relevancy >= 0.2 and (not hallucination_flags or coverage >= 0.3)

    return {
        "valid": valid,
        "confidence": confidence,
        "relevancy_score": round(relevancy, 3),
        "source_coverage": round(coverage, 3),
        "hallucination_flags": hallucination_flags,
        "length_ok": length_ok,
        "diagnostics": {
            "model": model_used,
            "source_count": len(sources),
            "thinking_present": bool(thinking),
        },
    }


def extract_suggestions(answer: str) -> list[str]:
    """Extract follow-up suggestions from the answer text.

    Looks for patterns like:
    - **You might also want to know:**
    - numbered or bullet list items after that heading
    """
    suggestions: list[str] = []
    lines = answer.split("\n")
    in_section = False

    for line in lines:
        if re.search(
            r"want to explore|follow.?up|dig deeper|learn more|also want to know|might also|you might want",
            line,
            re.IGNORECASE,
        ):
            in_section = True
            continue
        if in_section:
            match = re.match(r"^(?:\d+\.|[-*])\s*\**(.+?)\**\s*$", line.strip())
            if match:
                text = match.group(1).replace("**", "").strip()
                # Remove trailing question marks duplicated
                text = text.rstrip("?") + "?"
                if len(text) > 5:
                    suggestions.append(text)
            elif line.strip() == "" and suggestions:
                break

    return suggestions[:3]


def trim_answer_suggestions(answer: str) -> str:
    """Remove the 'You might also want to know' section from the answer body.

    We extract suggestions separately and send them as structured data,
    so they don't need to appear in the markdown text."""
    lines = answer.split("\n")
    cut_idx = len(lines)

    for i, line in enumerate(lines):
        if re.search(
            r"\*?\*?you might also want to know\*?\*?|"
            r"\*?\*?you might want to know\*?\*?|"
            r"\*?\*?follow.?up suggestions?\*?\*?",
            line,
            re.IGNORECASE,
        ):
            cut_idx = i
            break

    trimmed = "\n".join(lines[:cut_idx]).rstrip()
    return trimmed if trimmed else answer
