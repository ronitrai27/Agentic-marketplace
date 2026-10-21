"""API request/response models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator

from crew.schemas import AnalysisResult
from crew.stages import STAGE_LABELS


class AnalyzeRequest(BaseModel):
    idea: str = Field(
        min_length=10,
        max_length=4000,
        description="The product/startup idea to verify and compare against the market.",
    )
    audience: str = Field(
        default="",
        max_length=400,
        description="Optional target audience, e.g. 'Indian D2C founders'.",
    )
    max_competitors: int | None = Field(
        default=None,
        ge=1,
        le=10,
        description="How many competitors to deep-analyse (default from MAX_COMPETITORS).",
    )

    @field_validator("idea", "audience")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class AnalysisSummary(BaseModel):
    id: str
    idea: str
    audience: str = ""
    status: str
    stage: str
    stage_label: str = ""
    error: str | None = None
    model: str | None = None
    search_provider: str | None = None
    created_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    competitor_count: int = 0
    recommendation: str | None = None
    overall_score: int | None = None


class AnalysisDetail(AnalysisSummary):
    result: AnalysisResult | None = None


class HealthResponse(BaseModel):
    status: str
    database: bool
    model: str
    llm_configured: bool
    search_provider: str
    search_configured: bool
    max_competitors: int


class DeleteResponse(BaseModel):
    deleted: bool


def summary_from(record: dict[str, Any]) -> AnalysisSummary:
    """Derive the list-view summary from a stored analysis record."""
    result = record.get("result") or {}
    verdict = result.get("verdict") or {}
    competitors = result.get("competitors") or []
    stage = record.get("stage") or "queued"
    return AnalysisSummary(
        id=str(record.get("id")),
        idea=record.get("idea") or "",
        audience=record.get("audience") or "",
        status=record.get("status") or "queued",
        stage=stage,
        stage_label=STAGE_LABELS.get(stage, stage.replace("_", " ").title()),
        error=record.get("error"),
        model=record.get("model"),
        search_provider=record.get("search_provider"),
        created_at=record.get("created_at"),
        started_at=record.get("started_at"),
        finished_at=record.get("finished_at"),
        competitor_count=len(competitors),
        recommendation=verdict.get("recommendation"),
        overall_score=verdict.get("overall_score"),
    )


def detail_from(record: dict[str, Any]) -> AnalysisDetail:
    summary = summary_from(record)
    raw_result = record.get("result")
    result: AnalysisResult | None = None
    if raw_result:
        try:
            result = AnalysisResult.model_validate(raw_result)
        except Exception:
            result = None
    return AnalysisDetail(**summary.model_dump(), result=result)
