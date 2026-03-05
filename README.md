# Credon AI — Full Technical Guide

Credon AI is a retrieval-first, memory-aware assistant with local-model routing, optional cloud fallback, OCR ingestion, and persistent knowledge storage.

## 1) Current Stack

### Frontend
- Next.js (App Router) + TypeScript
- Streaming chat UX (SSE)
- Firebase auth integration (optional, graceful guest mode)
- Reply context, regenerate, TL;DR, simplify actions
- Image attachments UI (marker support; full binary upload now available via backend ingest APIs)

### Backend
- FastAPI (`/api/v1/*`)
- Retrieval pipeline (`ddgs` + fallbacks)
- Model orchestration for Ollama + DeepSeek cloud option
- Session memory + learned memory guardrails
- OCR ingestion and vector knowledge retrieval

### Database / Storage
- Primary: Firebase Firestore (when configured)
- Local fallback JSON files (when Firebase unavailable)

## 2) Data Storage — Exactly Where

### Chat Sessions
- Firestore:
  - `users/{user_id}/sessions/{session_id}/messages/*`
  - `users/{user_id}/sessions/{session_id}` (metadata)
- Local fallback:
  - `backend/data/chat_store.json`

### Learned Q&A Memory
- Local file:
  - `backend/data/credon_learned.json`

### OCR / Vector Knowledge Store
- Firestore:
  - `users/{user_id}/knowledge_chunks/*`
- Local fallback:
  - `backend/data/knowledge_vectors.json`

## 3) Model Routing and Failover

Credon now retries local models automatically when selected Ollama model fails (e.g., HTTP 500).

### Behavior
1. Try selected model.
2. If failure, retry healthy local models in priority order.
3. If all fail, fallback to Credon synthesized answer path.

This keeps long web-grounded answers usable even during model instability.

## 4) OCR + Ingestion APIs (New)

### `POST /api/v1/ingest/pdf`
Multipart form:
- `user_id` (string)
- `file` (PDF)

Flow:
1. Extract text with `pypdf`.
2. If low/empty text, OCR pages (`pypdfium2` render + `pytesseract`).
3. Chunk text, embed chunks, store vectors.

### `POST /api/v1/ingest/image`
Multipart form:
- `user_id` (string)
- `file` (image)

Flow:
1. OCR image via `pytesseract`.
2. Chunk + embed + store in knowledge DB.

## 5) Knowledge Retrieval in Chat

For each query:
1. Retrieve top user-specific knowledge chunks from vector store.
2. Merge with web results (if web enabled).
3. Generate grounded answer from merged context.

Result: Credon uses user-uploaded docs/images + web + model reasoning together.

## 6) APIs Available

- `GET /health`
- `GET /api/v1/models`
- `POST /api/v1/chat`
- `POST /api/v1/chat/stream`
- `GET /api/v1/chats/{user_id}`
- `GET /api/v1/chats/{user_id}/{session_id}`
- `POST /api/v1/feedback`
- `POST /api/v1/ingest/pdf`
- `POST /api/v1/ingest/image`

## 7) Environment Variables

Core:
- `MODEL_RUNTIME_MODE=auto` (`cloud` for production lock)
- `USE_MODEL_GENERATION=true`
- `USE_LOCAL_MODEL=true`
- `OLLAMA_BASE_URL=http://localhost:11434`
- `OLLAMA_MODEL=qwen3:8b`
- `OLLAMA_EMBED_MODEL=nomic-embed-text`
- `USE_WEB_SEARCH=true`
- `ENABLE_PAGE_EXTRACTION=false`

Cloud optional:
- `DEEPSEEK_API_KEY=...`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `DEEPSEEK_MODEL=deepseek-reasoner`
- `GROQ_API_KEY=...`
- `GROQ_BASE_URL=https://api.groq.com/openai/v1`
- `GROQ_MODEL=llama-3.3-70b-versatile`

Retrieval providers (optional but recommended in production):
- `SERPER_API_KEY=...`
- `LANGSEARCH_API_KEY=...`
- `LANGSEARCH_BASE_URL=https://api.langsearch.com/v1/web-search`

Firebase optional:
- `FIREBASE_SERVICE_ACCOUNT_PATH=backend/secrets/firebase-service-account.json`
- or `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

OCR optional tuning:
- `TESSERACT_CMD=C:/Program Files/Tesseract-OCR/tesseract.exe`

## 8) Setup

### Backend
```bash
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## 9) Scale Plan (How Credon Becomes Powerful)

### Stage A — Reliability
- Keep model failover + health checks.
- Add request/latency/error telemetry by endpoint and model.
- Add queue-based retry for ingest jobs.

### Stage B — Data Intelligence
- Build cleaner preference dataset from `/feedback` + regenerate actions.
- Add approval pipeline for high-quality learned entries.
- Add eval suite: factuality, follow-up coherence, language consistency.

### Stage C — Better Models
- Use stronger local models for premium tier.
- Add cloud fallback for peak traffic.
- Build model routing by task type + latency budget.

### Stage D — API Productization
- API keys + tenant isolation + quotas.
- Metering + billing + usage analytics.
- Versioned contracts (`/api/v1`, `/api/v2`) with compatibility policy.

### Stage E — Learning Loop (RLHF/RLAIF/DPO)
- Collect pairwise preferences (accepted vs regenerated answers).
- RLAIF scoring pass by stronger evaluator model.
- DPO fine-tuning cycle per release (`credon-alpha-*`).

## 10) Notes and Limits

- OCR quality depends on scan quality and Tesseract installation.
- If OCR cannot extract text, API returns explicit error.
- Attachment UI currently sends markers in chat; true binary ingestion should call `/ingest/pdf` or `/ingest/image` directly.

## 11) FCM Setup (Step-by-Step)

FCM is optional. Credon runs without it.

1. Open Firebase Console -> Project Settings -> Cloud Messaging.
2. Enable Cloud Messaging API (if prompted).
3. Create a Web Push certificate key (VAPID) and copy it.
4. In frontend env (`frontend/.env.local`) add:
```bash
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_VAPID_KEY=YOUR_VAPID_KEY
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000
```
5. Run frontend and open Settings -> Push Notifications (FCM) -> Enable.
6. Credon generates a browser token. Save token on backend if you want targeted push notifications later.

## 12) Autonomous Trainer Bot (Safe Mode)

Use `backend/scripts/autonomous_feedback_bot.py` with strict limits.

Example:
```bash
backend/.venv/Scripts/python.exe backend/scripts/autonomous_feedback_bot.py --base-url http://127.0.0.1:8000 --user-id trainer-bot --loops 6 --daily-cap 40 --hourly-cap 10 --max-downvotes-per-run 2 --sleep-sec 2
```

Safety behavior:
- Uses dedicated user id (`trainer-bot`) so it does not interfere with real user sessions.
- Enforces daily + hourly caps to protect Firebase/API quotas.
- Limits downvotes per run to avoid noisy negative training.
- Stores run state in `backend/data/autonomous_feedback_bot_state.json`.

## 13) GitHub -> Firebase Auto Deploy

Workflow file already exists: `.github/workflows/firebase-hosting-deploy.yml`.

Required one-time setup:
1. Push repository to GitHub and make sure default branch is `main`.
2. In GitHub -> Settings -> Secrets and variables -> Actions, add secret:
  - `FIREBASE_SERVICE_ACCOUNT_CREDONAI` (service account JSON for Hosting deploy).
3. Verify `firebase.json` and `.firebaserc` point to your Firebase project.
4. Push any change in `frontend/**` to `main`.

What auto-updates:
- Firebase Hosting frontend deploy.

What does not auto-update from this workflow:
- FastAPI backend runtime (deploy backend separately on your backend host).

---

If you want, next step I can implement frontend upload integration to call these ingest APIs directly before chat so image/PDF context is automatically available in the same conversation.
