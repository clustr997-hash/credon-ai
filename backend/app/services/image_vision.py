"""Image understanding helpers for chat attachments.

Uses OCR plus an optional local Ollama vision model so Credon can answer about
what is visibly in an uploaded image instead of only indexing extracted text.
"""

from __future__ import annotations

import base64
import io
import os
from typing import Any

import requests
from PIL import Image

from app.services.ocr_ingest import ocr_image_bytes
from app.services.models import generate_sync


def _ollama_url() -> str:
    return os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")


def _vision_model() -> str:
    return os.getenv("OLLAMA_VISION_MODEL", "llava:latest").strip() or "llava:latest"


def _is_ocr_placeholder(text: str) -> bool:
    return not text.strip() or text.startswith("[Image uploaded:")


def _image_facts(image_bytes: bytes) -> dict[str, Any]:
    try:
        image = Image.open(io.BytesIO(image_bytes))
        fmt = image.format or "image"
        rgb = image.convert("RGB")
        width, height = rgb.size
        aspect = round(width / height, 3) if height else 0
        return {"width": width, "height": height, "aspect_ratio": aspect, "format": fmt}
    except Exception:
        return {"width": 0, "height": 0, "aspect_ratio": 0, "format": "image"}


def _detect_content_type(ocr_text: str, facts: dict[str, Any]) -> str:
    text = ocr_text.lower()
    width = int(facts.get("width") or 0)
    height = int(facts.get("height") or 0)
    if any(token in text for token in ["volume", "chapter", "next issue", "panel", "no-one"]) or height > width * 1.2:
        return "comic_page"
    if any(token in text for token in ["question", "marks", "solve", "exam"]):
        return "study_document"
    if any(token in text for token in ["error", "exception", "traceback", "warning"]):
        return "screenshot_debug"
    return "general_image"


def _credon_vision_prompt(content_type: str, prompt: str) -> str:
    user_goal = prompt.strip() or "Analyze this uploaded image for chat context."
    return (
        "Credon Vision Alpha task: inspect the uploaded image directly. Return a grounded, useful analysis.\n"
        "Do not say you only indexed a file. Do not invent unreadable details. If text is hard to read, say so.\n"
        f"Detected content type hint: {content_type}.\n"
        f"User goal: {user_goal}\n\n"
        "Output format:\n"
        "1. Visual summary: what is visible, composition, mood, style.\n"
        "2. Readable text: important text you can read.\n"
        "3. Structured details: characters/objects/layout/panels if relevant.\n"
        "4. Best next action: what Credon should do with this image.\n"
        "For comic pages, identify title/chapter, panel flow, character design, setting, and continuation opportunities."
    )


def _format_credon_context(description: str, ocr_text: str, content_type: str, facts: dict[str, Any]) -> str:
    parts = [
        "Credon Vision Alpha analysis",
        f"Content type: {content_type}",
        f"Image: {facts.get('width', 0)}x{facts.get('height', 0)} {facts.get('format', 'image')}",
    ]
    if description.strip():
        parts.append("Visual understanding:\n" + description.strip())
    if ocr_text.strip():
        parts.append("OCR/readable text:\n" + ocr_text.strip()[:2000])
    return "\n\n".join(parts)


def describe_image_bytes(image_bytes: bytes, prompt: str = "") -> dict[str, Any]:
    """Return OCR + optional visual description for an uploaded image.

    The function never fails hard: if no vision model is configured locally, it
    still returns OCR and image dimensions so the chat layer can provide a useful
    answer and explain what additional setup enables full visual understanding.
    """
    facts = _image_facts(image_bytes)
    ocr_text = ocr_image_bytes(image_bytes)
    clean_ocr = "" if _is_ocr_placeholder(ocr_text) else ocr_text
    content_type = _detect_content_type(clean_ocr, facts)
    description = ""
    method = "credon_vision_alpha"
    warning = ""

    try:
        encoded = base64.b64encode(image_bytes).decode("ascii")
        question = _credon_vision_prompt(content_type, prompt)
        resp = requests.post(
            f"{_ollama_url()}/api/chat",
            json={
                "model": _vision_model(),
                "messages": [
                    {
                        "role": "system",
                        "content": "You are Credon Vision Alpha, Credon's own image-understanding layer. Be visual, specific, useful, and honest about uncertainty.",
                    },
                    {"role": "user", "content": question, "images": [encoded]},
                ],
                "stream": False,
            },
            timeout=45,
        )
        if resp.ok:
            description = (resp.json().get("message", {}).get("content") or "").strip()
            if description:
                method = "credon_vision_alpha"
        else:
            warning = f"Vision model unavailable ({resp.status_code}). Configure OLLAMA_VISION_MODEL with a local vision model."
    except Exception as exc:
        warning = f"Vision model unavailable. Configure OLLAMA_VISION_MODEL with a local vision model. Detail: {str(exc)[:120]}"

    if not description:
        fallback_prompt = (
            "Create a helpful image-reading response from the OCR text and image metadata below. "
            "Be honest that visual model analysis was not available if OCR is limited, but do not talk about indexed files.\n\n"
            f"Image metadata: {facts}\n"
            f"OCR text: {clean_ocr or '[no readable OCR text]'}\n"
            f"User request: {prompt or 'Analyze the uploaded image.'}"
        )
        description = generate_sync([
            {"role": "system", "content": "You help users understand uploaded images from OCR and metadata when full vision is unavailable."},
            {"role": "user", "content": fallback_prompt},
        ])
        method = "credon_vision_ocr_synthesis"

    credon_context = _format_credon_context(description, clean_ocr, content_type, facts)
    return {
        "description": description,
        "credon_context": credon_context,
        "ocr_text": clean_ocr,
        "content_type": content_type,
        "method": method,
        "engine": "credon_vision_alpha",
        "warning": warning,
        **facts,
    }
