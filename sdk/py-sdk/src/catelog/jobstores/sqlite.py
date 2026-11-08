from __future__ import annotations

import json
import sqlite3
import time
from typing import Any, Dict, Optional

from ..jobstore import DEFAULT_JOB_TTL_MS, normalize_stored_job
from ..types import AttrDict


class SqliteJobStore:
    """
    SQLite-backed job store using Python's built-in `sqlite3` (zero extra dependencies).
    Survives restarts when the file lives on a persistent volume.
    """

    def __init__(
        self,
        options: Optional[Dict[str, Any]] = None,
        *,
        path: Optional[str] = None,
        ttl_ms: Optional[int] = None,
        ttlMs: Optional[int] = None,
    ) -> None:
        opts = options or {}
        self._path: str = path or opts.get("path") or "./catelog-jobs.db"
        self._ttl_ms: int = int(
            ttl_ms
            if ttl_ms is not None
            else (
                ttlMs
                if ttlMs is not None
                else opts.get("ttl_ms", opts.get("ttlMs", DEFAULT_JOB_TTL_MS))
            )
        )
        self._conn: Optional[sqlite3.Connection] = None
        self._last_sweep: int = 0

    def _open(self) -> sqlite3.Connection:
        if self._conn is not None:
            return self._conn
        conn = sqlite3.connect(self._path, check_same_thread=False)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS catelog_jobs ("
            "run_id TEXT PRIMARY KEY, "
            "created_at INTEGER NOT NULL, "
            "data TEXT NOT NULL)"
        )
        conn.commit()
        self._conn = conn
        return conn

    async def get(self, run_id: str) -> Optional[AttrDict]:
        conn = self._open()
        cur = conn.execute("SELECT data FROM catelog_jobs WHERE run_id = ?", (run_id,))
        row = cur.fetchone()
        if not row:
            return None
        return normalize_stored_job(json.loads(row[0]))

    async def set(self, job: Dict[str, Any]) -> None:
        conn = self._open()
        norm = normalize_stored_job(job)
        rid = str(norm.get("runId") or norm.get("run_id"))
        created_at = int(norm.get("createdAt") or norm.get("created_at") or int(time.time() * 1000))
        conn.execute(
            "INSERT OR REPLACE INTO catelog_jobs (run_id, created_at, data) VALUES (?, ?, ?)",
            (rid, created_at, json.dumps(norm, default=str)),
        )
        now = int(time.time() * 1000)
        if now - self._last_sweep > 300_000:
            self._last_sweep = now
            conn.execute("DELETE FROM catelog_jobs WHERE created_at < ?", (now - self._ttl_ms,))
        conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

