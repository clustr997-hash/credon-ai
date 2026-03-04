from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from dotenv import load_dotenv
from pathlib import Path
import os
from app.routes.chat import router as chat_router
from app.routes.ingest import router as ingest_router

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

app = FastAPI(
    title="Credon AI API",
    version="0.1.0",
    description=(
        "Credon AI — Intelligent Research Assistant API.\n\n"
        "Provides chat (streaming + sync), knowledge ingestion, "
        "model listing, session history, and feedback endpoints.\n\n"
        "**Base path:** `/api/v1`"
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)


def _cors_origins() -> list[str]:
    configured = os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    )
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_origin_regex=os.getenv(
        "CORS_ALLOW_ORIGIN_REGEX",
        r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$",
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(chat_router, prefix="/api/v1", tags=["Chat"])
app.include_router(ingest_router, prefix="/api/v1", tags=["Ingest"])


@app.get("/", include_in_schema=False)
def root():
    """Redirect root to API docs."""
    return RedirectResponse(url="/docs")


@app.get("/health", tags=["System"])
def health() -> dict[str, str]:
    """Health check endpoint."""
    return {"status": "ok"}
