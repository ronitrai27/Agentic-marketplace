"""PostgreSQL persistence with a graceful in-memory fallback.

Same contract as the other agents in this repo: the API keeps answering even
when the database is down — analyses still run, they just live in memory until
Postgres comes back.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .config import settings

_memory: dict[str, dict] = {}
_memory_lock = threading.Lock()
_db_ok: bool | None = None  # None = never checked yet
_MAX_MEMORY_RECORDS = 50


# ─────────────────────────── helpers ───────────────────────────

def now() -> datetime:
    return datetime.now(timezone.utc)


@contextmanager
def _connection() -> Iterator[psycopg.Connection]:
    with psycopg.connect(
        settings.database_url, row_factory=dict_row, connect_timeout=3
    ) as connection:
        yield connection


def _mark_database(ok: bool) -> None:
    global _db_ok
    _db_ok = ok


def _public(row: dict | None) -> dict | None:
    """Normalise a row (DB or memory) into JSON-safe values."""
    if row is None:
        return None
    record = dict(row)
    for key, value in list(record.items()):
        if isinstance(value, datetime):
            record[key] = value.isoformat()
    return record


def _remember(record: dict) -> None:
    with _memory_lock:
        _memory[record["id"]] = record
        while len(_memory) > _MAX_MEMORY_RECORDS:
            _memory.pop(next(iter(_memory)))


def _column_updates(fields: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Build a safe ``SET`` clause — column names come from our own code only."""
    assignments = []
    values: dict[str, Any] = {}
    for key, value in fields.items():
        assignments.append(f"{key} = %({key})s")
        values[key] = Jsonb(value) if key == "result" and value is not None else value
    return ", ".join(assignments), values


# ─────────────────────────── lifecycle ───────────────────────────

def ping() -> bool:
    """Cheap liveness probe used by /api/health."""
    global _db_ok
    try:
        with _connection() as connection:
            connection.execute("SELECT 1")
        _mark_database(True)
    except Exception:
        _mark_database(False)
    return _db_ok


def available() -> bool:
    return bool(_db_ok)


def create_analysis(record: dict) -> dict:
    _remember(record)
    try:
        with _connection() as connection:
            connection.execute(
                """
                INSERT INTO analyses
                  (id, idea, audience, status, stage, result, error,
                   model, search_provider, created_at, started_at, finished_at)
                VALUES
                  (%(id)s, %(idea)s, %(audience)s, %(status)s, %(stage)s, %(result)s,
                   %(error)s, %(model)s, %(search_provider)s, %(created_at)s,
                   %(started_at)s, %(finished_at)s)
                """,
                {
                    **record,
                    "result": Jsonb(record.get("result")),
                },
            )
        _mark_database(True)
    except Exception:
        _mark_database(False)
    return _public(record)


def update_analysis(analysis_id: str, **fields: Any) -> None:
    with _memory_lock:
        stored = _memory.get(analysis_id)
        if stored is not None:
            stored.update(fields)

    if not fields:
        return
    set_clause, values = _column_updates(fields)
    try:
        with _connection() as connection:
            connection.execute(
                f"UPDATE analyses SET {set_clause} WHERE id = %(id)s",
                {**values, "id": analysis_id},
            )
        _mark_database(True)
    except Exception:
        _mark_database(False)


def get_analysis(analysis_id: str) -> dict | None:
    try:
        with _connection() as connection:
            row = connection.execute(
                "SELECT * FROM analyses WHERE id = %s", (analysis_id,)
            ).fetchone()
        _mark_database(True)
        if row is not None:
            return _public(row)
    except Exception:
        _mark_database(False)

    with _memory_lock:
        stored = _memory.get(analysis_id)
        return _public(dict(stored)) if stored else None


def list_analyses(limit: int = 20) -> list[dict]:
    try:
        with _connection() as connection:
            rows = connection.execute(
                "SELECT * FROM analyses ORDER BY created_at DESC LIMIT %s", (limit,)
            ).fetchall()
        _mark_database(True)
        return [_public(row) for row in rows]
    except Exception:
        _mark_database(False)

    with _memory_lock:
        records = sorted(
            (_public(dict(item)) for item in _memory.values()),
            key=lambda item: item.get("created_at") or "",
            reverse=True,
        )
    return records[:limit]


def delete_analysis(analysis_id: str) -> bool:
    with _memory_lock:
        _memory.pop(analysis_id, None)
    try:
        with _connection() as connection:
            cursor = connection.execute(
                "DELETE FROM analyses WHERE id = %s", (analysis_id,)
            )
            rowcount = cursor.rowcount
        _mark_database(True)
        return rowcount > 0
    except Exception:
        _mark_database(False)
        return False


# ─────────────────────────── children ───────────────────────────

def save_competitors(analysis_id: str, competitors: list[dict]) -> None:
    if not competitors:
        return
    try:
        with _connection() as connection:
            connection.execute("DELETE FROM competitors WHERE analysis_id = %s", (analysis_id,))
            for position, rival in enumerate(competitors):
                connection.execute(
                    """
                    INSERT INTO competitors
                      (id, analysis_id, position, name, website, one_liner, what_they_do,
                       how_they_do_it, pricing_model, target_users, threat_level,
                       strengths, weaknesses, sources)
                    VALUES
                      (%(id)s, %(analysis_id)s, %(position)s, %(name)s, %(website)s,
                       %(one_liner)s, %(what_they_do)s, %(how_they_do_it)s, %(pricing_model)s,
                       %(target_users)s, %(threat_level)s, %(strengths)s, %(weaknesses)s,
                       %(sources)s)
                    """,
                    {
                        "id": str(uuid4()),
                        "analysis_id": analysis_id,
                        "position": position,
                        "name": rival.get("name") or "unknown",
                        "website": rival.get("website") or "",
                        "one_liner": rival.get("one_liner") or "",
                        "what_they_do": rival.get("what_they_do") or "",
                        "how_they_do_it": rival.get("how_they_do_it") or "",
                        "pricing_model": rival.get("pricing_model") or "",
                        "target_users": rival.get("target_users") or "",
                        "threat_level": rival.get("threat_level") or "",
                        "strengths": Jsonb(rival.get("strengths") or []),
                        "weaknesses": Jsonb(rival.get("weaknesses") or []),
                        "sources": Jsonb(rival.get("sources") or []),
                    },
                )
        _mark_database(True)
    except Exception:
        _mark_database(False)


def log_search(
    analysis_id: str | None,
    query: str,
    provider: str,
    result_count: int,
    ok: bool,
    error: str | None = None,
) -> None:
    """Audit trail of every web search — wired into the crew tool at startup."""
    try:
        with _connection() as connection:
            connection.execute(
                """
                INSERT INTO search_queries (analysis_id, query, provider, result_count, ok, error)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (analysis_id, query, provider, result_count, ok, error),
            )
        _mark_database(True)
    except Exception:
        _mark_database(False)
