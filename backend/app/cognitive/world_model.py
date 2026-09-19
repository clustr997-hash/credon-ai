"""World model + surprise metric (predict -> observe -> compare).

Tiny, dependency-free stand-in for a learned world model like V-JEPA:
predicts an expected answer shape, then scores surprise as
1 - overlap(expected_keywords, actual). High surprise drives learning.
"""
from __future__ import annotations
import re


def predict(query: str, context: str = "") -> dict:
    words = set(re.findall(r"\w+", query.lower()))
    q = query.lower()
    if words & {"hello", "hi", "hey", "namaste"} or q.strip() in {"hi", "hey", "hello"}:
        expected = "greeting acknowledgment + offer help"
        keywords = {"hello", "help", "credon", "assist"}
    elif words & {"code", "python", "function", "bug", "error", "api", "typescript", "javascript"}:
        expected = "code block + concise run steps"
        keywords = {"code", "example", "run", "output", "step"}
    elif any(w in q for w in ["prepare", "presentation", "project", "tomorrow", "plan"]):
        expected = "multi-step plan with checklist"
        keywords = {"step", "plan", "checklist", "first", "next", "test", "slide"}
    elif "?" in query or q.startswith(("what", "why", "how", "explain", "when", "who")):
        expected = "structured explanation + sources + follow-ups"
        keywords = set(re.findall(r"\w{4,}", q)[:8]) | {"because", "example", "steps"}
    else:
        expected = "direct answer + brief reasoning"
        keywords = set(re.findall(r"\w{4,}", q)[:8])
    return {"expected_shape": expected, "keywords": keywords}


def surprise_score(prediction: dict, actual_answer: str) -> float:
    kw = prediction.get("keywords", set())
    if not kw:
        return 0.3
    awords = set(re.findall(r"\w{3,}", actual_answer.lower()))
    overlap = len({w.lower() for w in kw} & awords) / max(len(kw), 1)
    length = len(actual_answer.strip())
    length_penalty = 0.25 if length < 40 else 0.0
    noise = len(re.findall(r"[^a-zA-Z0-9\s\.,:\-\(\)\[\]/]", actual_answer)) / max(length, 1)
    return round(max(0.0, min(1.0, (1.0 - overlap) * 0.8 + length_penalty + min(noise, 0.15))), 3)


def diagnose(expected: str, actual: str) -> str:
    if len(actual.strip()) < 40:
        return "answer too thin vs prediction — likely retrieval or generation miss"
    if "sorry" in actual.lower()[:200] or "cannot" in actual.lower()[:200]:
        return "refusal/hedge vs prediction — capability or grounding gap"
    return "shape matches prediction — no replan needed"
