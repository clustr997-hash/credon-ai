from __future__ import annotations

from typing import Any
from uuid import uuid4

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel

from app.services.knowledge_store import ingest_knowledge_text, detect_query_subject
from app.services.ocr_ingest import extract_text_from_pdf_bytes, ocr_image_bytes
from app.services.image_vision import describe_image_bytes

router = APIRouter()
IngestResponse = dict[str, Any]


# ── Pydantic models for structured ingest ────────────────────────

class TextIngestRequest(BaseModel):
    user_id: str
    text: str
    title: str = "untitled-note"
    subject: str = ""        # e.g. "physics", "mathematics", "biology"
    tags: list[str] = []     # e.g. ["chapter-5", "thermodynamics", "exam-prep"]
    source_type: str = "note"  # "note", "question_paper", "cheat_sheet", "lecture"
    board: str = ""          # e.g. "CBSE", "ICSE", "state"
    university: str = ""     # e.g. "AKTU", "DU", "Mumbai University"
    semester: str = ""       # e.g. "sem-1", "sem-3", "year-2"


class TextIngestItem(BaseModel):
    text: str
    title: str = "untitled"
    subject: str = ""
    tags: list[str] = []
    source_type: str = "note"


class BulkTextIngestRequest(BaseModel):
    user_id: str
    items: list[TextIngestItem]


@router.post("/ingest/pdf")
async def ingest_pdf(
    user_id: str = Form(...),
    file: UploadFile = File(...),
    subject: str = Form(""),
    tags: str = Form(""),
    source_type: str = Form("pdf"),
    board: str = Form(""),
    university: str = Form(""),
    semester: str = Form(""),
) -> IngestResponse:
    raw = await file.read()
    parsed = extract_text_from_pdf_bytes(raw)
    parsed_tags = [tag.strip().lower() for tag in tags.split(",") if tag.strip()]
    normalized_source_type = source_type.strip().lower() or "pdf"

    if not parsed["text"]:
        # Still store with filename context so the upload isn't lost
        fallback_text = f"[PDF uploaded: {file.filename or 'document.pdf'} — text extraction returned no content]"
        document_id = f"pdf-{uuid4().hex[:10]}"
        stats = ingest_knowledge_text(
            user_id=user_id,
            document_id=document_id,
            text=fallback_text,
            source_type=normalized_source_type,
            filename=file.filename or "uploaded.pdf",
            subject=subject,
            tags=parsed_tags,
            board=board,
            university=university,
            semester=semester,
        )
        return {
            "ok": True,
            "warning": "Limited text extracted from PDF. The file may be image-based. Install Tesseract OCR for better results.",
            "filename": file.filename,
            "document_id": document_id,
            "extract_method": parsed["method"],
            "chars": parsed["chars"],
            **stats,
        }

    document_id = f"pdf-{uuid4().hex[:10]}"
    stats = ingest_knowledge_text(
        user_id=user_id,
        document_id=document_id,
        text=parsed["text"],
        source_type=normalized_source_type,
        filename=file.filename or "uploaded.pdf",
        subject=subject,
        tags=parsed_tags,
        board=board,
        university=university,
        semester=semester,
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
    vision = describe_image_bytes(raw, prompt="Analyze this uploaded image for chat context.")
    text = vision.get("ocr_text") or ocr_image_bytes(raw)
    visual_context = vision.get("description", "")
    index_text = "\n\n".join(part for part in [str(visual_context).strip(), str(text).strip()] if part)

    if not index_text or index_text.startswith("[Image uploaded:"):
        # Still store so the upload isn't lost
        fallback_text = index_text or f"[Image uploaded: {file.filename or 'image'} — OCR returned no text]"
        document_id = f"img-{uuid4().hex[:10]}"
        stats = ingest_knowledge_text(
            user_id=user_id,
            document_id=document_id,
            text=fallback_text,
            source_type="image",
            filename=file.filename or "uploaded-image",
        )
        return {
            "ok": True,
            "warning": "Limited text extracted from image. For better results, ensure Tesseract OCR is installed or use clearer images.",
            "filename": file.filename,
            "document_id": document_id,
            "chars": len(fallback_text),
            "image_context": visual_context,
            "ocr_text": vision.get("ocr_text", ""),
            "vision_method": vision.get("method", "ocr_only"),
            "vision_warning": vision.get("warning", ""),
            **stats,
        }

    document_id = f"img-{uuid4().hex[:10]}"
    stats = ingest_knowledge_text(
        user_id=user_id,
        document_id=document_id,
        text=index_text,
        source_type="image",
        filename=file.filename or "uploaded-image",
    )

    return {
        "ok": True,
        "filename": file.filename,
        "document_id": document_id,
        "chars": len(index_text),
        "image_context": visual_context,
        "ocr_text": vision.get("ocr_text", ""),
        "vision_method": vision.get("method", "ocr_only"),
        "vision_warning": vision.get("warning", ""),
        **stats,
    }


# ── Text / Notes ingest (for students sharing notes, Q&A, cheat sheets) ──

@router.post("/ingest/text")
async def ingest_text(body: TextIngestRequest) -> IngestResponse:
    """Ingest plain text — notes, question papers, micro cheat sheets, lecture content.
    Subject is auto-detected if not provided."""
    if not body.text.strip():
        return {"ok": False, "error": "Text cannot be empty."}

    document_id = f"{body.source_type}-{uuid4().hex[:10]}"
    stats = ingest_knowledge_text(
        user_id=body.user_id,
        document_id=document_id,
        text=body.text,
        source_type=body.source_type,
        filename=body.title,
        subject=body.subject,
        tags=body.tags,
        board=body.board,
        university=body.university,
        semester=body.semester,
    )

    detected_subject = body.subject or detect_query_subject(body.text)

    return {
        "ok": True,
        "title": body.title,
        "document_id": document_id,
        "source_type": body.source_type,
        "detected_subject": detected_subject,
        "tags": body.tags,
        "chars": len(body.text),
        **stats,
    }


@router.post("/ingest/bulk")
async def ingest_bulk(body: BulkTextIngestRequest) -> IngestResponse:
    """Bulk ingest multiple notes/papers at once."""
    results: list[dict[str, Any]] = []
    total_stored = 0
    for item in body.items:
        if not item.text.strip():
            results.append({"title": item.title, "ok": False, "error": "empty"})
            continue
        document_id = f"{item.source_type}-{uuid4().hex[:10]}"
        stats = ingest_knowledge_text(
            user_id=body.user_id,
            document_id=document_id,
            text=item.text,
            source_type=item.source_type,
            filename=item.title,
            subject=item.subject,
            tags=item.tags,
        )
        stored = stats.get("stored", 0)
        if isinstance(stored, int):
            total_stored += stored
        detected_subject = item.subject or detect_query_subject(item.text)
        results.append({
            "title": item.title,
            "ok": True,
            "document_id": document_id,
            "detected_subject": detected_subject,
            **stats,
        })

    return {
        "ok": True,
        "total_items": len(body.items),
        "total_stored_chunks": total_stored,
        "results": results,
    }


@router.post("/ingest/pdf-academic")
async def ingest_pdf_academic(
    user_id: str = Form(...),
    file: UploadFile = File(...),
    subject: str = Form(""),
    tags: str = Form(""),  # comma-separated
    source_type: str = Form("note"),
) -> IngestResponse:
    """Ingest PDF with academic metadata — subject, tags, source type."""
    raw = await file.read()
    parsed = extract_text_from_pdf_bytes(raw)

    if not parsed["text"]:
        return {
            "ok": False,
            "error": "No text could be extracted.",
            "filename": file.filename,
            "method": parsed["method"],
            "chars": parsed["chars"],
        }

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    document_id = f"{source_type}-{uuid4().hex[:10]}"
    detected_subject = subject or detect_query_subject(parsed["text"])

    stats = ingest_knowledge_text(
        user_id=user_id,
        document_id=document_id,
        text=parsed["text"],
        source_type=source_type,
        filename=file.filename or "uploaded.pdf",
        subject=detected_subject,
        tags=tag_list,
    )

    return {
        "ok": True,
        "filename": file.filename,
        "document_id": document_id,
        "extract_method": parsed["method"],
        "detected_subject": detected_subject,
        "source_type": source_type,
        "tags": tag_list,
        "chars": parsed["chars"],
        **stats,
    }