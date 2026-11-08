from __future__ import annotations

import time
import uuid
from typing import Any, Dict, Optional

from .telemetry import TelemetryCollector, create_logger, create_telemetry_collector
from .types import (
    NEED_INPUT_SYMBOL,
    AbortSignal,
    AgentExecutionContext,
    AgentSession,
    AttrDict,
    to_attr_dict,
)
from .usage import UsageTracker, bind_tracker

# ─────────────────────────────────────────────────
#  In-Memory Session Store (Multi-Turn Conversations)
# ─────────────────────────────────────────────────

_session_store: Dict[str, Dict[str, Any]] = {}
SESSION_TTL_MS = 30 * 60 * 1000  # 30 minutes default
_last_cleanup_ms = 0


def _cleanup_expired_sessions() -> None:
    global _last_cleanup_ms
    now_ms = int(time.time() * 1000)
    if now_ms - _last_cleanup_ms < 60_000:
        return
    _last_cleanup_ms = now_ms
    expired = [k for k, v in _session_store.items() if v.get("expires_at", 0) < now_ms]
    for k in expired:
        _session_store.pop(k, None)


def _get_or_create_session(session_id: str) -> Dict[str, Any]:
    _cleanup_expired_sessions()
    now_ms = int(time.time() * 1000)
    existing = _session_store.get(session_id)
    if existing is not None and existing.get("expires_at", 0) >= now_ms:
        existing["expires_at"] = now_ms + SESSION_TTL_MS
        return existing["data"]
    data: Dict[str, Any] = {}
    _session_store[session_id] = {"data": data, "expires_at": now_ms + SESSION_TTL_MS}
    return data


def build_execution_context(
    options: Optional[Dict[str, Any]] = None,
    *,
    run_id: Optional[str] = None,
    runId: Optional[str] = None,
    input: Any = None,
    stream: Any = None,
    signal: Optional[AbortSignal] = None,
    metadata: Optional[Dict[str, Any]] = None,
    deadline_ms: Optional[int] = None,
    deadlineMs: Optional[int] = None,
    resume_token: Optional[str] = None,
    resumeToken: Optional[str] = None,
    input_bytes: Optional[int] = None,
    inputBytes: Optional[int] = None,
) -> AttrDict:
    opts = options or {}
    rid = str(run_id or runId or opts.get("run_id") or opts.get("runId") or "")
    inp = input if input is not None else opts.get("input")
    if isinstance(inp, dict) and not isinstance(inp, AttrDict):
        inp = to_attr_dict(inp)
    strm = stream if stream is not None else opts.get("stream")
    sig = signal if signal is not None else opts.get("signal") or AbortSignal()
    meta = metadata if metadata is not None else opts.get("metadata")
    dl = (
        deadline_ms
        if deadline_ms is not None
        else (deadlineMs if deadlineMs is not None else opts.get("deadline_ms", opts.get("deadlineMs")))
    )
    rt = (
        resume_token
        if resume_token is not None
        else (resumeToken if resumeToken is not None else opts.get("resume_token", opts.get("resumeToken")))
    )
    ib = (
        input_bytes
        if input_bytes is not None
        else (inputBytes if inputBytes is not None else opts.get("input_bytes", opts.get("inputBytes", 0)))
    )

    log = create_logger(rid)
    tracker = UsageTracker()
    telemetry_collector = create_telemetry_collector(input_bytes=int(ib), tracker=tracker)
    metric = telemetry_collector.get_metric_helper()

    session_id = str((meta.get("session_id") if isinstance(meta, dict) else None) or rid)
    session_data = _get_or_create_session(session_id)

    def need_input(
        opts_arg: Optional[Dict[str, Any]] = None,
        *,
        prompt: Optional[str] = None,
        schema: Optional[Dict[str, Any]] = None,
        continuation: Optional[bool] = None,
    ) -> AttrDict:
        o = opts_arg or {}
        p = prompt if prompt is not None else str(o.get("prompt") or "")
        s = schema if schema is not None else o.get("schema")
        c = continuation if continuation is not None else o.get("continuation")

        token = f"resume_{uuid.uuid4().hex[:16]}"
        session_data["_resumeToken"] = token
        session_data["_needInputOpts"] = {"prompt": p, "schema": s, "continuation": c}
        _session_store[session_id] = {
            "data": session_data,
            "expires_at": int(time.time() * 1000) + SESSION_TTL_MS,
        }

        res: Dict[str, Any] = {
            NEED_INPUT_SYMBOL: True,
            "prompt": p,
        }
        if s is not None:
            res["schema"] = s
        if c is not None:
            res["continuation"] = c
        return AttrDict(res)

    ctx = AgentExecutionContext(
        run_id=rid,
        input=inp,
        stream=strm,
        signal=sig,
        log=log,
        metric=metric,
        usage=tracker.facade(),
        need_input=need_input,
        session=AgentSession(session_data),
        metadata=meta,
        deadline_ms=dl,
        resume_token=rt,
    )

    bind_tracker(ctx, tracker)
    return AttrDict(
        ctx=ctx,
        telemetry_collector=telemetry_collector,
        telemetryCollector=telemetry_collector,
        tracker=tracker,
    )


buildExecutionContext = build_execution_context

