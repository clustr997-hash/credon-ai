from typing import Literal
from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    user_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    query: str = Field(min_length=1)
    language: Literal["auto", "en", "hinglish"] = "auto"
    model: str | None = None  # optional model override
    use_web: bool = True
    regenerate_of: int | None = None
    reply_to: str | None = None


class Source(BaseModel):
    title: str
    url: str


class ImageResult(BaseModel):
    image_url: str
    thumbnail: str = ""
    title: str = ""
    source_url: str = ""


class ChatResponse(BaseModel):
    answer: str
    language: Literal["en", "hinglish"]
    confidence: Literal["low", "medium", "high"]
    sources: list[Source]
    images: list[ImageResult] = []
    suggestions: list[str] = []
    thinking: str = ""
    latency_ms: int
    metadata: dict[str, object] = Field(default_factory=dict)


class FeedbackRequest(BaseModel):
    user_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    message_text: str = Field(min_length=1)
    vote: Literal["up", "down"]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str
    created_at: str


class ChatSessionSummary(BaseModel):
    session_id: str
    last_updated: str
    message_count: int
    preview: str = ""


class ChatTranscriptResponse(BaseModel):
    user_id: str
    session_id: str
    messages: list[ChatMessage]
