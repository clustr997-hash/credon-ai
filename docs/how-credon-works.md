# How Credon AI Works (Detailed)

This document explains Credon AI architecture, answer routing, memory behavior, retrieval depth, and deployment parity practices for smooth v1 behavior.

## 1) Request Flow

1. Frontend sends `POST /api/v1/chat` or `POST /api/v1/chat/stream`.
2. Backend classifies question intent:
   - Personal memory question (name, location, college, profile)
   - Simple/local question
   - Math query
   - General/web-grounded query
3. Backend applies memory/profile resolution first when relevant.
4. For web-grounded flow, backend retrieves multi-source evidence (DDG + Serper + LangSearch + fallbacks).
5. Model routing uses deterministic order: DeepSeek primary, Groq fallback, Ollama optional.
6. Backend returns answer, confidence, sources, optional images, and latency.

## 2) Intent Differentiation

Credon now distinguishes:

- **Personal profile questions** (e.g., `who am i`, `my name`, `where do i live`, `my college`)
  - Handled by chat memory/profile extraction
  - Web search is bypassed
  - If unknown, Credon asks user to provide profile details

- **Math questions**
  - Detected with strict math patterns
  - Avoids false positives from normal text

- **General knowledge / web questions**
  - Retrieval + synthesis path
  - Dynamic retrieval budget for broad queries

## 3) Memory System

### Session Memory

- Stored per user/session in Firestore when configured.
- Local JSON fallback store is used when Firebase is unavailable.

### Personal Profile Memory

- Profile facts extracted from user messages:
  - Name
  - Location / hometown
  - College
- Returned directly for personal queries without web search.

### Learned Q&A Memory

- `backend/data/credon_learned.json`
- Guardrails prevent poisoning:
  - Skip low-confidence answers
  - Skip context-leaked rewrite prompts (`[replying to previous answer]`, attachment meta prompts)
  - Skip generic fallback-style answers

## 4) Retrieval and Coverage (Top 10 / Top 50)

Credon uses `retrieve_sources(...)` with dynamic depth:

- Default: 10 results
- Longer/complex queries: 15–25 results
- Explicit user query like `top 50 ...`: up to 50 results (capped at 50)

Search strategy:

1. Direct URL fetch (if query contains URLs)
2. DuckDuckGo (`ddgs`)
3. LangSearch API (if key configured)
4. Serper API (if key configured)
5. Google scrape fallback
6. Wikipedia summary fallback

Notes:

- Deep page extraction is disabled by default for speed/stability.
- Can be enabled with `ENABLE_PAGE_EXTRACTION=true`.

## 5) Model Routing

Credon chooses from available models at runtime.

- `MODEL_RUNTIME_MODE=cloud`: DeepSeek → Groq → Credon Brain.
- `MODEL_RUNTIME_MODE=auto`: Cloud-first when keys exist, otherwise Ollama/local.
- `MODEL_RUNTIME_MODE=local`: Ollama-first, cloud as optional fallback.
- If no model is available, Credon falls back to built-in brain/memory synthesis.

## 6) Frontend UX Features

Current UX includes:

- Streaming answers
- Thinking panel
- Source chips
- Image results grid
- Reply-to context
- Regenerate
- Feedback controls
- Quick rewrite actions: `TL;DR`, `Simplify`

## 7) Env Configuration

Root `.env` controls backend behavior:

- `USE_LOCAL_MODEL=true`
- `MODEL_RUNTIME_MODE=auto`
- `USE_MODEL_GENERATION=true`
- `USE_WEB_SEARCH=true`
- `OLLAMA_BASE_URL=http://localhost:11434`
- `OLLAMA_MODEL=qwen3:8b` (fallback default)
- `DEEPSEEK_API_KEY=`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `DEEPSEEK_MODEL=deepseek-reasoner`
- `GROQ_API_KEY=`
- `GROQ_BASE_URL=https://api.groq.com/openai/v1`
- `GROQ_MODEL=llama-3.3-70b-versatile`
- `SERPER_API_KEY=`
- `LANGSEARCH_API_KEY=`
- `LANGSEARCH_BASE_URL=https://api.langsearch.com/v1/web-search`
- `ENABLE_PAGE_EXTRACTION=false` (recommended for speed)

## 8) Runbook (Dev)

### Backend

`backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000`

### Frontend

`cd frontend && npm run dev`

### Health Checks

- `GET http://127.0.0.1:8000/health`
- Open `http://127.0.0.1:3000`

## 9) Deployment Parity Checklist (v1)

To keep behavior smooth after deployment:

1. Pin Python/Node versions used in dev.
2. Keep identical env flags across staging/prod.
3. Ensure Ollama availability or set cloud key fallback.
4. Keep `ddgs` dependency installed.
5. Keep memory guardrails enabled (avoid noisy learning).
6. Monitor latency for retrieval-heavy queries.
7. Add uptime checks for `/health` and chat endpoints.

## 10) Known Practical Limits

- If no local/cloud model is available, answers rely on built-in memory/brain logic.
- Source quality depends on public web indexing availability.
- Personal memory is session/data-store dependent; empty history means no personal recall yet.

## 11) Where Credon Data Is Stored (Current)

### Chat + Session Data

- Primary (when configured): **Firebase Firestore**
  - Collection path: `users/{user_id}/sessions/{session_id}/messages/*`
  - Session metadata: `users/{user_id}/sessions/{session_id}`
- Local fallback (when Firebase unavailable):
  - `backend/data/chat_store.json`

### Learned Knowledge

- Credon learned Q&A memory:
  - `backend/data/credon_learned.json`
- Curated seed knowledge:
  - `backend/data/credon_knowledge.json` (if present)

### Feedback Signals

- Current API endpoint: `POST /api/v1/feedback`
- Current behavior: vote logs captured and available for future training/export pipelines.

### Google Sheets Status

- Not enabled in current backend code by default.
- If required, add an export worker that periodically syncs feedback + approved transcripts to Sheets.

## 12) RLHF / RLAIF / DPO Practical Roadmap

### Phase A (Now)

1. Capture pairwise preferences from thumbs up/down + regenerated responses.
2. Store structured training events (query, answer A/B, preference, metadata).
3. Build an offline evaluation set (factuality, style, language consistency, follow-up coherence).

### Phase B (RLHF / RLAIF)

1. RLHF: human reviewers rank candidate outputs for high-value tasks.
2. RLAIF: stronger evaluator model auto-ranks candidate outputs before human audit.
3. Keep safety and factuality filters before accepting data into training pool.

### Phase C (DPO)

1. Convert preferences into chosen/rejected pairs.
2. Train or fine-tune with DPO to optimize directly for preferred outputs.
3. Version model adapters by release (`credon-alpha-1`, `credon-alpha-2`, etc.) and run A/B tests.

## 13) API Productization Path (Sell as API)

1. Version endpoints (`/api/v1`, `/api/v2`) with strict backward compatibility.
2. Add API keys, rate limits, usage metering, and billing records.
3. Expose stable contracts for:
   - chat
   - stream
   - model metadata
   - feedback
4. Add tenant isolation (per-customer data scope) and audit logs.
5. Publish SLA + latency/error dashboards before commercial rollout.
6. Keep retrieval/model telemetry for quality regression alerts.

---

If you want, next step can be adding a small `Intent` telemetry field in responses (`personal | math | web | local`) so you can debug routing decisions live in UI.
