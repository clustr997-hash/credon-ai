# Credon AI MVP (Step 1)

## One-line Goal
Credon AI is a chat application that answers using live web sources with citations in English or Hinglish.

## Target User
Students and learners who want quick, source-backed answers.

## MVP Features (v1)
1. User authentication (Firebase Auth)
2. Chat interface (ChatGPT-style layout)
3. English + Hinglish input and output
4. Live web retrieval (top 5 results)
5. Source citations under each answer
6. Basic conversation memory
7. Confidence indicator (Low/Medium/High)
8. Chat history save and restore

## Out of Scope (v1)
- Training a foundation model
- Blockchain features
- Multi-cloud failover orchestration
- Image generation
- Enterprise governance workflows

## Success Metrics
- At least 80% answers include >= 2 sources
- Average response time under 12 seconds
- Hinglish questions answered in Hinglish style
- Lower hallucination rate compared to no-retrieval baseline

## Core User Flows
1. User signs in -> asks question -> gets answer with citations
2. User opens old chat -> continues with context memory
3. User asks in Hinglish -> receives Hinglish answer with sources

## MVP Product Rules
- Retrieval-first, not pretraining-first
- Factual answers should include source links
- If sources conflict, present both perspectives
- Keep v1 simple and shippable in 2 to 3 weeks
