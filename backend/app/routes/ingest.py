from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import APIRouter, File, Form, UploadFile

from app.services.knowledge_store import ingest_knowledge_text
from app.services.ocr_ingest import extract_text_from_pdf_bytes, ocr_image_bytes

router = APIRouter()
IngestResponse = dict[str, Any]


@router.post("/ingest/pdf")
async def ingest_pdf(
    user_id: str = Form(...),
    file: UploadFile = File(...),
) -> IngestResponse:
    raw = await file.read()
    parsed = extract_text_from_pdf_bytes(raw)

    if not parsed["text"]:
        return {
            "ok": False,
            "error": "No text could be extracted. This PDF may need better scan quality or Tesseract setup.",
            "filename": file.filename,
            "method": parsed["method"],
            "chars": parsed["chars"],
        }

    document_id = f"pdf-{uuid4().hex[:10]}"
    stats = ingest_knowledge_text(
        user_id=user_id,
        document_id=document_id,
        text=parsed["text"],
        source_type="pdf",
        filename=file.filename or "uploaded.pdf",
    )

    return {
        "ok": True,
        "filename": file.filename,
        "document_id": document_id,
        "extract_method": parsed["method"],
        "chars": parsed["chars"],
        **stats,
    }


@router.post("/ingest/image")
async def ingest_image(
    user_id: str = Form(...),
    file: UploadFile = File(...),
) -> IngestResponse:
    raw = await file.read()
    text = ocr_image_bytes(raw)

    if not text:
        return {
            "ok": False,
            "error": "No text extracted from image. Ensure image clarity and Tesseract setup.",
            "filename": file.filename,
            "chars": 0,
        }

    document_id = f"img-{uuid4().hex[:10]}"
    stats = ingest_knowledge_text(
        user_id=user_id,
        document_id=document_id,
        text=text,
        source_type="image",
        filename=file.filename or "uploaded-image",
    )

    return {
        "ok": True,
        "filename": file.filename,
        "document_id": document_id,
        "chars": len(text),
        **stats,
    }
