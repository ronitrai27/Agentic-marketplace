from __future__ import annotations

import asyncio
import inspect
import json
import math
import re
import time
import urllib.parse
import uuid
from typing import Any, Callable, Dict, List, Optional, Union

from .context import build_execution_context
from .jobstore import MemoryJobStore, normalize_stored_job
from .limits import BodyTooLargeError, LimitGuard
from .schema import to_json_schema, validate_schema_data
from .security import SecurityManager, SecurityVerificationError
from .server import CatelogServer, IncomingHttpRequest, OutgoingHttpResponse, start_agent_server
from .sse import BufferedStream, NoopStream, SSEWriter
from .telemetry import TelemetryReporter
from .types import (
    NEED_INPUT_SYMBOL,
    PROTOCOL_VERSION,
    AbortController,
    AgentExecutionContext,
    AttrDict,
    ExecutionMode,
    to_attr_dict,
)
from .usage import get_bound_tracker, reset_current_tracker, set_current_tracker, unbind_tracker

HEARTBEAT_MS = 5_000
STALE_JOB_MS = 20_000

CatelogAgentConfig = Dict[str, Any]
MarketplaceAgentConfig = CatelogAgentConfig


class ExecutionTimeoutError(Exception):
    code = "EXECUTION_TIMEOUT"
    retryable = True

    def __init__(self, limit_ms: float) -> None:
        sec = round(limit_ms / 100.0) / 10.0
        super().__init__(f"Run exceeded its time limit of {sec}s")
        self.name = "ExecutionTimeoutError"


def _slugify(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_-]+", "-", s)
    s = re.sub(r"^-+|-+$", "", s)
    return s


def _normalize_error(err: BaseException, default_code: str = "INTERNAL_CRASH") -> AttrDict:
    name = getattr(err, "name", type(err).__name__)
    msg = str(err)
    if isinstance(err, ExecutionTimeoutError) or name == "AbortError" or msg == "EXECUTION_TIMEOUT":
        return AttrDict(
            code="EXECUTION_TIMEOUT",
            message=msg if isinstance(err, ExecutionTimeoutError) else "Exceeded deadline or timeout",
            retryable=True,
        )
    if msg == "SERVER_SHUTDOWN":
        return AttrDict(code="TASK_INTERRUPTED", message="Agent is shutting down", retryable=True)
    if msg == "CLIENT_DISCONNECTED":
        return AttrDict(code="TASK_CANCELED", message="Client disconnected", retryable=False)

    code = getattr(err, "code", None) or default_code
    retryable = bool(getattr(err, "retryable", False))
    return AttrDict(code=str(code), message=msg, retryable=retryable)


def _serialize_output(val: Any) -> Any:
    if hasattr(val, "model_dump") and callable(val.model_dump):
        return val.model_dump()
    if hasattr(val, "dict") and callable(val.dict) and not isinstance(val, dict):
        return val.dict()
    return val


class _AsyncJob:
    def __init__(self, run_id: str, stream: BufferedStream) -> None:
        self.run_id = run_id
        self.status: str = "working"
        self.output: Any = None
        self.error: Optional[Dict[str, Any]] = None
        self.telemetry: Optional[Dict[str, Any]] = None
        self.duration_ms: Optional[int] = None
        self.created_at: int = int(time.time() * 1000)
        self.stream = stream
        self.heartbeat_task: Optional[asyncio.Task[None]] = None


class CatelogAgent:
    """
    Core Catelog Agent engine conforming to the Marketplace Agent Protocol Specification (MAPS).
    """

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        *,
        id: Optional[str] = None,
        name: Optional[str] = None,
        version: Optional[str] = None,
        secret_key: Optional[str] = None,
        secretKey: Optional[str] = None,
        public_key: Optional[str] = None,
        publicKey: Optional[str] = None,
        mode: Optional[ExecutionMode] = None,
        max_timeout_minute: Optional[float] = None,
        maxTimeoutMinute: Optional[float] = None,
        capabilities: Optional[Dict[str, Any]] = None,
        input_schema: Any = None,
        inputSchema: Any = None,
        output_schema: Any = None,
        outputSchema: Any = None,
        execute: Optional[Callable[[AgentExecutionContext], Any]] = None,
        telemetry: Optional[Dict[str, Any]] = None,
        job_store: Any = None,
        jobStore: Any = None,
        limits: Optional[Dict[str, Any]] = None,
    ) -> None:
        cfg = dict(config) if config else {}
        agent_name = str(name or cfg.get("name") or "")
        raw_timeout = (
            max_timeout_minute
            if max_timeout_minute is not None
            else (
                maxTimeoutMinute
                if maxTimeoutMinute is not None
                else cfg.get("max_timeout_minute", cfg.get("maxTimeoutMinute"))
            )
        )
        if (
            isinstance(raw_timeout, bool)
            or not isinstance(raw_timeout, (int, float))
            or math.isnan(raw_timeout)
            or math.isinf(raw_timeout)
            or raw_timeout <= 0
        ):
            raise ValueError(
                f'[catelog] maxTimeoutMinute missing or invalid in createAgent({{ name: "{agent_name}" }}). '
                f"Set a positive number of minutes, e.g. max_timeout_minute=5. "
                f"This hard limit stops runs that hang and is required for every agent."
            )

        exec_fn = execute or cfg.get("execute")
        if not callable(exec_fn):
            raise ValueError(f'[catelog] execute function missing in createAgent({{ name: "{agent_name}" }}).')

        self._execute_fn = exec_fn
        self._max_timeout_ms: int = int(round(float(raw_timeout) * 60_000))
        self.name: str = agent_name
        self.id: str = str(id or cfg.get("id") or _slugify(agent_name))
        self.version: str = str(version or cfg.get("version") or "1.0.0")
        self.mode: ExecutionMode = (mode or cfg.get("mode") or "sync")  # type: ignore[assignment]

        cap_overrides = capabilities or cfg.get("capabilities") or {}
        self.capabilities: AttrDict = to_attr_dict(
            {
                "streaming": True,
                "delta_stream": True,
                "execution_modes": [self.mode],
                **cap_overrides,
                "max_timeout_seconds": int(math.ceil(self._max_timeout_ms / 1000.0)),
            }
        )

        sec_key = secret_key or secretKey or cfg.get("secret_key") or cfg.get("secretKey")
        pub_key = public_key or publicKey or cfg.get("public_key") or cfg.get("publicKey")
        self.security = SecurityManager(secret=sec_key, public_key=pub_key)

        self._input_schema = (
            input_schema
            if input_schema is not None
            else (inputSchema if inputSchema is not None else cfg.get("input_schema", cfg.get("inputSchema")))
        )
        self._output_schema = (
            output_schema
            if output_schema is not None
            else (
                outputSchema
                if outputSchema is not None
                else cfg.get("output_schema", cfg.get("outputSchema"))
            )
        )

        self._start_time_ms = int(time.time() * 1000)
        self._telemetry_reporter = TelemetryReporter(telemetry or cfg.get("telemetry"))
        self._job_store = (
            job_store
            if job_store is not None
            else (
                jobStore
                if jobStore is not None
                else cfg.get("job_store", cfg.get("jobStore")) or MemoryJobStore()
            )
        )
        self._limits = LimitGuard(limits or cfg.get("limits"))
        self._live_jobs: Dict[str, _AsyncJob] = {}
        self._active_runs: Dict[str, AbortController] = {}
        self._draining = False
        self._idle_waiters: List[Callable[[], None]] = []

    # ─────────────────────────────────────────────
    #  GET /health & GET /schema
    # ─────────────────────────────────────────────

    def get_health(self) -> AttrDict:
        uptime_sec = max(0, (int(time.time() * 1000) - self._start_time_ms) // 1000)
        return to_attr_dict(
            {
                "status": "ready",
                "protocol_version": PROTOCOL_VERSION,
                "uptime_seconds": uptime_sec,
                "environment_ready": True,
                "capabilities": dict(self.capabilities),
            }
        )

    def getHealth(self) -> AttrDict:
        return self.get_health()

    def get_manifest(self) -> AttrDict:
        in_schema = (
            to_json_schema(self._input_schema, "InputSchema")
            if self._input_schema is not None
            else {"type": "object", "additionalProperties": True}
        )
        out_schema = (
            to_json_schema(self._output_schema, "OutputSchema")
            if self._output_schema is not None
            else {"type": "object", "additionalProperties": True}
        )
        return to_attr_dict(
            {
                "id": self.id,
                "name": self.name,
                "version": self.version,
                "protocol_version": PROTOCOL_VERSION,
                "capabilities": dict(self.capabilities),
                "input_schema": in_schema,
                "output_schema": out_schema,
            }
        )

    def getManifest(self) -> AttrDict:
        return self.get_manifest()

    # ─────────────────────────────────────────────
    #  .listen(port) / .serve(port)
    # ─────────────────────────────────────────────

    def listen(
        self,
        port_or_options: Optional[Union[int, Dict[str, Any]]] = None,
        **kwargs: Any,
    ) -> CatelogServer:
        if isinstance(port_or_options, int):
            opts = {"port": port_or_options, **kwargs}
        elif isinstance(port_or_options, dict):
            opts = {**port_or_options, **kwargs}
        else:
            opts = kwargs
        return start_agent_server(self, opts)

    def serve(
        self,
        port_or_options: Optional[Union[int, Dict[str, Any]]] = None,
        **kwargs: Any,
    ) -> CatelogServer:
        return self.listen(port_or_options, **kwargs)

    # ─────────────────────────────────────────────
    #  ASGI App (FastAPI / Starlette / Uvicorn mount)
    # ─────────────────────────────────────────────

    def asgi_app(self) -> Callable[[Dict[str, Any], Callable[[], Any], Callable[[Dict[str, Any]], Any]], Any]:
        return self.__call__

    async def __call__(
        self,
        scope: Dict[str, Any],
        receive: Callable[[], Any],
        send: Callable[[Dict[str, Any]], Any],
    ) -> None:
        if scope.get("type") != "http":
            return

        method = str(scope.get("method") or "GET").upper()
        path = str(scope.get("path") or "/")
        root_path = str(scope.get("root_path") or "")
        if root_path and path.startswith(root_path):
            path = path[len(root_path) :] or "/"
        qs = scope.get("query_string")
        if qs:
            qs_str = qs.decode("latin-1") if isinstance(qs, (bytes, bytearray)) else str(qs)
            full_url = f"{path}?{qs_str}"
        else:
            full_url = path

        headers: Dict[str, str] = {}
        for k_bytes, v_bytes in scope.get("headers") or []:
            k = k_bytes.decode("latin-1").lower()
            v = v_bytes.decode("latin-1")
            headers[k] = v

        client = scope.get("client")
        remote_addr = client[0] if isinstance(client, (list, tuple)) and len(client) > 0 else "127.0.0.1"

        async def read_body(max_bytes: Optional[int] = None) -> bytes:
            chunks: List[bytes] = []
            total = 0
            while True:
                msg = await receive()
                if msg.get("type") == "http.disconnect":
                    break
                chunk = msg.get("body", b"")
                if chunk:
                    total += len(chunk)
                    if max_bytes is not None and total > max_bytes:
                        raise BodyTooLargeError(max_bytes)
                    chunks.append(chunk)
                if not msg.get("more_body", False):
                    break
            return b"".join(chunks)

        req = IncomingHttpRequest(
            method=method,
            url=full_url,
            headers=headers,
            remote_addr=remote_addr,
            body_reader=read_body,
        )

        res = OutgoingHttpResponse()
        queue: asyncio.Queue[Optional[Dict[str, Any]]] = asyncio.Queue()

        orig_write_head = res.write_head
        orig_write = res.write
        orig_end = res.end

        def asgi_write_head(status_code: int, hdrs: Optional[Dict[str, str]] = None) -> None:
            if res.headers_sent:
                return
            orig_write_head(status_code, hdrs)
            raw_hdrs = [
                (k.lower().encode("latin-1"), str(v).encode("latin-1"))
                for k, v in res.headers.items()
            ]
            queue.put_nowait(
                {
                    "type": "http.response.start",
                    "status": res.status_code,
                    "headers": raw_hdrs,
                }
            )

        def asgi_write(data: Union[str, bytes]) -> None:
            if res.writable_ended:
                return
            if not res.headers_sent:
                asgi_write_head(res.status_code)
            b = data.encode("utf-8") if isinstance(data, str) else bytes(data)
            queue.put_nowait({"type": "http.response.body", "body": b, "more_body": True})

        def asgi_end(data: Optional[Union[str, bytes]] = None) -> None:
            if res.writable_ended:
                return
            if data is not None:
                asgi_write(data)
            elif not res.headers_sent:
                asgi_write_head(res.status_code)
            orig_end()
            queue.put_nowait({"type": "http.response.body", "body": b"", "more_body": False})
            queue.put_nowait(None)

        res.write_head = asgi_write_head  # type: ignore[method-assign]
        res.writeHead = asgi_write_head  # type: ignore[method-assign]
        res.write = asgi_write  # type: ignore[method-assign]
        res.end = asgi_end  # type: ignore[method-assign]

        async def sender() -> None:
            while True:
                item = await queue.get()
                if item is None:
                    break
                await send(item)

        sender_task = asyncio.create_task(sender())
        await self.handle_request(req, res)
        if not res.writable_ended:
            res.end()
        await sender_task

    # ─────────────────────────────────────────────
    #  Request Router
    # ─────────────────────────────────────────────

    async def handle_request(self, req: IncomingHttpRequest, res: OutgoingHttpResponse) -> None:
        method = (req.method or "GET").upper()
        parsed = urllib.parse.urlsplit(req.url or "/")
        pathname = parsed.path or "/"
        query_params = urllib.parse.parse_qs(parsed.query)

        # CORS
        res.set_header("Access-Control-Allow-Origin", "*")
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        res.set_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Accept, Authorization, "
            "X-Marketplace-Protocol, X-Marketplace-Timestamp, X-Marketplace-Nonce, "
            "X-Marketplace-Run-Id, X-Marketplace-Signature",
        )

        if method == "OPTIONS":
            res.write_head(204)
            res.end()
            return

        try:
            if (pathname == "/health" or pathname.endswith("/health")) and method == "GET":
                self._write_json(res, 200, self.get_health())
                return

            if (pathname == "/schema" or pathname.endswith("/schema")) and method == "GET":
                self._write_json(res, 200, self.get_manifest())
                return

            if (pathname == "/execute" or pathname.endswith("/execute")) and method == "POST":
                await self._handle_execute(req, res)
                return

            if "/tasks/" in pathname and method == "GET":
                job_id = pathname.split("/tasks/", 1)[1]
                since_list = query_params.get("since")
                since_param = since_list[0] if since_list else None
                await self._handle_task_poll(res, job_id, since_param)
                return

            self._write_json(
                res,
                404,
                {
                    "error": {
                        "code": "NOT_FOUND",
                        "message": f"{method} {pathname} not found",
                        "retryable": False,
                    }
                },
            )
        except Exception as err:
            error = _normalize_error(err)
            self._write_json(res, 500, {"error": error})

    async def handleRequest(self, req: IncomingHttpRequest, res: OutgoingHttpResponse) -> None:
        await self.handle_request(req, res)

    # ─────────────────────────────────────────────
    #  POST /execute — Core Execution Handler
    # ─────────────────────────────────────────────

    async def _handle_execute(self, req: IncomingHttpRequest, res: OutgoingHttpResponse) -> None:
        if self._draining:
            res.set_header("Retry-After", "5")
            self._write_json(
                res,
                503,
                {"error": {"code": "SHUTTING_DOWN", "message": "Agent is shutting down", "retryable": True}},
            )
            return

        rejection = self._limits.admit(req.headers, req.remote_addr)
        if rejection is not None:
            if rejection.get("retry_after_sec"):
                res.set_header("Retry-After", str(rejection["retry_after_sec"]))
            self._write_json(
                res,
                int(rejection["status"]),
                {
                    "error": {
                        "code": rejection["code"],
                        "message": rejection["message"],
                        "retryable": True,
                    }
                },
            )
            return

        try:
            await self._run_execute(req, res)
        finally:
            self._limits.release()
            self._notify_if_idle()

    async def _run_execute(self, req: IncomingHttpRequest, res: OutgoingHttpResponse) -> None:
        try:
            raw_body = await req.read_body(self._limits.max_body_bytes)
        except BodyTooLargeError as err:
            res.set_header("Connection", "close")
            self._write_json(
                res,
                413,
                {"error": {"code": "PAYLOAD_TOO_LARGE", "message": str(err), "retryable": False}},
            )
            return

        headers = req.headers
        path = req.url or "/execute"
        method = req.method or "POST"

        try:
            auth_info = self.security.authenticate_request(
                method=method,
                path=path,
                headers=headers,
                raw_body=raw_body,
            )
        except SecurityVerificationError as err:
            self._write_json(
                res,
                err.status_code,
                {"error": {"code": err.code, "message": err.message, "retryable": False}},
            )
            return

        try:
            payload = json.loads(raw_body.decode("utf-8")) if len(raw_body) > 0 else {"input": {}}
            if not isinstance(payload, dict):
                raise ValueError("Payload must be a JSON object")
        except Exception:
            self._write_json(
                res,
                400,
                {"error": {"code": "INVALID_INPUT", "message": "Malformed JSON body", "retryable": False}},
            )
            return

        run_id = str(payload.get("run_id") or auth_info["run_id"])
        input_bytes = len(raw_body)

        if self._input_schema is not None:
            validation = validate_schema_data(self._input_schema, payload.get("input"))
            if not validation.get("success"):
                errs = validation.get("errors") or ["Invalid input"]
                self._write_json(
                    res,
                    400,
                    {
                        "run_id": run_id,
                        "status": "failed",
                        "duration_ms": 0,
                        "error": {
                            "code": "INVALID_INPUT",
                            "message": f"Validation failed: {'; '.join(errs)}",
                            "retryable": False,
                            "details": {"validationErrors": errs},
                        },
                    },
                )
                return
            validated_input = validation["data"]
        else:
            validated_input = payload.get("input") if payload.get("input") is not None else {}

        self.security.mark_run_started(run_id)

        if self.mode == "async":
            await self._execute_async(run_id, validated_input, payload, input_bytes, res)
        else:
            await self._execute_sync_or_conversational(
                run_id, validated_input, payload, input_bytes, req, res
            )

    # ── Deadline enforcement (all modes) ──

    async def _execute_with_deadline(
        self,
        ctx: AgentExecutionContext,
        abort_controller: AbortController,
        caller_deadline_ms: Optional[int] = None,
    ) -> Any:
        now_ms = int(time.time() * 1000)
        limit_ms = float(self._max_timeout_ms)
        if caller_deadline_ms is not None and isinstance(caller_deadline_ms, (int, float)) and caller_deadline_ms > now_ms:
            limit_ms = min(limit_ms, float(caller_deadline_ms - now_ms))

        tracker = get_bound_tracker(ctx)

        async def _invoke() -> Any:
            token = set_current_tracker(tracker)
            try:
                res = self._execute_fn(ctx)
                if inspect.isawaitable(res):
                    return await res
                return res
            finally:
                reset_current_tracker(token)

        task = asyncio.create_task(_invoke())

        def _ignore_task_exc(t: asyncio.Task[Any]) -> None:
            try:
                t.exception()
            except (asyncio.CancelledError, Exception):
                pass

        task.add_done_callback(_ignore_task_exc)

        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=max(0.001, limit_ms / 1000.0))
        except asyncio.TimeoutError as exc:
            err = ExecutionTimeoutError(limit_ms)
            abort_controller.abort(err)
            task.cancel()
            raise err from exc
        finally:
            unbind_tracker(ctx)

    # ── Async Mode: Return 202 immediately, run in background ──

    async def _execute_async(
        self,
        run_id: str,
        input_data: Any,
        payload: Dict[str, Any],
        input_bytes: int,
        res: OutgoingHttpResponse,
    ) -> None:
        buffered_stream = BufferedStream()
        job = _AsyncJob(run_id=run_id, stream=buffered_stream)
        self._live_jobs[run_id] = job
        abort_controller = AbortController()
        self._active_runs[run_id] = abort_controller

        await self._persist_job(job)

        async def _heartbeat_job() -> None:
            try:
                while job.status == "working":
                    await asyncio.sleep(HEARTBEAT_MS / 1000.0)
                    if job.status == "working":
                        await self._persist_job(job)
            except asyncio.CancelledError:
                pass

        job.heartbeat_task = asyncio.create_task(_heartbeat_job())

        self._write_json(
            res,
            202,
            {
                "run_id": run_id,
                "status": "working",
                "poll_url": f"/tasks/{run_id}",
            },
        )

        async def _bg_run() -> None:
            start_ts = int(time.time() * 1000)
            telemetry_collector = None
            try:
                built = build_execution_context(
                    run_id=run_id,
                    input=input_data,
                    stream=buffered_stream,
                    signal=abort_controller.signal,
                    metadata=payload.get("metadata"),
                    deadline_ms=payload.get("deadline_ms"),
                    resume_token=payload.get("resume_token"),
                    input_bytes=input_bytes,
                )
                ctx = built["ctx"]
                telemetry_collector = built["telemetry_collector"]

                raw_result = await self._execute_with_deadline(
                    ctx, abort_controller, payload.get("deadline_ms")
                )
                duration_ms = int(time.time() * 1000) - start_ts
                result = self._normalize_execute_result(raw_result)

                if job.status == "working":
                    job.status = "completed"
                    job.output = _serialize_output(result.get("output"))
                    job.duration_ms = duration_ms
                    output_bytes = len(json.dumps(job.output if job.output is not None else {}, default=str))
                    job.telemetry = telemetry_collector.finalize(
                        {
                            **(result.get("telemetry") or {}),
                            "duration_ms": duration_ms,
                            "output_bytes": output_bytes,
                            "chunks_streamed": buffered_stream.chunks_streamed,
                        }
                    )
            except BaseException as err:
                if job.status == "working":
                    job.status = "failed"
                    job.error = _normalize_error(err)
                    job.duration_ms = int(time.time() * 1000) - start_ts
                    if telemetry_collector is not None:
                        job.telemetry = telemetry_collector.finalize({"duration_ms": job.duration_ms})
            finally:
                if job.heartbeat_task and not job.heartbeat_task.done():
                    job.heartbeat_task.cancel()
                self.security.mark_run_completed(run_id)
                self._active_runs.pop(run_id, None)
                await self._persist_job(job)
                self._live_jobs.pop(run_id, None)
                self._notify_if_idle()

        asyncio.create_task(_bg_run())

    def _to_stored_job(self, job: _AsyncJob) -> AttrDict:
        now_ms = int(time.time() * 1000)
        return normalize_stored_job(
            {
                "runId": job.run_id,
                "status": job.status,
                "output": job.output,
                "error": job.error,
                "telemetry": job.telemetry,
                "durationMs": job.duration_ms,
                "createdAt": job.created_at,
                "updatedAt": now_ms,
                "events": job.stream.get_events_since(0),
                "currentStep": job.stream.current_step,
                "progressPct": job.stream.progress_pct,
                "lastSeq": job.stream.last_seq,
            }
        )

    async def _persist_job(self, job: _AsyncJob) -> None:
        try:
            res = self._job_store.set(self._to_stored_job(job))
            if inspect.isawaitable(res):
                await res
        except Exception as err:
            print(f"[catelog] jobStore.set failed for {job.run_id}: {err}")

    # ── Sync / Conversational Mode ──

    async def _execute_sync_or_conversational(
        self,
        run_id: str,
        input_data: Any,
        payload: Dict[str, Any],
        input_bytes: int,
        req: IncomingHttpRequest,
        res: OutgoingHttpResponse,
    ) -> None:
        start_ts = int(time.time() * 1000)
        accept_hdr = req.headers.get("accept")
        accepts_sse = ("text/event-stream" in accept_hdr) if accept_hdr is not None else True

        abort_controller = AbortController()
        self._active_runs[run_id] = abort_controller
        try:
            if accepts_sse:
                await self._execute_with_sse(
                    run_id, input_data, payload, input_bytes, start_ts, res, abort_controller
                )
            else:
                await self._execute_with_json(
                    run_id, input_data, payload, input_bytes, start_ts, res, abort_controller
                )
        finally:
            self._active_runs.pop(run_id, None)
            self._notify_if_idle()

    async def _execute_with_sse(
        self,
        run_id: str,
        input_data: Any,
        payload: Dict[str, Any],
        input_bytes: int,
        start_ts: int,
        res: OutgoingHttpResponse,
        abort_controller: AbortController,
    ) -> None:
        res.write_head(
            200,
            {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
        res.flush_headers()

        sse_writer = SSEWriter(
            run_id=run_id,
            write_fn=res.write,
            close_fn=res.end,
            on_client_disconnect=lambda: abort_controller.abort(Exception("CLIENT_DISCONNECTED")),
        )
        res.on("close", sse_writer.notify_client_disconnected)
        sse_writer.signal.add_event_listener(
            "abort", lambda: abort_controller.abort(sse_writer.signal.reason)
        )

        sse_writer.send_task_status("working")

        built = build_execution_context(
            run_id=run_id,
            input=input_data,
            stream=sse_writer,
            signal=abort_controller.signal,
            metadata=payload.get("metadata"),
            deadline_ms=payload.get("deadline_ms"),
            resume_token=payload.get("resume_token"),
            input_bytes=input_bytes,
        )
        ctx = built["ctx"]
        telemetry_collector = built["telemetry_collector"]

        try:
            raw_result = await self._execute_with_deadline(
                ctx, abort_controller, payload.get("deadline_ms")
            )
            duration_ms = int(time.time() * 1000) - start_ts

            if self._is_need_input_result(raw_result):
                resume_token = f"resume_{uuid.uuid4().hex[:16]}"
                sse_writer.send_task_input_required(
                    raw_result.get("prompt", ""),
                    resume_token,
                    raw_result.get("schema"),
                )
                self._report_telemetry(run_id, "input-required", telemetry_collector.finalize(), duration_ms)
                self.security.mark_run_completed(run_id)
                return

            result = self._normalize_execute_result(raw_result)
            out_data = _serialize_output(result.get("output"))
            output_bytes = len(json.dumps(out_data, default=str))
            telemetry = telemetry_collector.finalize(
                {
                    **(result.get("telemetry") or {}),
                    "duration_ms": duration_ms,
                    "output_bytes": output_bytes,
                    "chunks_streamed": sse_writer.chunks_streamed,
                }
            )

            if not res.headers_sent:
                res.set_header("X-Catelog-Duration-Ms", str(duration_ms))
            sse_writer.send_task_completed(out_data, duration_ms, telemetry)
            self._report_telemetry(run_id, "completed", telemetry, duration_ms)
        except BaseException as err:
            duration_ms = int(time.time() * 1000) - start_ts
            failed_telemetry = telemetry_collector.finalize({"duration_ms": duration_ms})
            if abort_controller.signal.aborted and not isinstance(err, ExecutionTimeoutError):
                sse_writer.send_task_canceled(duration_ms, failed_telemetry)
                self._report_telemetry(run_id, "canceled", failed_telemetry, duration_ms)
            else:
                error = _normalize_error(err)
                sse_writer.send_task_failed(error, duration_ms, failed_telemetry)
                self._report_telemetry(run_id, "failed", failed_telemetry, duration_ms)
        finally:
            self.security.mark_run_completed(run_id)

    async def _execute_with_json(
        self,
        run_id: str,
        input_data: Any,
        payload: Dict[str, Any],
        input_bytes: int,
        start_ts: int,
        res: OutgoingHttpResponse,
        abort_controller: AbortController,
    ) -> None:
        noop_stream = NoopStream()
        built = build_execution_context(
            run_id=run_id,
            input=input_data,
            stream=noop_stream,
            signal=abort_controller.signal,
            metadata=payload.get("metadata"),
            deadline_ms=payload.get("deadline_ms"),
            resume_token=payload.get("resume_token"),
            input_bytes=input_bytes,
        )
        ctx = built["ctx"]
        telemetry_collector = built["telemetry_collector"]

        try:
            raw_result = await self._execute_with_deadline(
                ctx, abort_controller, payload.get("deadline_ms")
            )
            duration_ms = int(time.time() * 1000) - start_ts

            if self._is_need_input_result(raw_result):
                resume_token = f"resume_{uuid.uuid4().hex[:16]}"
                self.security.mark_run_completed(run_id)
                resp_body: Dict[str, Any] = {
                    "run_id": run_id,
                    "status": "input-required",
                    "duration_ms": duration_ms,
                    "prompt": raw_result.get("prompt", ""),
                    "resume_token": resume_token,
                }
                if raw_result.get("schema") is not None:
                    resp_body["input_schema"] = raw_result.get("schema")
                self._write_json(res, 200, resp_body)
                return

            result = self._normalize_execute_result(raw_result)
            out_data = _serialize_output(result.get("output"))
            output_bytes = len(json.dumps(out_data, default=str))
            telemetry = telemetry_collector.finalize(
                {
                    **(result.get("telemetry") or {}),
                    "duration_ms": duration_ms,
                    "output_bytes": output_bytes,
                    "chunks_streamed": noop_stream.chunks_streamed,
                }
            )

            self.security.mark_run_completed(run_id)
            res.set_header("X-Catelog-Duration-Ms", str(duration_ms))
            self._write_json(
                res,
                200,
                {
                    "run_id": run_id,
                    "status": "completed",
                    "duration_ms": duration_ms,
                    "output": out_data,
                    "telemetry": telemetry,
                },
            )
            self._report_telemetry(run_id, "completed", telemetry, duration_ms)
        except BaseException as err:
            duration_ms = int(time.time() * 1000) - start_ts
            self.security.mark_run_completed(run_id)
            error = _normalize_error(err)
            status = (
                "canceled"
                if (abort_controller.signal.aborted and not isinstance(err, ExecutionTimeoutError))
                else "failed"
            )
            self._write_json(
                res,
                200,
                {
                    "run_id": run_id,
                    "status": status,
                    "duration_ms": duration_ms,
                    "error": error,
                    "telemetry": telemetry_collector.finalize({"duration_ms": duration_ms}),
                },
            )

    # ── Async Job Polling ──

    def _build_live_fields(self, job: Dict[str, Any], since_param: Optional[str]) -> Dict[str, Any]:
        cursor = 0
        if since_param is not None:
            try:
                cursor = int(since_param)
            except ValueError:
                cursor = 0
        events = job.get("events") or []
        filtered = [e for e in events if e.get("seq", 0) > cursor] if cursor > 0 else list(events)
        live: Dict[str, Any] = {
            "events": filtered,
            "last_seq": job.get("lastSeq") or job.get("last_seq") or 0,
        }
        cur_step = job.get("currentStep") or job.get("current_step")
        if cur_step is not None:
            live["current_step"] = cur_step
        prog_pct = (
            job.get("progressPct")
            if job.get("progressPct") is not None
            else job.get("progress_pct")
        )
        if prog_pct is not None:
            live["progress_pct"] = prog_pct
        return live

    async def _resolve_job(self, job_id: str) -> Optional[AttrDict]:
        live = self._live_jobs.get(job_id)
        if live is not None:
            return self._to_stored_job(live)

        try:
            res = self._job_store.get(job_id)
            job = await res if inspect.isawaitable(res) else res
        except Exception as err:
            print(f"[catelog] jobStore.get failed for {job_id}: {err}")
            return None

        if job is not None:
            job = normalize_stored_job(job)
            now_ms = int(time.time() * 1000)
            updated_at = int(job.get("updatedAt") or job.get("updated_at") or now_ms)
            created_at = int(job.get("createdAt") or job.get("created_at") or now_ms)
            if job.get("status") == "working" and (now_ms - updated_at) > STALE_JOB_MS:
                job = normalize_stored_job(
                    {
                        **job,
                        "status": "failed",
                        "durationMs": max(0, updated_at - created_at),
                        "error": {
                            "code": "TASK_INTERRUPTED",
                            "message": "The agent restarted while this task was running. Submit it again.",
                            "retryable": True,
                        },
                    }
                )
                try:
                    w_res = self._job_store.set(job)
                    if inspect.isawaitable(w_res):
                        await w_res
                except Exception:
                    pass
        return job

    async def _handle_task_poll(
        self,
        res: OutgoingHttpResponse,
        job_id: str,
        since_param: Optional[str] = None,
    ) -> None:
        job = await self._resolve_job(job_id)
        if not job:
            self._write_json(
                res,
                404,
                {"error": {"code": "NOT_FOUND", "message": f"No task found: {job_id}", "retryable": False}},
            )
            return

        live = self._build_live_fields(job, since_param)
        rid = job.get("runId") or job.get("run_id")
        status = job.get("status")
        now_ms = int(time.time() * 1000)
        created_at = int(job.get("createdAt") or job.get("created_at") or now_ms)
        dur_ms = job.get("durationMs") if job.get("durationMs") is not None else job.get("duration_ms")

        if status == "working":
            self._write_json(
                res,
                200,
                {
                    "run_id": rid,
                    "status": "working",
                    "elapsed_ms": max(0, now_ms - created_at),
                    **live,
                },
            )
        elif status == "completed":
            self._write_json(
                res,
                200,
                {
                    "run_id": rid,
                    "status": "completed",
                    "duration_ms": dur_ms,
                    "output": job.get("output"),
                    "telemetry": job.get("telemetry"),
                    **live,
                },
            )
        else:
            self._write_json(
                res,
                200,
                {
                    "run_id": rid,
                    "status": "failed",
                    "duration_ms": dur_ms,
                    "error": job.get("error"),
                    **live,
                },
            )

    # ── Graceful Shutdown ──

    @property
    def is_shutting_down(self) -> bool:
        return self._draining

    @property
    def isShuttingDown(self) -> bool:
        return self._draining

    async def shutdown(self, timeout_ms: int = 25_000) -> None:
        self._draining = True

        if len(self._active_runs) > 0:
            evt = asyncio.Event()
            self._idle_waiters.append(evt.set)
            try:
                await asyncio.wait_for(evt.wait(), timeout=max(0.01, timeout_ms / 1000.0))
            except asyncio.TimeoutError:
                pass

        for run_id, controller in list(self._active_runs.items()):
            job = self._live_jobs.get(run_id)
            if job is not None and job.status == "working":
                job.status = "failed"
                job.error = {
                    "code": "TASK_INTERRUPTED",
                    "message": "The agent shut down before this task finished. Submit it again.",
                    "retryable": True,
                }
                job.duration_ms = max(0, int(time.time() * 1000) - job.created_at)
                if job.heartbeat_task and not job.heartbeat_task.done():
                    job.heartbeat_task.cancel()
                await self._persist_job(job)
            controller.abort(Exception("SERVER_SHUTDOWN"))

        try:
            close_fn = getattr(self._job_store, "close", None)
            if callable(close_fn):
                res = close_fn()
                if inspect.isawaitable(res):
                    await res
        except Exception as err:
            print(f"[catelog] jobStore.close failed: {err}")

    def _notify_if_idle(self) -> None:
        if self._draining and len(self._active_runs) == 0 and len(self._idle_waiters) > 0:
            waiters = list(self._idle_waiters)
            self._idle_waiters.clear()
            for wake in waiters:
                wake()

    # ── Helpers ──

    def _normalize_execute_result(self, raw: Any) -> Dict[str, Any]:
        if isinstance(raw, dict) and "output" in raw:
            return raw
        if hasattr(raw, "output") and not isinstance(raw, dict):
            return {"output": getattr(raw, "output"), "telemetry": getattr(raw, "telemetry", None)}
        return {"output": raw}

    def _is_need_input_result(self, value: Any) -> bool:
        return isinstance(value, dict) and value.get(NEED_INPUT_SYMBOL) is True

    def _report_telemetry(
        self,
        run_id: str,
        status: str,
        telemetry: Dict[str, Any],
        duration_ms: int,
    ) -> None:
        self._telemetry_reporter.report(
            {
                "agentId": self.id,
                "runId": run_id,
                "status": status,
                "telemetry": {**telemetry, "duration_ms": duration_ms},
                "timestamp": int(time.time() * 1000),
            }
        )

    def _write_json(self, res: OutgoingHttpResponse, status: int, data: Any) -> None:
        if res.writable_ended:
            return
        body = json.dumps(data, default=str).encode("utf-8")
        res.write_head(
            status,
            {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": str(len(body)),
            },
        )
        res.end(body)


MarketplaceAgent = CatelogAgent


def create_agent(
    config: Optional[Dict[str, Any]] = None,
    **kwargs: Any,
) -> CatelogAgent:
    """
    Creates and configures a new `CatelogAgent` instance conforming to the
    Marketplace Agent Protocol Specification (MAPS).
    Accepts either a configuration dictionary (`create_agent({...})`) or keyword arguments
    (`create_agent(name="...", max_timeout_minute=5, execute=...)`).
    """
    return CatelogAgent(config, **kwargs)


createAgent = create_agent
create_marketplace_agent = create_agent
createMarketplaceAgent = create_agent

