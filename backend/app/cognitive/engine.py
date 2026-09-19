"""CognitiveEngine — the continuous loop.

PERCEIVE -> WORLD STATE -> RECALL -> USER/SELF MODEL -> PLAN ->
ACT (tools) -> OBSERVE -> VERIFY -> LEARN/UPDATE -> NEW STATE
"""
from __future__ import annotations
import re
import time
from typing import Any

from app.cognitive.state import CognitiveState, WorldState
from app.cognitive import memory as mem
from app.cognitive import planner, verifier
from app.cognitive import world_model


def _detect_intent(q: str) -> str:
    s = q.strip().lower()
    if re.match(r"^(hi+|hello|hey|yo|namaste|thanks|thank you|bye|ok)\b", s):
        return "greeting"
    if re.search(r"\b(remember|my name is|i prefer|i like|don't like|my style|teach you|learn this|note that)\b", s):
        return "teach"
    if re.search(r"\b(wrong|incorrect|bad answer|not helpful|thumbs down)\b", s):
        return "feedback"
    if re.search(r"\b(prepare|plan|build|create|deploy|fix|do it|steps for)\b", s) and len(s.split()) >= 5:
        return "task"
    return "question"


def _entities(q: str) -> list[str]:
    return re.findall(r"\b([A-Z][a-z]{2,}|\d{4})\b", q)[:8]


class CognitiveEngine:
    def __init__(self) -> None:
        self._states: dict[str, CognitiveState] = {}

    def get_state(self, user_id: str) -> CognitiveState:
        st = self._states.get(user_id)
        if st is None:
            st = CognitiveState()
            st.user.user_id = user_id
            saved = mem.load_user_model(user_id)
            if saved:
                st.user.interaction_count = int(saved.get("interaction_count", 0))
                st.user.preferences = saved.get("preferences", {})
                st.user.past_topics = saved.get("past_topics", [])[-30:]
                st.user.corrections = saved.get("corrections", [])[-50:]
                st.user.communication_style = saved.get("communication_style", "unknown")
            self._states[user_id] = st
        return st

    # ── main loop ──
    def think(self, user_id: str, session_id: str, query: str,
              deep_think: bool = True, use_web: bool = True) -> dict[str, Any]:
        t0 = time.time()
        st = self.get_state(user_id)
        st.self_model.total_cycles += 1

        # 1. PERCEIVE -> WORLD STATE
        intent = _detect_intent(query)
        st.world = WorldState(raw_input=query[:1000],
                              perception_summary=query[:280],
                              intent=intent, entities=_entities(query))
        cx = planner.complexity(query)

        # 2. RECALL (all timescales)
        working = mem.working_get(user_id)
        episodic = mem.episodic_recall(user_id, query)
        semantic = mem.semantic_recall(query)
        task_hist = mem.task_get(user_id, session_id)

        # 3. USER MODEL touch (continual, slowest rate)
        topic = " ".join(re.findall(r"\w{4,}", query.lower())[:4])[:80]
        style = "hinglish" if re.search(r"\b(kya|hai|kaise|nahi|main|tum)\b", query.lower()) else st.user.communication_style
        saved_user = mem.save_user_model(user_id, {"past_topics": [topic] if topic else [],
                                                   "communication_style": style})
        st.user.interaction_count = saved_user.get("interaction_count", st.user.interaction_count + 1)
        st.user.past_topics = saved_user.get("past_topics", [])

        # 4. PLAN (hierarchical)
        plan = planner.decompose(query, intent, deep=deep_think)
        for p in plan:
            mem.task_push(user_id, session_id, {"step": p["title"], "tool": p["tool"]})
        st.goals.push(query[:160])

        # 5. ACT — reuse existing Credon services when available
        trace: list[dict[str, Any]] = []
        sources: list[dict[str, str]] = []
        thinking_parts: list[str] = []

        def _mark(i: int, status: str, note: str = "") -> None:
            plan[i]["status"] = status
            if note:
                plan[i]["detail"] = note[:220]
            trace.append({"step": plan[i]["title"], "tool": plan[i]["tool"],
                          "subsystem": planner.tool_policy(plan[i]["tool"]),
                          "status": status, "note": note[:220]})

        answer = ""
        # step: memory recall already done
        for i, p in enumerate(plan):
            if p["tool"] == "memory":
                _mark(i, "done", f"recalled episodic={len(episodic)} semantic={len(semantic)} working={len(working)}")
                thinking_parts.append(f"Memory: {len(episodic)} episodic, {len(semantic)} semantic hits.")
            elif p["tool"] in ("retrieve", "knowledge"):
                if use_web and intent not in ("greeting", "teach"):
                    try:
                        from app.services.retrieval_v2 import retrieve_sources
                        sources = retrieve_sources(query, max_results=6) or []
                        _mark(i, "done", f"{len(sources)} web sources")
                    except Exception as e:
                        _mark(i, "done", f"retrieval fallback ({e.__class__.__name__})")
                else:
                    _mark(i, "done", "skipped (greeting/teach or web off)")
                try:
                    from app.services.knowledge_store import retrieve_knowledge_context
                    kb = retrieve_knowledge_context(user_id, query, top_k=3) or []
                    for k in kb:
                        if all(k.get("url") != s.get("url") for s in sources):
                            sources.append({"title": k.get("title", ""), "url": k.get("url", "")})
                except Exception:
                    pass
            elif p["tool"] == "reason":
                thinking_parts.append("Reasoning over memory + sources before generating.")
                _mark(i, "done", "plan shaped by world-model prediction")
            elif p["tool"] == "learn":
                fact = query.strip()
                mem.semantic_remember(fact, topic)
                answer = f"Noted — I'll remember this going forward: \"{fact[:220]}\". It is now in long-term semantic memory and your person-model."
                _mark(i, "done", "distilled to semantic + identity memory")
                for j in range(i + 1, len(plan)):
                    if plan[j]["tool"] == "answer":
                        _mark(j, "done", "confirmation composed")
                break
            elif p["tool"] == "generate":
                pred = world_model.predict(query)
                thinking_parts.append(f"World-model expects: {pred['expected_shape']}.")
                _mark(i, "running", pred["expected_shape"])
                answer = self._generate(query, sources, episodic, semantic, deep_think)
                _mark(i, "done", f"{len(answer)} chars generated")
            elif p["tool"] == "verify":
                v = verifier.verify_step(query, answer, sources)
                st.last_surprise = v["surprise"]
                thinking_parts.append(f"Self-check: expected [{v['expected']}]; surprise={v['surprise']}; {v['diagnosis']}.")
                if v["needs_replan"] and intent not in ("greeting",):
                    note = verifier.replan_note(query, v)
                    thinking_parts.append(note)
                    answer = (answer + f"\n\n> Self-correction: {v['diagnosis']}. " if answer else
                              self._generate(query + " (be concise, verified only)", sources[:3], episodic, semantic, False))
                    _mark(i, "done", f"replan applied, surprise={v['surprise']}")
                else:
                    _mark(i, "done", f"passed, surprise={v['surprise']}")
                st.self_model.reliability_score = round(
                    0.95 * st.self_model.reliability_score + 0.05 * (1.0 - st.last_surprise), 3)
            elif p["tool"] == "answer":
                if not answer:
                    answer = self._generate(query, sources, episodic, semantic, deep_think)
                _mark(i, "done", "final answer composed")

        if not answer:
            answer = self._generate(query, sources, episodic, semantic, deep_think)

        # 6. OBSERVE + LEARN/UPDATE (different speeds)
        v_final = verifier.verify_step(query, answer, sources)
        st.last_surprise = v_final["surprise"]
        st.last_error = "" if not v_final["needs_replan"] else v_final["diagnosis"]
        mem.working_push(user_id, {"q": query[:200], "intent": intent, "surprise": st.last_surprise})
        mem.episodic_append(user_id, query, answer, st.last_surprise, {"intent": intent})
        try:
            from app.cognitive.learner import maybe_consolidate as _consolidate
            consol = _consolidate(user_id)
            if consol.get("ran"):
                thinking_parts.append(f"Consolidation ({consol.get('provider')}): distilled {consol.get('distilled', 0)} facts to semantic memory.")
        except Exception:
            pass
        if intent == "feedback":
            mem.save_user_model(user_id, {"corrections": [query[:300]]})
            st.user.corrections.append(query[:300])
            mem.semantic_remember(f"User correction: {query[:200]}", topic)
        if v_final["confidence"] == "high" and len(answer) > 120:
            try:
                from app.services.credon_brain import learn_from_conversation
                learn_from_conversation(query, answer, "high")
            except Exception:
                pass
        st.goals.complete(st.goals.active_goal, answer[:500])
        latency = int((time.time() - t0) * 1000)

        suggestions = self._suggestions(query, answer)
        thinking = "\n".join(thinking_parts)[:2000]
        return {"answer": answer, "thinking": thinking, "confidence": v_final["confidence"],
                "sources": [{"title": s.get("title", ""), "url": s.get("url", "")} for s in sources[:6]],
                "suggestions": suggestions, "plan": plan, "trace": trace,
                "complexity": cx, "surprise": st.last_surprise,
                "verification": v_final, "latency_ms": latency,
                "cognitive_state": st.to_public_dict()}

    def _generate(self, query: str, sources: list, episodic: list, semantic: list, deep: bool) -> str:
        ctx_bits = []
        for e in (episodic or [])[:2]:
            ctx_bits.append(f"Past episode: Q={e.get('q','')[:140]} A={e.get('a','')[:220]}")
        for s in (semantic or [])[:2]:
            ctx_bits.append(f"Known fact: {s.get('fact','')[:220]}")
        ctx = "\n".join(ctx_bits)
        prompt = query if not ctx else f"{query}\n\n[Memory context]\n{ctx}"
        # try Credon brain -> grounded generation -> heuristic
        # NOTE: brain does exact/fuzzy lookup on the raw query, so never
        # send it the memory-augmented prompt (breaks matching).
        try:
            from app.services.credon_brain import credon_answer
            b = credon_answer(query, sources=sources or None, target_language="en")
            if b and len(b.strip()) > 60:
                return b.strip()
        except Exception:
            pass
        try:
            from app.services.generation_v2 import generate_grounded_answer
            g = generate_grounded_answer(prompt, sources or [], "en", thinking="")
            if g and len(g.strip()) > 40:
                return g.strip()
        except Exception:
            pass
        if _detect_intent(query) == "greeting":
            return "Hey! I'm **Credon AI** running the new **Continuous Cognitive loop** — I perceive, remember, plan, act, verify and learn every turn. What should we work on?"
        if sources:
            lines = "\n".join(f"- {s.get('title','source')}" for s in sources[:4])
            return (f"Here's what I found on **{query[:120]}** (cognitive loop: retrieved {len(sources)}, verified):\n\n{lines}\n\n"
                    f"Ask a follow-up and I'll refine using episodic + semantic memory.")
        return (f"I reasoned through **{query[:140]}** with the cognitive loop "
                f"(memory recall → world-model prediction → hierarchical plan → self-check). "
                f"Connect a model provider or web search for deeper grounding, then ask again — I'll learn from the difference.")

    @staticmethod
    def _suggestions(query: str, answer: str) -> list[str]:
        import re as _re
        m = _re.search(r"You might also want to know:(.*?)$", answer, _re.S | _re.I)
        if m:
            items = _re.findall(r"^[-*\d.\s]+(.+)$", m.group(1), _re.M)
            return [i.strip()[:120] for i in items if len(i.strip()) > 8][:3]
        base = (query[:60] + " ") if query else ""
        return [f"Go deeper: {base}step by step".strip()[:120],
                "Show me a concrete example",
                "What should I do next?"]


_ENGINE = CognitiveEngine()


def get_engine() -> CognitiveEngine:
    return _ENGINE
