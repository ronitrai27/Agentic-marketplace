from __future__ import annotations

import inspect
import json
import math
from typing import Any, Dict, Optional

from ..jobstore import DEFAULT_JOB_TTL_MS, normalize_stored_job
from ..types import AttrDict


async def _maybe_await(val: Any) -> Any:
    if inspect.isawaitable(val):
        return await val
    return val


class RedisJobStore:
    """
    Redis-backed job store. Works with both sync (`redis.Redis`) and async (`redis.asyncio.Redis`)
    clients, or any duck-typed object providing `get`, `set`, and `expire`.
    """

    def __init__(
        self,
        client: Any,
        options: Optional[Dict[str, Any]] = None,
        *,
        prefix: Optional[str] = None,
        ttl_ms: Optional[int] = None,
        ttlMs: Optional[int] = None,
    ) -> None:
        opts = options or {}
        self._client = client
        self._prefix = prefix or opts.get("prefix") or "catelog:job:"
        t_ms = (
            ttl_ms
            if ttl_ms is not None
            else (
                ttlMs
                if ttlMs is not None
                else opts.get("ttl_ms", opts.get("ttlMs", DEFAULT_JOB_TTL_MS))
            )
        )
        self._ttl_seconds = max(1, int(math.ceil(float(t_ms) / 1000.0)))

    async def get(self, run_id: str) -> Optional[AttrDict]:
        key = self._prefix + run_id
        fn = self._client["get"] if isinstance(self._client, dict) else getattr(self._client, "get")
        raw = await _maybe_await(fn(key))
        if not raw:
            return None
        if isinstance(raw, (bytes, bytearray)):
            raw = raw.decode("utf-8")
        return normalize_stored_job(json.loads(raw))

    async def set(self, job: Dict[str, Any]) -> None:
        norm = normalize_stored_job(job)
        rid = str(norm.get("runId") or norm.get("run_id"))
        key = self._prefix + rid
        payload = json.dumps(norm, default=str)

        set_fn = self._client["set"] if isinstance(self._client, dict) else getattr(self._client, "set")
        exp_fn = (
            self._client["expire"] if isinstance(self._client, dict) else getattr(self._client, "expire")
        )
        await _maybe_await(set_fn(key, payload))
        await _maybe_await(exp_fn(key, self._ttl_seconds))

    async def close(self) -> None:
        return None

