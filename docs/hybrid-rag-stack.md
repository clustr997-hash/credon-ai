# Credon Hybrid Stack (Free/Low-Cost) — RAG + PGVector + Web Page Index

This guide is for improving Credon AI quality while staying student-budget friendly.

## Goal

Build a **hybrid answer pipeline**:

1. **Conversation memory** (your prior chat context)
2. **Campus knowledge RAG** (your syllabus, notes, cheat sheets)
3. **Fresh web retrieval** (for current/latest info)
4. **Answer quality checks** (relevance + groundedness)

This is similar to how strong AI products combine memory + retrieval + model routing.

---

## Recommended Core Stack (Budget-Friendly)

## 1) Vector + Metadata Store

Use **Postgres + PGVector** (you already have the foundation).

- Why: single DB for structured data + embeddings + filters.
- Best for your use case: university / semester / branch / subject filtering.
- Cost: can start on free tiers or local Postgres.

### Schema metadata to keep per chunk

- `university`
- `branch`
- `semester`
- `subject`
- `doc_type` (`notes`, `cheat_sheet`, `pyq`, `assignment`)
- `visibility` (`private`, `classroom`, `public`)
- `source_url` (if web)
- `quality_score` (optional)

---

## 2) Embeddings

Start with one stable embedding model and do not switch frequently.

Options:
- Free local: `bge-small` / `nomic-embed-text` via Ollama
- API free tiers (if available): use only if stable for your region and limits

Rule:
- One embedding model per index version.
- If changed, re-index all chunks.

---

## 3) Web Retrieval + Page Index Layer

Use a two-step web system:

1. **Search API layer** (DDG first; LangSearch/Serper optional)
2. **Page extraction/index layer** (Trafilatura + mini page cache/index)

### What is “page index” in practical terms?

A local table/cache where you store:
- URL
- cleaned page text
- extracted key sections
- timestamp (for freshness)
- embedding of extracted text

Then future related queries can reuse this page content without re-fetching every time.

Benefits:
- Faster repeated answers
- Lower API calls
- More consistent relevance

---

## 4) Retrieval Strategy (Hybrid)

For every user query, run this order:

1. **Intent routing**
   - If follow-up like “tell me more”: expand from previous assistant answer first.
   - If personal memory query: use chat memory path.

2. **Campus RAG retrieval**
   - Filter by metadata (`semester`, `subject`, etc.)
   - Vector search top-k

3. **Web retrieval (conditional)**
   - Only if query needs latest/current/external info.

4. **Merge and rerank**
   - Prefer same-subject, same-semester docs
   - Keep max 5–8 final sources

5. **Generate answer with citations**
   - Show where answer came from: class notes vs web source

---

## 5) Model Routing (Free-First)

Use a tiered route:

- Fast route: small/cheap model for simple prompts
- Quality route: stronger model for complex prompts
- Fallback route: Credon brain + retrieval synthesis if model unavailable

You can keep this policy simple:
- Short/simple => fast model
- Long/complex/multi-step => stronger model
- Follow-up context => no web unless explicit

---

## 6) APIs/Services You Can Use

### Essential (start here)
- **Postgres + PGVector**
- **DDG search** (free path)
- **Trafilatura** for page extraction
- **Firestore/Auth** for user sessions (or Postgres unified)

### Optional additions
- **LangSearch / Serper** for better web coverage
- **Cloudflare Tunnel** for mobile testing from device
- **Sentry** (free tier) for error monitoring
- **Plausible/Umami** (self-hosted analytics) for basic product telemetry

---

## 7) Quality Controls (Why ChatGPT-like apps feel better)

You need evaluation loops, not just model changes.

Track these for every answer:
- relevance score
- groundedness (is claim supported by retrieved context?)
- latency (first token + full answer)
- user vote (thumbs up/down)

Weekly workflow:
1. collect bad examples
2. categorize failure (routing/retrieval/generation)
3. patch one layer
4. rerun eval set
5. deploy only if quality improved

---

## 8) Safe Rollout Plan (Do not disrupt production)

Phase 1 (No-risk):
- Add telemetry + logs + route metadata
- Add follow-up routing fixes

Phase 2 (Controlled):
- Add metadata filters for campus docs
- Add page index cache table

Phase 3 (Optimization):
- Add reranking and route tuning
- Add A/B test for answer quality

Feature flags to keep:
- `ENABLE_PAGE_EXTRACTION`
- `ENABLE_PAGE_INDEX_CACHE`
- `ENABLE_WEB_FOR_FOLLOWUPS` (default false)
- `ENABLE_RERANK`

---

## 9) Mobile Testing Before Deploy

Yes, you can test localhost on mobile using LAN IP.

1. Run frontend/backend on `0.0.0.0`.
2. Get laptop IP (example `192.168.1.20`).
3. Open on phone: `http://192.168.1.20:3000`.
4. Ensure API points to `http://192.168.1.20:8000`.
5. Test checklist:
   - history persists
   - follow-up (“tell me more”) stays in context
   - no irrelevant source drift

If same Wi-Fi is not possible, use Cloudflare Tunnel.

---

## 10) What to Build First (Highest Impact)

1. Follow-up routing correctness
2. Durable chat/session storage
3. Metadata-first campus RAG filters
4. Page index cache for web pages
5. Evaluation dashboard

This order gives best quality gain without breaking current behavior.
