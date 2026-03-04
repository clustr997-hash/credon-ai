# Credon AI API Contract (Step 1)

## Base
- Local dev base URL: http://localhost:8000
- Version: v1

## Endpoints

### GET /health
Purpose: Liveness check

Response 200
```json
{
  "status": "ok"
}
```

### POST /api/v1/chat
Purpose: Ask a question and receive grounded answer

Request
```json
{
  "user_id": "string",
  "session_id": "string",
  "query": "string",
  "language": "auto | en | hinglish"
}
```

Response 200
```json
{
  "answer": "string",
  "language": "en | hinglish",
  "confidence": "low | medium | high",
  "sources": [
    {
      "title": "string",
      "url": "string"
    }
  ],
  "latency_ms": 0
}
```

### GET /api/v1/chats/{user_id}
Purpose: List user chat sessions

### GET /api/v1/chats/{user_id}/{session_id}
Purpose: Retrieve a full chat transcript

## Error Shape
```json
{
  "error": {
    "code": "string",
    "message": "string"
  }
}
```

## Notes
- Source URLs must be returned for grounded answers.
- If no strong sources are found, API should explicitly indicate low confidence.
