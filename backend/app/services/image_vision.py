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
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        width, height = image.size
        return {"width": width, "height": height, "format": image.format or "image"}
    except Exception:
        return {"width": 0, "height": 0, "format": "image"}


def describe_image_bytes(image_bytes: bytes, prompt: str = "") -> dict[str, Any]:
    """Return OCR + optional visual description for an uploaded image.

    The function never fails hard: if no vision model is configured locally, it
    still returns OCR and image dimensions so the chat layer can provide a useful
    answer and explain what additional setup enables full visual understanding.
    """
    facts = _image_facts(image_bytes)
    ocr_text = ocr_image_bytes(image_bytes)
    description = ""
    method = "ocr_only"
    warning = ""

    try:
        encoded = base64.b64encode(image_bytes).decode("ascii")
        question = prompt.strip() or (
            "Describe this image for a user. Identify visible objects, layout, text, style, mood, and any likely purpose. "
            "If it is a comic/page/design, summarize panels and notable visual details."
        )
        resp = requests.post(
            f"{_ollama_url()}/api/chat",
            json={
                "model": _vision_model(),
                "messages": [
                    {
                        "role": "system",
                        "content": "You are Credon Vision. Analyze uploaded images directly and be specific, visual, and concise.",
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
                method = "ollama_vision"
        else:
            warning = f"Vision model unavailable ({resp.status_code}). Configure OLLAMA_VISION_MODEL with a local vision model."
    except Exception as exc:
        warning = f"Vision model unavailable. Configure OLLAMA_VISION_MODEL with a local vision model. Detail: {str(exc)[:120]}"

    if not description:
        clean_ocr = "" if _is_ocr_placeholder(ocr_text) else ocr_text
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
        method = "ocr_synthesis"

    return {
        "description": description,
        "ocr_text": "" if _is_ocr_placeholder(ocr_text) else ocr_text,
        "method": method,
        "warning": warning,
        **facts,
    }
