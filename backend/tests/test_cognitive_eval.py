"""Phase 0 eval harness — baselines before any real intelligence work.

Three suites, all offline-safe (use_web=False, unique eval user_ids):
  1. long-horizon: does plan length grow + does success collapse with steps?
  2. memory: teach fact -> recall it (episodic + semantic precision/recall)
  3. verifier calibration: does surprise separate good vs bad answers?

Run from C:/Users/Swapnil/backend:
  .venv/Scripts/python.exe -m unittest tests.test_cognitive_eval -v
Metrics dump: backend/data/evals/latest.json
"""
from __future__ import annotations
import json
import sys
import time
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.cognitive import planner, verifier
from app.cognitive import world_model
from app.cognitive import memory as mem
from app.cognitive.engine import CognitiveEngine

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
EVAL_DIR = DATA_DIR / "evals"
EVAL_DIR.mkdir(parents=True, exist_ok=True)

LONG_HORIZON_TASKS = [
    {"goal": "Hi", "min_steps": 1, "kind": "1-step"},
    {"goal": "What is transformer architecture?", "min_steps": 3, "kind": "question"},
    {"goal": "Write a Python function to reverse a string", "min_steps": 4, "kind": "code"},
    {"goal": "Prepare my project for tomorrow presentation", "min_steps": 4, "kind": "long-horizon"},
    {"goal": "Prepare my project for tomorrow presentation with slides and demo and tests", "min_steps": 4, "kind": "long-horizon+"},
]

GOOD_ANSWER = (
    "## The Transformer Architecture\n"
    "The Transformer uses self-attention to relate tokens across the sequence. "
    "It stacks multi-head attention, position encoding, feed-forward layers and layer norm. "
    "Encoder-only models like BERT classify, decoder-only models like GPT generate."
)
BAD_ANSWER = "I don't know."


class TestLongHorizon(unittest.TestCase):
    def test_plan_grows_and_success_curve(self):
        engine = CognitiveEngine()
        curve = []
        for t in LONG_HORIZON_TASKS:
            plan = planner.decompose(t["goal"], "task" if "Prepare" in t["goal"] else "question", deep=True)
            self.assertGreaterEqual(
                len(plan), t["min_steps"],
                f"plan too short for {t['goal']!r}: got {len(plan)} steps")
            uid = f"eval-lh-{uuid.uuid4().hex[:8]}"
            t0 = time.time()
            try:
                result = engine.think(uid, "s1", t["goal"], deep_think=True, use_web=False)
                ok = len(result["answer"].strip()) > 40 and not result["verification"]["needs_replan"]
                surprise = result["surprise"]
            except Exception as e:  # harness must report, not crash the suite
                ok, surprise = False, 1.0
                print(f"\n[eval] engine.think failed for {t['goal']!r}: {e}")
            curve.append({"goal": t["goal"], "kind": t["kind"],
                          "plan_steps": len(plan), "success": ok,
                          "surprise": surprise, "latency_s": round(time.time() - t0, 2)})
        (EVAL_DIR / "long_horizon_curve.json").write_text(
            json.dumps(curve, indent=1), encoding="utf-8")
        print("\n[eval] long-horizon curve:")
        for row in curve:
            print(f"  {row['kind']:14s} steps={row['plan_steps']} success={row['success']} surprise={row['surprise']}")
        # Baseline assertion: harness ran + plan exists for longest task.
        # Success collapse is EXPECTED pre-fix — we record it, not hide it.
        self.assertEqual(len(curve), len(LONG_HORIZON_TASKS))


class TestMemory(unittest.TestCase):
    def test_teach_recall_cycle(self):
        uid = f"eval-mem-{uuid.uuid4().hex[:8]}"
        fact = f"Eval fact {uuid.uuid4().hex[:6]}: Vishesh prefers clean Python with type hints"
        mem.semantic_remember(fact, "eval-topic")
        hits = mem.semantic_recall("What coding style does Vishesh prefer?", top_k=3)
        found_sem = any("type hints" in h.get("fact", "") or fact[:20] in h.get("fact", "") for h in hits)

        mem.episodic_append(uid, "What style do I like?", "You like clean Python with type hints.", 0.2, {"intent": "teach"})
        eps = mem.episodic_recall(uid, "What style do I like?", top_k=3)
        found_epi = any("type hints" in (e.get("a", "") + e.get("q", "")) for e in eps)

        metrics = {"semantic_found": found_sem, "episodic_found": found_epi,
                   "semantic_hits": len(hits), "episodic_hits": len(eps)}
        (EVAL_DIR / "memory_metrics.json").write_text(json.dumps(metrics, indent=1), encoding="utf-8")
        print(f"\n[eval] memory: {metrics}")
        self.assertTrue(found_sem, "semantic recall missed a just-taught fact")
        self.assertTrue(found_epi, "episodic recall missed a just-appended episode")


class TestVerifierCalibration(unittest.TestCase):
    def test_surprise_separates_good_bad(self):
        q = "What is transformer architecture?"
        good_s = world_model.surprise_score(world_model.predict(q), GOOD_ANSWER)
        bad_s = world_model.surprise_score(world_model.predict(q), BAD_ANSWER)
        v_good = verifier.verify_step(q, GOOD_ANSWER, [{"title": "t", "url": "u"}] * 3)
        v_bad = verifier.verify_step(q, BAD_ANSWER, [])
        metrics = {"good_surprise": good_s, "bad_surprise": bad_s,
                   "good_conf": v_good["confidence"], "bad_conf": v_bad["confidence"],
                   "separation": round(bad_s - good_s, 3)}
        (EVAL_DIR / "verifier_metrics.json").write_text(json.dumps(metrics, indent=1), encoding="utf-8")
        print(f"\n[eval] verifier: {metrics}")
        # Minimal bar for the current heuristic: bad must surprise more than good.
        # If this fails, the heuristic is worse than random — fix before building on it.
        self.assertGreater(bad_s, good_s, "surprise does not separate obvious good vs bad")


class TestParaphraseRecall(unittest.TestCase):
    """The anti-hardcoding test: paraphrase shares ~zero keywords with the fact.

    Keyword-overlap recall MUST fail this; real vector recall passes it.
    If the embedding provider is only the hashing fallback (no ST, no Ollama),
    this test documents that gap instead of pretending.
    """
    def test_paraphrase_finds_taught_fact(self):
        from app.cognitive import vectors as vec
        uid = f"eval-para-{uuid.uuid4().hex[:8]}"
        mem.semantic_remember("Vishesh writes backend services with FastAPI and PostgreSQL", "eval")
        hits = mem.semantic_recall("Which tools does Vishesh enjoy building servers with?", top_k=3)
        found = any("fastapi" in h.get("fact", "").lower() for h in hits)
        print(f"\n[eval] paraphrase: provider={vec.embed_provider()} found={found}")
        self.assertTrue(found,
                        f"paraphrase recall failed (provider={vec.embed_provider()}). "
                        "Install sentence-transformers or run Ollama embed model for real vectors.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
