from __future__ import annotations

import math
import time
from typing import Any, Dict, Optional

from .types import AttrDict

LimitsConfig = Dict[str, Any]


class BodyTooLargeError(Exception):
    def __init__(self, limit: int) -> None:
        super().__init__(f"Request body exceeds {limit} bytes")
        self.limit = limit


class LimitGuard:
    def __init__(self, cfg: Optional[Dict[str, Any]] = None) -> None:
        c = cfg or {}
        self._max_concurrent: Optional[int] = c.get("max_concurrent", c.get("maxConcurrent"))
        self._max_body_bytes: Optional[int] = c.get("max_body_bytes", c.get("maxBodyBytes"))
        self._rate_limit: Optional[Dict[str, Any]] = c.get("rate_limit", c.get("rateLimit"))
        self._trust_proxy: bool = bool(c.get("trust_proxy", c.get("trustProxy", False)))
        self._active = 0
        self._hits: Dict[str, Dict[str, int]] = {}

    @property
    def max_body_bytes(self) -> Optional[int]:
        return self._max_body_bytes

    @property
    def maxBodyBytes(self) -> Optional[int]:
        return self._max_body_bytes

    def admit(
        self,
        headers: Optional[Dict[str, Any]] = None,
        remote_addr: Optional[str] = None,
    ) -> Optional[AttrDict]:
        rl = self._rate_limit
        if rl and isinstance(rl, dict):
            now = int(time.time() * 1000)
            window_ms = int(rl.get("window_ms", rl.get("windowMs", 60_000)))
            max_req = int(rl.get("max", 60))
            key = self._client_key(headers or {}, remote_addr)
            hit = self._hits.get(key)
            if hit is None or hit["reset_at"] <= now:
                if len(self._hits) > 10_000:
                    self._prune(now)
                hit = {"count": 0, "reset_at": now + window_ms}
                self._hits[key] = hit
            if hit["count"] >= max_req:
                retry_sec = max(1, int(math.ceil((hit["reset_at"] - now) / 1000.0)))
                return AttrDict(
                    status=429,
                    code="RATE_LIMITED",
                    message="Too many requests",
                    retry_after_sec=retry_sec,
                    retryAfterSec=retry_sec,
                )
            hit["count"] += 1

        if self._max_concurrent is not None and self._active >= int(self._max_concurrent):
            return AttrDict(
                status=429,
                code="SERVER_BUSY",
                message="Agent is at max concurrency",
                retry_after_sec=1,
                retryAfterSec=1,
            )
        self._active += 1
        return None

    def release(self) -> None:
        if self._active > 0:
            self._active -= 1

    def _client_key(self, headers: Dict[str, Any], remote_addr: Optional[str]) -> str:
        if self._trust_proxy:
            fwd = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For")
            if isinstance(fwd, list):
                fwd = fwd[0] if fwd else None
            if isinstance(fwd, str):
                first = fwd.split(",")[0].strip()
                if first:
                    return first
        return remote_addr or "unknown"

    def _prune(self, now: int) -> None:
        expired = [k for k, v in self._hits.items() if v["reset_at"] <= now]
        for k in expired:
            self._hits.pop(k, None)

