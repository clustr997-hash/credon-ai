"""Cognitive state definitions — the five types of state."""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class WorldState:
    """What is happening now?"""
    raw_input: str = ""
    perception_summary: str = ""
    language: str = "en"
    intent: str = "general"  # greeting | question | task | teach | feedback | plan
    entities: list[str] = field(default_factory=list)
    updated_at: str = field(default_factory=_now_iso)


@dataclass
class GoalNode:
    goal: str
    status: str = "pending"  # pending | active | done | failed | blocked
    parent: str = ""
    result: str = ""


@dataclass
class GoalSystem:
    goals: list[GoalNode] = field(default_factory=list)
    active_goal: str = ""

    def push(self, goal: str, parent: str = "") -> None:
        self.goals.append(GoalNode(goal=goal, parent=parent, status="active" if not self.goals else "pending"))
        if not self.active_goal:
            self.active_goal = goal

    def complete(self, goal: str, result: str = "") -> None:
        for g in self.goals:
            if g.goal == goal:
                g.status = "done"
                g.result = result[:2000]
        actives = [g for g in self.goals if g.status in ("pending", "active")]
        self.active_goal = actives[0].goal if actives else ""


@dataclass
class UserModel:
    """Persistent person-model, not just personalization flags."""
    user_id: str = ""
    knowledge: list[str] = field(default_factory=list)
    preferences: dict[str, Any] = field(default_factory=dict)
    habits: list[str] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)
    goals: list[str] = field(default_factory=list)
    communication_style: str = "unknown"
    past_topics: list[str] = field(default_factory=list)
    corrections: list[str] = field(default_factory=list)
    interaction_count: int = 0
    last_seen: str = field(default_factory=_now_iso)


@dataclass
class SelfModel:
    """Who am I? — capabilities, confidence calibration, recent errors."""
    identity: str = "Credon Alpha 1 — Continuous Cognitive Architecture"
    strengths: list[str] = field(default_factory=lambda: ["language", "reasoning", "coding", "web-research"])
    weaknesses: list[str] = field(default_factory=lambda: ["long-horizon planning", "physical action"])
    recent_surprises: list[str] = field(default_factory=list)
    reliability_score: float = 0.62  # starts near CUA-like baseline, improves with feedback
    total_cycles: int = 0


@dataclass
class CognitiveState:
    world: WorldState = field(default_factory=WorldState)
    goals: GoalSystem = field(default_factory=GoalSystem)
    user: UserModel = field(default_factory=UserModel)
    self_model: SelfModel = field(default_factory=SelfModel)
    working_memory: list[dict[str, Any]] = field(default_factory=list)  # ms..seconds
    task_memory: list[dict[str, Any]] = field(default_factory=list)     # minutes
    last_surprise: float = 0.0
    last_error: str = ""

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "world": asdict(self.world),
            "goals": {"active_goal": self.goals.active_goal,
                      "goals": [asdict(g) for g in self.goals.goals[-8:]]},
            "user": {"user_id": self.user.user_id,
                     "interaction_count": self.user.interaction_count,
                     "communication_style": self.user.communication_style,
                     "preferences": self.user.preferences,
                     "past_topics": self.user.past_topics[-10:],
                     "corrections_count": len(self.user.corrections)},
            "self": {"identity": self.self_model.identity,
                     "reliability_score": round(self.self_model.reliability_score, 3),
                     "total_cycles": self.self_model.total_cycles,
                     "recent_surprises": self.self_model.recent_surprises[-5:]},
            "working_memory_size": len(self.working_memory),
            "task_memory_size": len(self.task_memory),
            "last_surprise": round(self.last_surprise, 3),
            "last_error": self.last_error[:300],
        }
