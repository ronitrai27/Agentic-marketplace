from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Callable, Dict, List, Literal, Optional

from .types import AbortController, AbortSignal


class SSEWriter:
    """
    Streams canonical Catelog task lifecycle events over Server-Sent Events (SSE).
    """

    def __init__(
        self,
        run_id: str,
        write_fn: Callable[[bytes], Any],
        close_fn: Optional[Callable[[], Any]] = None,
        options: Optional[Dict[str, Any]] = None,
        *,
        heartbeat_interval_ms: int = 15_000,
        on_client_disconnect: Optional[Callable[[], Any]] = None,
    ) -> None:
        opts = options or {}
        self.run_id = run_id
        self._write_fn = write_fn
        self._close_fn = close_fn
        self._step_index = 0
        self._delta_index = 0
        self._closed = False
        self._abort_controller = AbortController()
        self.chunks_streamed = 0
        self._on_disconnect = on_client_disconnect or opts.get("onClientDisconnect") or opts.get("on_client_disconnect")

        interval_ms = opts.get("heartbeatIntervalMs", opts.get("heartbeat_interval_ms", heartbeat_interval_ms))
        self._heartbeat_sec = max(0.1, interval_ms / 1000.0)
        self._heartbeat_task: Optional[asyncio.Task[None]] = None
        try:
            loop = asyncio.get_running_loop()
            self._heartbeat_task = loop.create_task(self._heartbeat_loop())
        except RuntimeError:
            pass

    @property
    def chunksStreamed(self) -> int:
        return self.chunks_streamed

    @property
    def signal(self) -> AbortSignal:
        return self._abort_controller.signal

    def is_closed(self) -> bool:
        return self._closed

    def isClosed(self) -> bool:
        return self._closed

    def notify_client_disconnected(self) -> None:
        if not self._closed:
            self._closed = True
            self._clear_heartbeat()
            self._abort_controller.abort(Exception("CLIENT_DISCONNECTED"))
            if self._on_disconnect:
                try:
                    self._on_disconnect()
                except Exception:
                    pass

    async def _heartbeat_loop(self) -> None:
        try:
            while not self._closed:
                await asyncio.sleep(self._heartbeat_sec)
                if not self._closed:
                    self.send_event(
                        "heartbeat",
                        {"event": "heartbeat", "timestamp": int(time.time() * 1000)},
                    )
        except asyncio.CancelledError:
            pass

    def _clear_heartbeat(self) -> None:
        if self._heartbeat_task and not self._heartbeat_task.done():
            self._heartbeat_task.cancel()
        self._heartbeat_task = None

    def send_event(self, event_type: str, data: Any) -> None:
        if self._closed:
            return
        try:
            frame = f"event: {event_type}\ndata: {json.dumps(data, default=str)}\n\n".encode("utf-8")
            self._write_fn(frame)
        except Exception:
            self.notify_client_disconnected()

    def sendEvent(self, event_type: str, data: Any) -> None:
        self.send_event(event_type, data)

    # ── Task Lifecycle Events ──

    def send_task_status(self, status: str) -> None:
        payload = {
            "event": "task.status",
            "run_id": self.run_id,
            "status": status,
            "timestamp": int(time.time() * 1000),
        }
        self.send_event("task.status", payload)

    def sendTaskStatus(self, status: str) -> None:
        self.send_task_status(status)

    def progress(self, percent: float, message: Optional[str] = None) -> None:
        self._step_index += 1
        clamped = min(100, max(0, percent))
        payload: Dict[str, Any] = {
            "event": "task.progress",
            "run_id": self.run_id,
            "percent": clamped,
            "step": self._step_index,
            "timestamp": int(time.time() * 1000),
        }
        if message is not None:
            payload["message"] = message
        self.send_event("task.progress", payload)

    def delta(self, content: str, delta_type: Literal["text", "json_patch"] = "text") -> None:
        self.chunks_streamed += 1
        idx = self._delta_index
        self._delta_index += 1
        payload = {
            "event": "task.delta",
            "run_id": self.run_id,
            "index": idx,
            "delta_type": delta_type,
            "content": content,
        }
        self.send_event("task.delta", payload)

    def activity(self, type: str, data: Optional[Dict[str, Any]] = None) -> None:
        payload: Dict[str, Any] = {
            "event": "task.activity",
            "run_id": self.run_id,
            "activity_type": type,
            "timestamp": int(time.time() * 1000),
        }
        if data is not None:
            payload["data"] = data
        self.send_event("task.activity", payload)

    def step(self, label: str) -> None:
        self.progress(0, label)

    def write(self, text: str) -> None:
        self.delta(text, "text")

    def chunk(self, chunk: str) -> None:
        self.delta(chunk, "text")

    def emit(self, event: str, data: Any) -> None:
        self.send_event(event, data)

    # ── Terminal Events ──

    def send_task_completed(
        self,
        output: Any,
        duration_ms: int,
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> None:
        if self._closed:
            return
        payload: Dict[str, Any] = {
            "event": "task.completed",
            "run_id": self.run_id,
            "duration_ms": duration_ms,
            "output": output,
        }
        if telemetry is not None:
            payload["telemetry"] = telemetry
        self.send_event("task.completed", payload)
        self.close()

    def sendTaskCompleted(
        self,
        output: Any,
        duration_ms: int,
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.send_task_completed(output, duration_ms, telemetry)

    def send_task_failed(
        self,
        error: Dict[str, Any],
        duration_ms: int,
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> None:
        if self._closed:
            return
        payload: Dict[str, Any] = {
            "event": "task.failed",
            "run_id": self.run_id,
            "duration_ms": duration_ms,
            "error": error,
        }
        if telemetry is not None:
            payload["telemetry"] = telemetry
        self.send_event("task.failed", payload)
        self.close()

    def sendTaskFailed(
        self,
        error: Dict[str, Any],
        duration_ms: int,
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.send_task_failed(error, duration_ms, telemetry)

    def send_task_input_required(
        self,
        prompt: str,
        resume_token: str,
        input_schema: Optional[Dict[str, Any]] = None,
    ) -> None:
        if self._closed:
            return
        payload: Dict[str, Any] = {
            "event": "task.input_required",
            "run_id": self.run_id,
            "prompt": prompt,
            "resume_token": resume_token,
            "timestamp": int(time.time() * 1000),
        }
        if input_schema is not None:
            payload["input_schema"] = input_schema
        self.send_event("task.input_required", payload)
        self.close()

    def sendTaskInputRequired(
        self,
        prompt: str,
        resume_token: str,
        input_schema: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.send_task_input_required(prompt, resume_token, input_schema)

    def send_task_canceled(
        self,
        duration_ms: int,
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.send_task_failed(
            {"code": "TASK_CANCELED", "message": "Execution was canceled", "retryable": False},
            duration_ms,
            telemetry,
        )

    def sendTaskCanceled(
        self,
        duration_ms: int,
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.send_task_canceled(duration_ms, telemetry)

    # ── Backward compat wrappers ──

    def send_run_started(self) -> None:
        self.send_task_status("working")

    def sendRunStarted(self) -> None:
        self.send_task_status("working")

    def send_run_succeeded(
        self,
        output: Any,
        duration_ms: int,
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.send_task_completed(output, duration_ms, telemetry)

    def sendRunSucceeded(
        self,
        output: Any,
        duration_ms: int,
        telemetry: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.send_task_completed(output, duration_ms, telemetry)

    def send_run_failed(self, error: Dict[str, Any], duration_ms: int) -> None:
        self.send_task_failed(error, duration_ms)

    def sendRunFailed(self, error: Dict[str, Any], duration_ms: int) -> None:
        self.send_task_failed(error, duration_ms)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._clear_heartbeat()
        if self._close_fn:
            try:
                self._close_fn()
            except Exception:
                pass


class NoopStream:
    """For batch JSON (non-SSE) mode."""

    def __init__(self) -> None:
        self.chunks_streamed = 0

    @property
    def chunksStreamed(self) -> int:
        return self.chunks_streamed

    def progress(self, percent: float, message: Optional[str] = None) -> None:
        pass

    def delta(self, content: str, delta_type: Literal["text", "json_patch"] = "text") -> None:
        self.chunks_streamed += 1

    def activity(self, type: str, data: Optional[Dict[str, Any]] = None) -> None:
        pass

    def step(self, label: str) -> None:
        pass

    def emit(self, event: str, data: Any) -> None:
        pass

    def write(self, text: str) -> None:
        self.delta(text)

    def chunk(self, chunk: str) -> None:
        self.delta(chunk)

    def is_closed(self) -> bool:
        return False

    def isClosed(self) -> bool:
        return False


MAX_MESSAGE_CHARS = 500


class BufferedStream:
    """
    Drop-in replacement for NoopStream used by `mode="async"`.
    Records `step`, `progress`, `activity`, and `emit` in a bounded ring buffer
    so `GET /tasks/:id` can return live events while the job runs.
    """

    def __init__(self, max_events: int = 200) -> None:
        self.chunks_streamed = 0
        self.current_step: Optional[str] = None
        self.progress_pct: Optional[float] = None
        self._max_events = max_events
        self._seq = 0
        self._events: List[Dict[str, Any]] = []

    @property
    def chunksStreamed(self) -> int:
        return self.chunks_streamed

    @property
    def currentStep(self) -> Optional[str]:
        return self.current_step

    @property
    def progressPct(self) -> Optional[float]:
        return self.progress_pct

    @property
    def last_seq(self) -> int:
        return self._seq

    @property
    def lastSeq(self) -> int:
        return self._seq

    def _push(self, event: Dict[str, Any]) -> None:
        self._seq += 1
        rec = {"seq": self._seq, "timestamp": int(time.time() * 1000), **event}
        self._events.append(rec)
        if len(self._events) > self._max_events:
            del self._events[: len(self._events) - self._max_events]

    def _clip(self, text: Optional[str]) -> Optional[str]:
        if text is None:
            return None
        return f"{text[:MAX_MESSAGE_CHARS]}…" if len(text) > MAX_MESSAGE_CHARS else text

    def get_events_since(self, since: int = 0) -> List[Dict[str, Any]]:
        if since > 0:
            return [e for e in self._events if e["seq"] > since]
        return list(self._events)

    def getEventsSince(self, since: int = 0) -> List[Dict[str, Any]]:
        return self.get_events_since(since)

    def progress(self, percent: float, message: Optional[str] = None) -> None:
        pct = min(100, max(0, percent))
        msg = self._clip(message)
        self.progress_pct = pct
        if msg is not None:
            self.current_step = msg
        ev: Dict[str, Any] = {"type": "progress", "percent": pct}
        if msg is not None:
            ev["message"] = msg
        self._push(ev)

    def step(self, label: str) -> None:
        msg = self._clip(label)
        if msg is not None:
            self.current_step = msg
        ev: Dict[str, Any] = {"type": "step"}
        if msg is not None:
            ev["message"] = msg
        self._push(ev)

    def activity(self, type: str, data: Optional[Dict[str, Any]] = None) -> None:
        ev: Dict[str, Any] = {"type": "activity", "name": type}
        if data is not None:
            ev["data"] = data
        self._push(ev)

    def emit(self, event: str, data: Any) -> None:
        self._push({"type": "event", "name": event, "data": data})

    def delta(self, content: str, delta_type: Literal["text", "json_patch"] = "text") -> None:
        self.chunks_streamed += 1

    def write(self, text: str) -> None:
        self.delta(text)

    def chunk(self, chunk: str) -> None:
        self.delta(chunk)

    def is_closed(self) -> bool:
        return False

    def isClosed(self) -> bool:
        return False

