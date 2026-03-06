# Credon AI - Full Technical Guide

Credon AI is a retrieval-first, memory-aware assistant with local-model routing, optional cloud fallback, OCR ingestion, and persistent knowledge storage.

## 1) Current Stack

### Frontend

- Next.js (App Router) + TypeScript
- Streaming chat UX (SSE)
- Firebase auth integration (optional, graceful guest mode)
- Reply context, regenerate, TLDR, simplify actions
- Image attachments UI (full binary upload available via backend ingest APIs)

### Backend Setup

- FastAPI (`/api/v1/*`)
- Retrieval pipeline (`ddgs` + fallbacks)
- Model orchestration for Ollama + DeepSeek cloud option
- Session memory + learned memory guardrails
- OCR ingestion and vector knowledge retrieval

### Database / Storage

- Primary: Firebase Firestore (when configured)
- Local fallback JSON files (when Firebase is unavailable)

## 2) Data Storage - Exact Paths

### Chat Sessions

- Firestore:
- `users/{user_id}/sessions/{session_id}/messages/*`
- `users/{user_id}/sessions/{session_id}` (metadata)
- Local fallback:
- `backend/data/chat_store.json`

### Learned Q and A Memory

- Local file:
- `backend/data/credon_learned.json`

### OCR / Vector Knowledge Store

- Firestore:
- `users/{user_id}/knowledge_chunks/*`
- Local fallback:
- `backend/data/knowledge_vectors.json`

### Push Tokens (FCM)

- Firestore:
- `users/{user_id}/push_tokens/*`
- Local fallback:
- `backend/data/push_tokens.json`

## 3) Model Routing and Failover

Credon retries local models automatically when the selected Ollama model fails.

### Behavior

1. Try selected model.
2. If failure, retry healthy local models in priority order.
3. If all fail, fallback to Credon synthesized answer path.

## 4) OCR + Ingestion APIs

### `POST /api/v1/ingest/pdf`

Multipart form:

- `user_id` (string)
- `file` (PDF)

Flow:

1. Extract text with `pypdf`.
2. If text is weak/empty, OCR pages (`pypdfium2` + `pytesseract`).
3. Chunk text, embed chunks, store vectors.

### `POST /api/v1/ingest/image`

Multipart form:

- `user_id` (string)
- `file` (image)

Flow:

1. OCR image via `pytesseract`.
2. Chunk + embed + store in knowledge DB.

## 5) APIs Available

- `GET /health`
- `GET /health/providers`
- `GET /api/v1/models`
- `POST /api/v1/chat`
- `POST /api/v1/chat/stream`
- `GET /api/v1/chats/{user_id}`
- `GET /api/v1/chats/{user_id}/{session_id}`
- `POST /api/v1/feedback`
- `POST /api/v1/ingest/pdf`
- `POST /api/v1/ingest/image`
- `POST /api/v1/notifications/token`
- `POST /api/v1/notifications/test`

## 6) Environment Variables

### Core

- `MODEL_RUNTIME_MODE=auto` (`cloud` for production lock)
- `USE_MODEL_GENERATION=true`
- `USE_LOCAL_MODEL=true`
- `OLLAMA_BASE_URL=http://localhost:11434`
- `OLLAMA_MODEL=qwen3:8b`
- `OLLAMA_EMBED_MODEL=nomic-embed-text`
- `USE_WEB_SEARCH=true`
- `ENABLE_PAGE_EXTRACTION=false`

### Cloud Optional

- `DEEPSEEK_API_KEY=...`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `DEEPSEEK_MODEL=deepseek-reasoner`
- `GROQ_API_KEY=...`
- `GROQ_BASE_URL=https://api.groq.com/openai/v1`
- `GROQ_MODEL=llama-3.3-70b-versatile`

### Retrieval Providers (Optional but Recommended)

- `SERPER_API_KEY=...`
- `LANGSEARCH_API_KEY=...`
- `LANGSEARCH_BASE_URL=https://api.langsearch.com/v1/web-search`

### Firebase Optional

- `FIREBASE_SERVICE_ACCOUNT_PATH=backend/secrets/firebase-service-account.json`
- or `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

### Frontend FCM

- `NEXT_PUBLIC_FIREBASE_API_KEY=...`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID=...`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...`
- `NEXT_PUBLIC_FIREBASE_APP_ID=...`
- `NEXT_PUBLIC_FIREBASE_VAPID_KEY=...`
- `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000`

## 7) Local Setup

### Backend

```bash
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
backend/.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

## 8) Firebase Cloud Messaging Setup (VAPID)

1. Open Firebase Console -> Project Settings -> Cloud Messaging.
2. Ensure Firebase Cloud Messaging API (v1) is enabled.
3. In Web Push certificates, create/get your VAPID key pair.
4. Add the public VAPID key to `frontend/.env.local` as `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
5. Restart frontend dev server.
6. Open Credon settings and click Enable Notifications.
7. Credon now auto-registers this browser token to backend (`/api/v1/notifications/token`).
8. Optional test from backend:

```bash
curl -X POST http://127.0.0.1:8000/api/v1/notifications/test ^
  -H "Content-Type: application/json" ^
  -d "{\"user_id\":\"your-user-id\",\"title\":\"Credon Test\",\"body\":\"Push is working\"}"
```

## 9) Firebase Hosting Step-by-Step

- Install CLI:

```bash
npm install -g firebase-tools
```

- Login:

```bash
firebase login
```

- Verify project alias file exists (`.firebaserc`) and points to `credonai`.
- Build frontend:

```bash
cd frontend
npm run build
```

- Deploy hosting from repo root:

```bash
cd ..
firebase deploy --only hosting
```

- Open Firebase Console -> Hosting and verify latest release.
- For auto deploy, keep using `.github/workflows/firebase-hosting-deploy.yml` on push to `main`.

## 10) Why Not Supabase as Primary Right Now?

- Credon already uses Firebase Auth + Firestore flows deeply in chat/session paths.
- Firestore integrates quickly for nested user/session/message documents.
- Existing fallback JSON files make local/offline dev easy with no extra infra.
- Supabase is still useful and the repo already has `backend/scripts/setup_supabase_pgvector.sql` for vector-oriented expansion.

If you want, Supabase can be introduced in phases:

1. Keep Auth + sessions on Firebase.
2. Move vectors/retrieval storage to Supabase pgvector.
3. Add a feature flag for storage backend (`firebase` vs `supabase`).
4. Gradually migrate chat/session storage once parity tests pass.

## 11) Autonomous Trainer Bot (Safe Mode)

Use `backend/scripts/autonomous_feedback_bot.py` with strict limits.

```bash
backend/.venv/Scripts/python.exe backend/scripts/autonomous_feedback_bot.py --base-url http://127.0.0.1:8000 --user-id trainer-bot --loops 6 --daily-cap 40 --hourly-cap 10 --max-downvotes-per-run 2 --chat-timeout-sec 35 --sleep-sec 2
```

Safety behavior:

- Dedicated user id (`trainer-bot`) avoids real-user session impact.
- Daily + hourly caps protect quota.
- Per-run downvote cap avoids noisy negative learning.
- Retries transient chat failures before marking loop failed.

## 12) Notes and Limits

- OCR quality depends on scan quality and Tesseract installation.
- Backend production deploy is separate from Firebase Hosting deploy.
- FCM delivery requires valid service account credentials on backend side for send operations.

## 13) Current Next Steps

1. Add your VAPID key into `frontend/.env.local` and restart frontend.
2. Run one notification enable flow and verify backend token registration in logs.
3. Run `/api/v1/notifications/test` to confirm push delivery.
4. Keep frontend auto-deploy through GitHub Action; deploy backend on your runtime host.
