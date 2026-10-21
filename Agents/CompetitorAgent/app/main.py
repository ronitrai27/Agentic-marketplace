"""Competitor Agent API — FastAPI + vanilla frontend.

Serves the UI from ``public/`` and a small JSON API. Analyses run in a
background worker thread while the frontend polls for progress.
"""

from __future__ import annotations

import logging
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from crew.stages import STAGE_LABELS

from . import db, runner
from .config import settings
from .models import (
    AnalysisDetail,
    AnalysisSummary,
    AnalyzeRequest,
    DeleteResponse,
    HealthResponse,
    detail_from,
    summary_from,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger("competitor.api")

PUBLIC_DIR = Path(__file__).resolve().parents[1] / "public"

app = FastAPI(
    title="Competitor Agent API",
    version="1.0.0",
    description="Verify a product idea, find its competitors, and see what they do and how.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# ──────────────────────────── API ────────────────────────────

@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        database=db.ping(),
        model=settings.model,
        llm_configured=settings.llm_configured,
        search_provider=settings.search_provider,
        search_configured=settings.search_configured,
        max_competitors=settings.max_competitors,
    )

@app.post("/api/analyze", response_model=AnalysisSummary, status_code=202)
def analyze(payload: AnalyzeRequest) -> AnalysisSummary:
    if not settings.llm_configured:
        raise HTTPException(
            status_code=503,
            detail=(
                f"No LLM key configured for model {settings.model!r}. "
                "Copy .env.example to .env and set OPENAI_API_KEY."
            ),
        )

    analysis_id = str(uuid4())
    record = {
        "id": analysis_id,
        "idea": payload.idea,
        "audience": payload.audience,
        "status": "queued",
        "stage": "queued",
        "result": None,
        "error": None,
        "model": settings.model,
        "search_provider": settings.search_provider if settings.search_configured else "none",
        "created_at": db.now(),
        "started_at": None,
        "finished_at": None,
    }
    stored = db.create_analysis(record)  # returns the JSON-safe record

    runner.submit(
        analysis_id,
        idea=payload.idea,
        audience=payload.audience,
        max_competitors=payload.max_competitors or settings.max_competitors,
    )
    logger.info("queued analysis %s", analysis_id)
    return summary_from(stored)


@app.get("/api/analyses", response_model=list[AnalysisSummary])
def list_analyses(limit: int = Query(default=20, ge=1, le=100)) -> list[AnalysisSummary]:
    return [summary_from(row) for row in db.list_analyses(limit)]


@app.get("/api/analyses/{analysis_id}", response_model=AnalysisDetail)
def get_analysis(analysis_id: str) -> AnalysisDetail:
    record = db.get_analysis(analysis_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return detail_from(record)


@app.delete("/api/analyses/{analysis_id}", response_model=DeleteResponse)
def delete_analysis(analysis_id: str) -> DeleteResponse:
    return DeleteResponse(deleted=db.delete_analysis(analysis_id))


@app.get("/api/stages")
def stages() -> dict[str, str]:
    return STAGE_LABELS


# ──────────────────────── UI (registered last) ────────────────────────

@app.get("/api")
def api_root() -> dict[str, str]:
    return {"service": "competitor-agent", "docs": "/docs", "health": "/api/health"}


app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="static")
