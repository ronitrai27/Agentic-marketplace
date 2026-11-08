from __future__ import annotations

import time
from typing import Any, Dict, Optional, Protocol

from .types import AttrDict, to_attr_dict

DEFAULT_JOB_TTL_MS = 3_600_000


def normalize_stored_job(job: Dict[str, Any]) -> AttrDict:
    d = dict(job)
    if "runId" in d and "run_id" not in d:
        d["run_id"] = d["runId"]
    elif "run_id" in d and "runId" not in d:
        d["runId"] = d["run_id"]

    if "createdAt" in d and "created_at" not in d:
        d["created_at"] = d["createdAt"]
    elif "created_at" in d and "createdAt" not in d:
        d["createdAt"] = d["created_at"]

    if "updatedAt" in d and "updated_at" not in d:
        d["updated_at"] = d["updatedAt"]
    elif "updated_at" in d and "updatedAt" not in d:
        d["updatedAt"] = d["updated_at"]

    if "durationMs" in d and "duration_ms" not in d:
        d["duration_ms"] = d["durationMs"]
    elif "duration_ms" in d and "durationMs" not in d:
        d["durationMs"] = d["duration_ms"]

    if "currentStep" in d and "current_step" not in d:
        d["current_step"] = d["currentStep"]
    elif "current_step" in d and "currentStep" not in d:
        d["currentStep"] = d["current_step"]

    if "progressPct" in d and "progress_pct" not in d:
        d["progress_pct"] = d["progressPct"]
    elif "progress_pct" in d and "progressPct" not in d:
        d["progressPct"] = d["progress_pct"]

    if "lastSeq" in d and "last_seq" not in d:
        d["last_seq"] = d["lastSeq"]
    elif "last_seq" in d and "lastSeq" not in d:
        d["lastSeq"] = d["last_seq"]

    return to_attr_dict(d)


StoredJob = AttrDict


class JobStore(Protocol):
    async def get(self, run_id: str) -> Optional[AttrDict]: ...
    async def set(self, job: Dict[str, Any]) -> None: ...
    async def close(self) -> None: ...


class MemoryJobStore:
    """In-memory job store (default for `mode="async"`)."""

    def __init__(self, ttl_ms: int = DEFAULT_JOB_TTL_MS) -> None:
        self._jobs: Dict[str, AttrDict] = {}
        self._ttl_ms = ttl_ms
        self._last_sweep = int(time.time() * 1000)

    def _maybe_sweep(self) -> None:
        now = int(time.time() * 1000)
        if now - self._last_sweep < 300_000:
            return
        self._last_sweep = now
        cutoff = now - self._ttl_ms
        expired = [
            jid
            for jid, j in self._jobs.items()
            if (j.get("createdAt") or j.get("created_at") or 0) < cutoff
        ]
        for jid in expired:
            self._jobs.pop(jid, None)

    async def get(self, run_id: str) -> Optional[AttrDict]:
        self._maybe_sweep()
        return self._jobs.get(run_id)

    async def set(self, job: Dict[str, Any]) -> None:
        self._maybe_sweep()
        norm = normalize_stored_job(job)
        rid = str(norm.get("runId") or norm.get("run_id"))
        self._jobs[rid] = norm

    async def close(self) -> None:
        return None

