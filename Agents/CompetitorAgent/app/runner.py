"""Background execution of one analysis.

Runs the four crew stages sequentially and checkpoints the partial result after
each stage, so the UI shows live progress and a mid-run failure still leaves
whatever was already learned.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from . import db
from .config import settings

logger = logging.getLogger("competitor.runner")

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="competitor-run")


def submit(analysis_id: str, idea: str, audience: str, max_competitors: int) -> None:
    """Queue the analysis; returns immediately."""
    _executor.submit(_run, analysis_id, idea, audience, max_competitors)


def _checkpoint(analysis_id: str, next_stage: str, result) -> None:
    db.update_analysis(
        analysis_id,
        stage=next_stage,
        result=result.model_dump(),
    )


def _merge(scout, analyst, max_competitors: int):
    """Analyse the analyst's detail with the scout's URLs, de-duplicated."""
    scout_by_name = {c.name.strip().casefold(): c for c in scout.competitors}
    merged: list = []
    seen: set[str] = set()

    for rival in analyst.competitors:
        key = rival.name.strip().casefold()
        if not key or key in seen:
            continue
        seen.add(key)
        shortlist_entry = scout_by_name.get(key)
        if shortlist_entry:
            rival.website = rival.website or shortlist_entry.website
            rival.one_liner = rival.one_liner or shortlist_entry.one_liner
            if shortlist_entry.source_url and shortlist_entry.source_url not in rival.sources:
                rival.sources.append(shortlist_entry.source_url)
        merged.append(rival)
        if len(merged) >= max_competitors:
            break

    return merged


def _clean_error(exc: BaseException) -> str:
    text = f"{type(exc).__name__}: {exc}".strip()
    return text[:1000]


def _run(analysis_id: str, idea: str, audience: str, max_competitors: int) -> None:
    # Deferred: crewai + litellm take seconds to import, and the API should be
    # serving /api/health before that happens.
    from crew import tools
    from crew.crew import (
        run_competitor_analysis,
        run_scout,
        run_validation,
        run_verdict,
    )
    from crew.schemas import AnalysisResult

    tools.set_run_id(analysis_id)
    tools.set_search_logger(db.log_search)

    result = AnalysisResult(
        idea=idea,
        audience=audience,
        model=settings.model,
        search_provider=settings.search_provider if settings.search_configured else "none",
    )
    warnings: list[str] = []
    if not settings.search_configured:
        warnings.append(
            "TinyFish is not configured (set TINYFISH_API_KEY, or run "
            "`npx @tiny-fish/cli connect`) — the crew answered from model knowledge only."
        )

    db.update_analysis(
        analysis_id,
        status="running",
        stage="validating",
        started_at=db.now(),
        model=settings.model,
        search_provider=result.search_provider,
    )

    try:
        validation = run_validation(idea, audience)
        result.validation = validation
        _checkpoint(analysis_id, "scouting", result)

        scout = run_scout(validation, max_competitors)
        if not scout.competitors:
            warnings.append(
                "The scout found no clear competitors — treat the verdict as directional."
            )
        _checkpoint(analysis_id, "analysing", result)

        analyst = run_competitor_analysis(validation, scout)
        result.competitors = _merge(scout, analyst, max_competitors)
        _checkpoint(analysis_id, "verdict", result)

        result.verdict = run_verdict(validation, result.competitors, audience)
        result.warnings = warnings

        db.update_analysis(
            analysis_id,
            status="completed",
            stage="completed",
            result=result.model_dump(),
            finished_at=db.now(),
            error=None,
        )
        db.save_competitors(
            analysis_id, [rival.model_dump() for rival in result.competitors]
        )
        logger.info("analysis %s completed with %d competitors", analysis_id, len(result.competitors))

    except Exception as exc:  # noqa: BLE001 — one run must never kill the worker
        logger.exception("analysis %s failed", analysis_id)
        result.warnings = warnings
        db.update_analysis(
            analysis_id,
            status="failed",
            stage="failed",
            result=result.model_dump(),
            error=_clean_error(exc),
            finished_at=db.now(),
        )
