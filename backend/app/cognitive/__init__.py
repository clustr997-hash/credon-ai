"""Continuous Cognitive Architecture for Credon AI.

Implements the loop from the design doc:
WORLD -> PERCEPTION -> WORLD STATE -> MEMORY (working/episodic/semantic)
-> SELF/USER MODEL -> GOALS -> HIERARCHICAL PLANNER -> ACTION POLICY
-> TOOLS -> RESULT -> ERROR/SURPRISE -> MEMORY UPDATE -> repeat.
"""
from app.cognitive.engine import CognitiveEngine, get_engine

__all__ = ["CognitiveEngine", "get_engine"]
