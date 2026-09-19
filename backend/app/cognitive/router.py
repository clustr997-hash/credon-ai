"""FastAPI router for the Continuous Cognitive Architecture.

Endpoints (all under /api/v1, keep frontend api.ts contract):
  POST /cognitive/think        — full loop, ChatResponse-compatible + cognitive{}
  POST /cognitive/think/stream — SSE stream (data: {...}) for streamSSE()
  GET  /cognitive/state        — public cognitive state for UI viz
  POST /cognitive/teach        — human teaches -> AI evolves (CredonAI core)
  POST /cognitive/feedback     — thumbs up/down -> memory update + reliability
"""
from __future__ import annotations
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.cognitive.schemas import CognitiveThinkRequest, CognitiveFeedbackRequest, TeachRequest
from app.cognitive.engine import get_engine
from app.cognitive import memory as mem

router = APIRouter()


def _chat_payload(result: dict, language: str = "en") -> dict:
    return {"answer": result["answer"], "language": language,
            "confidence": result["confidence"], "sources": result["sources"],
            "images": [], "suggestions": result["suggestions"],
            "thinking": result["thinking"], "latency_ms": result["latency_ms"],
            "metadata": {"routing": {"selected_route": "cognitive_loop",
                                     "reason": "continuous_cognition",
                                     "score": round(1.0 - result.get("surprise", 0.3), 3)},
                         "cognitive": {"plan": result["plan"], "trace": result["trace"],
                                       "complexity": result["complexity"],
                                       "surprise": result["surprise"],
                                       "verification": result["verification"]}}}


@router.post("/cognitive/think")
def cognitive_think(payload: CognitiveThinkRequest) -> dict:
    result = get_engine().think(payload.user_id, payload.session_id, payload.query,
                                deep_think=payload.deep_think, use_web=payload.use_web)
    out = _chat_payload(result)
    out["cognitive_state"] = result["cognitive_state"]
    return out


@router.post("/cognitive/think/stream")
def cognitive_think_stream(payload: CognitiveThinkRequest) -> StreamingResponse:
    engine = get_engine()

    def gen():
        yield f"data: {json.dumps({'type': 'stage', 'stage': 'planning'})}\n\n"
        result = engine.think(payload.user_id, payload.session_id, payload.query,
                              deep_think=payload.deep_think, use_web=payload.use_web)
        for t in result["trace"]:
            yield f"data: {json.dumps({'type': 'agent_step', 'step': t})}\n\n"
        yield f"data: {json.dumps({'type': 'thinking', 'thinking': result['thinking'][:1500]})}\n\n"
        # token-ish chunks so existing frontend streaming renderer works
        ans = result["answer"]
        for i in range(0, len(ans), 400):
            yield f"data: {json.dumps({'type': 'token', 'token': ans[i:i+400]})}\n\n"
        done = _chat_payload(result)
        done["type"] = "done"
        yield f"data: {json.dumps(done)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/cognitive/state")
def cognitive_state(user_id: str) -> dict:
    return {"user_id": user_id, "state": get_engine().get_state(user_id).to_public_dict(),
            "update_rates": mem.UPDATE_RATES}


@router.get("/cognitive/evals")
def cognitive_evals() -> dict:
    """Read-only feed of the latest Phase-0 eval metrics for the /pcl-live page."""
    from pathlib import Path as _Path
    import json as _json
    import time as _time
    eval_dir = _Path(__file__).resolve().parents[2] / "data" / "evals"
    out: dict = {}
    for name in ("long_horizon_curve.json", "memory_metrics.json", "verifier_metrics.json"):
        try:
            p = eval_dir / name
            if p.exists():
                out[name.replace(".json", "")] = {
                    "data": _json.loads(p.read_text(encoding="utf-8")),
                    "mtime": p.stat().st_mtime,
                }
        except Exception as exc:
            out[name.replace(".json", "")] = {"error": str(exc)}
    try:
        from app.cognitive import vectors as _vec
        out["embed_provider"] = _vec.embed_provider()
        out["embed_dim"] = _vec.dim()
    except Exception as exc:
        out["embed_provider"] = f"unknown ({exc})"
    out["served_at"] = _time.time()
    return out


@router.post("/cognitive/teach")
def cognitive_teach(payload: TeachRequest) -> dict:
    mem.semantic_remember(payload.fact, payload.topic)
    mem.save_user_model(payload.user_id, {"past_topics": [payload.topic] if payload.topic else []})
    return {"ok": True, "message": f"Learned and stored: {payload.fact[:160]}",
            "memory": "semantic (slow) + identity (slowest)"}


@router.post("/cognitive/feedback")
def cognitive_feedback(payload: CognitiveFeedbackRequest) -> dict:
    eng = get_engine()
    st = eng.get_state(payload.user_id)
    if payload.vote == "down":
        mem.save_user_model(payload.user_id, {"corrections": [payload.note or payload.query[:200]]})
        mem.semantic_remember(f"Avoid: {payload.answer[:180]} for Q: {payload.query[:120]}", "correction")
        st.self_model.reliability_score = round(max(0.1, st.self_model.reliability_score - 0.02), 3)
        st.self_model.recent_surprises.append(f"thumbs-down: {payload.query[:120]}")
        action = "correction stored in episodic + semantic + user model; reliability dipped (as it should)"
    else:
        mem.semantic_remember(payload.answer[:300], "validated answer")
        st.self_model.reliability_score = round(min(0.99, st.self_model.reliability_score + 0.01), 3)
        action = "validated answer distilled to semantic memory; reliability up"
    return {"ok": True, "action": action, "reliability": st.self_model.reliability_score}
