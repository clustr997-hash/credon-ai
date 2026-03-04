from __future__ import annotations

import io
import os
from typing import Any, Callable, cast

from PIL import Image, ImageEnhance, ImageFilter
from pypdf import PdfReader
import pypdfium2 as pdfium  # type: ignore[import-untyped]
import pytesseract  # type: ignore[import-untyped]


def _normalize_text(text: str) -> str:
    return "\n".join(line.strip() for line in text.splitlines() if line.strip())


def _ensure_tesseract_cmd() -> None:
    cmd = os.getenv("TESSERACT_CMD", "").strip()
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd


def _preprocess_image(image: Image.Image) -> Image.Image:
    """Enhance image for better OCR accuracy."""
    # Convert to grayscale
    img = image.convert("L")
    # Sharpen
    img = img.filter(ImageFilter.SHARPEN)
    # Increase contrast
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(2.0)
    # Increase size if small
    w, h = img.size
    if w < 1000 or h < 1000:
        scale = max(1000 / w, 1000 / h, 1.0)
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    return img


def ocr_image_bytes(image_bytes: bytes) -> str:
    _ensure_tesseract_cmd()
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        return ""

    try:
        image_to_string = cast(Callable[[Any, str], str], getattr(pytesseract, "image_to_string"))
        # First try with original image
        text = image_to_string(image, "")
        cleaned = _normalize_text(text)
        # If result is poor, try with preprocessing
        if len(cleaned) < 20:
            preprocessed = _preprocess_image(image)
            text2 = image_to_string(preprocessed, "")
            cleaned2 = _normalize_text(text2)
            if len(cleaned2) > len(cleaned):
                return cleaned2
        return cleaned
    except Exception:
        return ""


def _pdf_text_extract(pdf_bytes: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
        return _normalize_text(text)
    except Exception:
        return ""


def _pdf_ocr_extract(pdf_bytes: bytes, max_pages: int = 12) -> str:
    _ensure_tesseract_cmd()
    lines: list[str] = []
    try:
        pdf = pdfium.PdfDocument(pdf_bytes)
        page_count = min(len(pdf), max_pages)
        for page_index in range(page_count):
            page = cast(Any, pdf[page_index])
            bitmap = page.render(scale=3)  # higher resolution for better OCR
            pil_image = cast(Image.Image, bitmap.to_pil().convert("RGB"))
            preprocessed = _preprocess_image(pil_image)
            image_to_string = cast(Callable[[Any, str], str], getattr(pytesseract, "image_to_string"))
            text = image_to_string(preprocessed, "")
            clean = _normalize_text(text)
            if clean:
                lines.append(clean)
    except Exception:
        return ""
    return _normalize_text("\n".join(lines))


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> dict[str, Any]:
    text = _pdf_text_extract(pdf_bytes)
    method = "pdf_text"

    # Use a higher threshold (300 chars) to trigger OCR fallback more aggressively
    if len(text) < 300:
        ocr_text = _pdf_ocr_extract(pdf_bytes)
        if len(ocr_text) > len(text):
            text = ocr_text
            method = "pdf_ocr"

    return {"text": text, "method": method, "chars": len(text)}
