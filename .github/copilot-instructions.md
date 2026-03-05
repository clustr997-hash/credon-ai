# Copilot Instructions for Credon AI

## Big picture (read this first)
- This repo is a split app: `backend/` (FastAPI) + `frontend/` (Next.js App Router).
- API entrypoint is `backend/app/main.py`; routers mounted under `/api/v1` (`chat` + `ingest`).
- Core chat orchestration lives in `backend/app/routes/chat.py` and is intentionally multi-path:
  - quick memory/personal/greeting paths first,
  - then Credon Brain fallback,
  - then retrieval + model generation pipeline.
- Keep this ordering when changing behavior; many UX guarantees depend on early short-circuits.

## Request/data flow you must preserve
- `POST /api/v1/chat` and `POST /api/v1/chat/stream` both:
  - normalize query (`_extract_reply_context`),
  - save user message (`chat_store.save_message`),
  - attempt follow-up/memory/personal/greeting routes,
  - optionally merge knowledge-store + web retrieval,
  - generate answer and persist assistant message,
  - call `learn_from_conversation` for self-learning.
- SSE streaming endpoint emits typed events (`status`, `thinking`, `sources`, `token`, `done`); keep event shape stable.
- Knowledge retrieval is user-scoped via `retrieve_knowledge_context(user_id, query, top_k=...)` before/alongside web search.

## Storage and integration boundaries
- Chat/session history uses `app/services/chat_store.py` with Firestore primary and JSON fallback (`backend/data/chat_store.json`).
- Knowledge chunks/vectors use `app/services/knowledge_store.py` and ingest routes in `app/routes/ingest.py`.
- OCR pipeline is in `app/services/ocr_ingest.py` (`pypdf` first, OCR fallback for weak PDFs/images).
- Model orchestration is centralized in `app/services/models.py`; do not call providers directly from routes.

## Project-specific coding patterns
- Pydantic contracts are in `backend/app/models/schemas.py`; update schemas first when changing API I/O.
- Language handling supports `en` and `hinglish`; preserve `language="auto"` detection behavior.
- Keep helper heuristics in `chat.py` (`_is_greeting`, `_is_math_query`, `_web_result_budget`, etc.) deterministic and cheap.
- Use `_clean_answer` and `_merge_sources` patterns when adjusting answer/source assembly.
- For visual queries, image search is additive (never replaces text answer) via `search_images()`.

## Retrieval/generation conventions
- Retrieval stack in `retrieval_v2.py`: DDG first, then Brave, then Google scrape, then Wikipedia fallback.
- Page extraction is gated by `ENABLE_PAGE_EXTRACTION`; do not enable expensive extraction by default.
- Generation stack in `generation_v2.py` uses:
  - `think_about_sources(...)` before answer generation,
  - `generate_answer_stream(...)` for SSE,
  - `generate_grounded_answer(...)` for sync,
  - fallback to Credon Brain when model output is unavailable/degraded.

## Developer workflows
- Backend setup/run (Windows):
  - `backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt`
  - `backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000`
- Frontend setup/run:
  - `cd frontend && npm install && npm run dev`
- API docs + health:
  - `GET /docs`, `GET /health`

## Environment toggles used in code
- Model/runtime: `USE_LOCAL_MODEL`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`
- Retrieval: `USE_WEB_SEARCH`, `ENABLE_PAGE_EXTRACTION`, `BRAVE_API_KEY`
- CORS: `CORS_ALLOW_ORIGINS`, `CORS_ALLOW_ORIGIN_REGEX`
- OCR/Firebase: `TESSERACT_CMD`, `FIREBASE_SERVICE_ACCOUNT_PATH` (or Firebase env triplet)

## When editing
- Prefer minimal, route-local changes in `chat.py`; this file encodes product behavior (confidence, fallback, routing).
- Keep response payload compatibility for frontend consumers (`sources`, `images`, `latency_ms`, SSE event keys).
- If you add new route behavior, mirror it in both sync and streaming endpoints unless intentionally different.

---

# Credon AI Development Guidelines for Copilot

## Core Principles
1. **Never return generic fallback answers** - Always try Credon Brain first
2. **Quality over speed** - Better to return "I need more context" than wrong info
3. **Source synthesis** - When sources available, extract clear main points
4. **No garbage learning** - Filter out context-leaked, generic, or wrong responses

## Code Standards
- Use type hints everywhere (`str`, `list[dict[str, Any]]`, etc.)
- Handle None/empty cases explicitly
- Log decisions: `print(f"[Credon] Using Brain fallback because...")`
- Test with both English and Hinglish

## Answer Quality Checks
Before saving to learned DB:
- [ ] Answer length > 50 chars
- [ ] Confidence >= medium
- [ ] Question not a meta-prompt
- [ ] Answer doesn't contain error markers
- [ ] Relevance: 2+ shared keywords between Q and A

## Response Structure
Always include:
1. Clear main answer
2. Supporting points (if complex)
3. Sources (if web search used)
4. 3 follow-up suggestions

Never say:
- "I'm building understanding"
- "Try enabling web search" (just do it)
- "I'm continuously learning"
- Generic "here's what I found"

## When Suggesting Code
- Prefer explicit over clever
- Add comments explaining WHY, not just WHAT
- Include error handling
- Show before/after examples