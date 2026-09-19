"""Hierarchical planner: goal -> sub-steps -> tool policy.

One bad action poisons downstream steps (error accumulation), so each
step carries an independent verify hook used by verifier.py.
"""
from __future__ import annotations
import re
from typing import Any


def decompose(goal: str, intent: str, deep: bool = True) -> list[dict[str, Any]]:
    g = goal.strip()
    q = g.lower()
    steps: list[dict[str, Any]] = []
    sid = 0

    def add(title: str, tool: str, detail: str = "") -> None:
        nonlocal sid
        sid += 1
        steps.append({"id": sid, "title": title, "tool": tool,
                      "detail": detail, "status": "pending"})

    if intent == "greeting":
        add("Acknowledge + orient", "answer")
        return steps
    if intent in ("teach", "feedback"):
        add("Extract durable fact/preference", "learn")
        add("Confirm what was learned", "answer")
        return steps
    if any(w in q for w in ["prepare", "presentation", "project", "tomorrow", "deploy", "build"]):
        # long-horizon demo plan (the fragile case from the doc)
        add("Inspect project state", "knowledge")
        add("Find missing pieces / risks", "reason")
        add("Draft fix or outline", "generate")
        add("Verify with checks", "verify")
        add("Compose report + next actions", "answer")
        return steps
    if any(w in q for w in ["code", "python", "bug", "function", "api", "error"]):
        add("Recall user coding style + episodic fixes", "memory")
        add("Retrieve relevant knowledge/web", "retrieve")
        add("Generate runnable code", "generate")
        add("Self-check code (syntax + intent)", "verify")
        add("Answer with run steps", "answer")
        return steps
    # default research loop
    add("Recall memory (episodic + semantic + user)", "memory")
    add("Retrieve knowledge + web", "retrieve")
    if deep:
        add("Reason over sources", "reason")
    add("Generate grounded answer", "generate")
    add("Self-check (expected vs actual)", "verify")
    return steps


def tool_policy(step_tool: str) -> str:
    return {"answer": "core reasoner", "memory": "memory system",
            "retrieve": "world+knowledge", "reason": "core reasoner",
            "generate": "core reasoner", "verify": "self-check loop",
            "knowledge": "knowledge store", "learn": "continual learner"}.get(step_tool, "core reasoner")


def complexity(goal: str) -> dict[str, Any]:
    words = len(goal.split())
    markers = len(re.findall(r"\b(and|then|after|prepare|compare|analyze|build|deploy|fix|create)\b", goal.lower()))
    n = min(1.0, words / 30 * 0.6 + markers / 4 * 0.4)
    return {"words": words, "subtask_markers": markers, "long_horizon": n > 0.45, "score": round(n, 3)}
