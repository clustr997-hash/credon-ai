"""Pydantic contracts — frontend-compatible (mirrors src/lib/api.ts)."""
from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field


class CognitiveThinkRequest(BaseModel):
    user_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    query: str = Field(min_length=1)
    language: Literal["auto", "en", "hinglish"] = "auto"
    deep_think: bool = True
    use_web: bool = True


class CognitiveFeedbackRequest(BaseModel):
    user_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    query: str = Field(min_length=1)
    answer: str = Field(min_length=1)
    vote: Literal["up", "down"]
    note: str = ""


class TeachRequest(BaseModel):
    user_id: str = Field(min_length=1)
    fact: str = Field(min_length=4)
    topic: str = ""
