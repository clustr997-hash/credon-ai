"""
OCR helpers — extract text from images and PDF pages.
Graceful fallback when Tesseract is not installed.
"""

from __future__ import annotations

import io
import os
import re
from typing import Any

from PIL import Image, ImageEnhance, ImageFilter


# ── Tesseract availability (lazy check) ──────────────────────────

_tesseract_available: bool | None = None


def _check_tesseract() -> bool:
    global _tesseract_available
    if _tesseract_available is not None:
        return _tesseract_available
    try:
        import pytesseract  # type: ignore[import-untyped]
        _ensure_tesseract_cmd()
        pytesseract.get_tesseract_version()
        _tesseract_available = True
        print("[OCR] Tesseract is available")
    except Exception:
        _tesseract_available = False
        print("[OCR] Tesseract NOT available — using text-extraction only")
    return _tesseract_available


def _ensure_tesseract_cmd() -> None:
    import pytesseract  # type: ignore[import-untyped]
    cmd = os.getenv("TESSERACT_CMD", "").strip()
    if cmd:
        pytesseract.pytesseract.tesseract_cmd = cmd
    elif os.name == "nt":
        default = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        if os.path.isfile(default):
            pytesseract.pytesseract.tesseract_cmd = default


# ── Image preprocessing ──────────────────────────────────────────

def _preprocess_image(image: Image.Image) -> Image.Image:
    """Enhance image for better OCR accuracy."""
    img = image.convert("L")
    img = img.filter(ImageFilter.SHARPEN)
    img = ImageEnhance.Contrast(img).enhance(2.0)
    w, h = img.size
    if w < 1000 or h < 1000:
        scale = max(1000 / w, 1000 / h, 1.0)
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    return img


def _normalize_text(text: str) -> str:
    out = re.sub(r"[^\x20-\x7E\n\t\u0900-\u097F\u00C0-\u024F]", " ", text)
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return "\n".join(line.strip() for line in out.splitlines() if line.strip())


# ── Public API ───────────────────────────────────────────────────

def ocr_image_bytes(image_bytes: bytes) -> str:
    """Extract text from an image. Graceful fallback if Tesseract is missing."""
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        return ""

    if _check_tesseract():
        try:
            import pytesseract  # type: ignore[import-untyped]
            _ensure_tesseract_cmd()
            text = str(pytesseract.image_to_string(image))  # type: ignore[no-untyped-call]
            cleaned = _normalize_text(text)
            if len(cleaned) < 20:
                preprocessed = _preprocess_image(image)
                text2 = str(pytesseract.image_to_string(preprocessed))  # type: ignore[no-untyped-call]
                cleaned2 = _normalize_text(text2)
                if len(cleaned2) > len(cleaned):
                    return cleaned2
            return cleaned
        except Exception as e:
            print(f"[OCR] Tesseract failed on image: {e}")

    # Fallback: store dimensions so the upload isn't rejected
    w, h = image.size
    return f"[Image uploaded: {w}x{h}px — stored for reference. Text extraction requires Tesseract OCR setup.]"


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> dict[str, Any]:
    """Extract text from PDF. Text-extraction first, OCR fallback."""
    text = ""
    method = "none"

    # Strategy 1: PyPDF text extraction (fast)
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        pages: list[str] = []
        for page in reader.pages:
            t = page.extract_text() or ""
            if t.strip():
                pages.append(t.strip())
        text = "\n\n".join(pages)
        if text.strip():
            method = "pdf_text"
    except Exception as e:
        print(f"[OCR] PyPDF extraction failed: {e}")

    # Strategy 2: pypdfium2 text extraction
    if len(text) < 300:
        try:
            import pypdfium2 as pdfium  # type: ignore[import-untyped]
            pdf = pdfium.PdfDocument(pdf_bytes)
            pages2: list[str] = []
            for i in range(len(pdf)):
                page = pdf[i]
                t: str = page.get_textpage().get_text_bounded()  # type: ignore[assignment]
                if t and t.strip():
                    pages2.append(t.strip())
            text2 = "\n\n".join(pages2)
            if len(text2) > len(text):
                text = text2
                method = "pdfium_text"
        except Exception as e:
            print(f"[OCR] pypdfium2 text extraction failed: {e}")

    # Strategy 3: OCR pages as images (only if Tesseract available)
    if len(text) < 300 and _check_tesseract():
        try:
            import pypdfium2 as pdfium  # type: ignore[import-untyped]
            import pytesseract  # type: ignore[import-untyped]
            _ensure_tesseract_cmd()
            pdf = pdfium.PdfDocument(pdf_bytes)
            ocr_parts: list[str] = []
            for i in range(min(len(pdf), 12)):
                page = pdf[i]
                bitmap = page.render(scale=3)  # type: ignore[assignment]
                pil_image = bitmap.to_pil().convert("RGB")  # type: ignore[union-attr]
                preprocessed = _preprocess_image(pil_image)  # type: ignore[arg-type]
                page_text = str(pytesseract.image_to_string(preprocessed))  # type: ignore[no-untyped-call]
                clean = _normalize_text(page_text)
                if clean:
                    ocr_parts.append(clean)
            ocr_text = "\n\n".join(ocr_parts)
            if len(ocr_text) > len(text):
                text = ocr_text
                method = "pdf_ocr"
        except Exception as e:
            print(f"[OCR] PDF page OCR failed: {e}")

    text = _normalize_text(text)
    return {"text": text, "method": method, "chars": len(text)}
