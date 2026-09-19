"""Self-checking verifier: PLAN -> PREDICT -> ACT -> OBSERVE -> COMPARE -> REPLAN.

Closer to control theory / MPC than chatbot generation. Each action's
result is compared to the world-model prediction; on mismatch we
diagnose and re-plan instead of continuing anyway.
"""
from __future__ import annotations
from typing import Any
from app.cognitive import world_model


def verify_step(query: str, answer: str, sources: list) -> dict[str, Any]:
    pred = world_model.predict(query)
    surprise = world_model.surprise_score(pred, answer)
    diagnosis = world_model.diagnose(pred["expected_shape"], answer)
    needs_replan = surprise > 0.72 or len(answer.strip()) < 40
    confidence = "high" if surprise < 0.35 and len(sources) >= 2 else (
        "medium" if surprise < 0.6 else "low")
    return {"expected": pred["expected_shape"], "surprise": surprise,
            "diagnosis": diagnosis, "needs_replan": needs_replan,
            "confidence": confidence}


def replan_note(query: str, verification: dict) -> str:
    if not verification.get("needs_replan"):
        return ""
    return (f"[replan triggered: surprise={verification['surprise']}] "
            f"{verification['diagnosis']}. Strategy: narrow scope, add one retrieval pass, "
            f"answer concisely with what is verified.")
