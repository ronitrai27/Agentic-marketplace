from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Literal, Optional, Protocol, Union

PROTOCOL_VERSION = "1.0.0"

# ─────────────────────────────────────────────────
#  Error Codes
# ─────────────────────────────────────────────────

ErrorCode = Literal[
    "AUTH_INVALID_SIGNATURE",
    "AUTH_TIMESTAMP_OUT_OF_BOUNDS",
    "AUTH_REPLAY_DETECTED",
    "AUTH_MISSING_KEY",
    "AUTH_INVALID_KEY",
    "INVALID_INPUT",
    "MODEL_RATE_LIMIT",
    "UPSTREAM_TIMEOUT",
    "EXECUTION_TIMEOUT",
    "INTERNAL_CRASH",
    "TOOL_FAILURE",
    "TASK_CANCELED",
    "TASK_INTERRUPTED",
    "RATE_LIMITED",
    "SERVER_BUSY",
    "SHUTTING_DOWN",
    "PAYLOAD_TOO_LARGE",
    "NOT_FOUND",
    "BUDGET_EXCEEDED",
]

TaskState = Literal[
    "working",
    "completed",
    "failed",
    "canceled",
    "input-required",
]

ExecutionMode = Literal["sync", "async", "conversational"]

CostSource = Literal["provider", "agent"]

NEED_INPUT_SYMBOL = "__catelog_need_input__"


class AttrDict(dict):
    """Dictionary supporting both key access (`d["k"]`) and attribute access (`d.k`)."""

    def __getattr__(self, key: str) -> Any:
        try:
            return self[key]
        except KeyError as exc:
            raise AttributeError(f"'{type(self).__name__}' object has no attribute '{key}'") from exc

    def __setattr__(self, key: str, value: Any) -> None:
        self[key] = value

    def __delattr__(self, key: str) -> None:
        try:
            del self[key]
        except KeyError as exc:
            raise AttributeError(f"'{type(self).__name__}' object has no attribute '{key}'") from exc


def to_attr_dict(val: Any) -> Any:
    if isinstance(val, dict) and not isinstance(val, AttrDict):
        return AttrDict({k: to_attr_dict(v) for k, v in val.items()})
    if isinstance(val, list):
        return [to_attr_dict(v) for v in val]
    return val


# ─────────────────────────────────────────────────
#  AbortSignal & AbortController (JS/Python bridge)
# ─────────────────────────────────────────────────


class AbortSignal:
    """
    Cancellation signal passed to `execute(ctx)` via `ctx.signal`.
    Supports both Pythonic (`signal.aborted`, `await signal.wait()`, `signal.add_event_listener`)
    and TypeScript-style (`signal.addEventListener("abort", fn)`) APIs.
    """

    def __init__(self) -> None:
        self._aborted: bool = False
        self._reason: Any = None
        self._listeners: List[Callable[[], Any]] = []
        self._once_listeners: set[int] = set()
        self._event: Optional[asyncio.Event] = None

    @property
    def aborted(self) -> bool:
        return self._aborted

    @property
    def reason(self) -> Any:
        return self._reason

    def is_set(self) -> bool:
        return self._aborted

    def add_event_listener(
        self,
        event: str,
        callback: Callable[..., Any],
        options: Optional[Dict[str, Any]] = None,
    ) -> None:
        if event != "abort":
            return
        if self._aborted:
            try:
                res = callback()
                if asyncio.iscoroutine(res):
                    asyncio.ensure_future(res)
            except Exception:
                pass
            return
        if callback not in self._listeners:
            self._listeners.append(callback)
            if isinstance(options, dict) and options.get("once"):
                self._once_listeners.add(id(callback))

    def addEventListener(
        self,
        event: str,
        callback: Callable[..., Any],
        options: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.add_event_listener(event, callback, options)

    def remove_event_listener(self, event: str, callback: Callable[..., Any]) -> None:
        if event != "abort":
            return
        if callback in self._listeners:
            self._listeners.remove(callback)
        self._once_listeners.discard(id(callback))

    def removeEventListener(self, event: str, callback: Callable[..., Any]) -> None:
        self.remove_event_listener(event, callback)

    async def wait(self) -> None:
        if self._aborted:
            return
        if self._event is None:
            self._event = asyncio.Event()
        await self._event.wait()

    def _trigger(self, reason: Any = None) -> None:
        if self._aborted:
            return
        self._aborted = True
        self._reason = reason if reason is not None else Exception("Aborted")
        if self._event is not None:
            self._event.set()
        listeners = list(self._listeners)
        for cb in listeners:
            if id(cb) in self._once_listeners:
                self.remove_event_listener("abort", cb)
            try:
                res = cb()
                if asyncio.iscoroutine(res):
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(res)
                    except RuntimeError:
                        pass
            except Exception:
                pass


class AbortController:
    def __init__(self) -> None:
        self.signal = AbortSignal()

    def abort(self, reason: Any = None) -> None:
        self.signal._trigger(reason)


# ─────────────────────────────────────────────────
#  Stream Protocol
# ─────────────────────────────────────────────────


class AgentStream(Protocol):
    chunks_streamed: int

    def progress(self, percent: float, message: Optional[str] = None) -> None: ...
    def delta(self, content: str, delta_type: Literal["text", "json_patch"] = "text") -> None: ...
    def chunk(self, chunk: str) -> None: ...
    def write(self, text: str) -> None: ...
    def activity(self, type: str, data: Optional[Dict[str, Any]] = None) -> None: ...
    def step(self, label: str) -> None: ...
    def emit(self, event: str, data: Any) -> None: ...
    def is_closed(self) -> bool: ...
    def isClosed(self) -> bool: ...


# ─────────────────────────────────────────────────
#  Logger, Metric, Usage, Session
# ─────────────────────────────────────────────────


class AgentLogger:
    def __init__(
        self,
        info_fn: Callable[[str, Optional[Dict[str, Any]]], None],
        warn_fn: Callable[[str, Optional[Dict[str, Any]]], None],
        error_fn: Callable[[str, Optional[Dict[str, Any]]], None],
        debug_fn: Callable[[str, Optional[Dict[str, Any]]], None],
    ) -> None:
        self._info = info_fn
        self._warn = warn_fn
        self._error = error_fn
        self._debug = debug_fn

    def info(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        self._info(message, data)

    def warn(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        self._warn(message, data)

    def error(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        self._error(message, data)

    def debug(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        self._debug(message, data)


class AgentMetric:
    def __init__(
        self,
        count_fn: Callable[[str, float], None],
        gauge_fn: Callable[[str, float], None],
        timing_fn: Callable[[str, float], None],
    ) -> None:
        self._count = count_fn
        self._gauge = gauge_fn
        self._timing = timing_fn

    def count(self, name: str, value: float = 1) -> None:
        self._count(name, value)

    def gauge(self, name: str, value: float) -> None:
        self._gauge(name, value)

    def timing(self, name: str, duration_ms: float) -> None:
        self._timing(name, duration_ms)


class AgentUsage:
    def __init__(self, record_fn: Callable[..., None]) -> None:
        self._record = record_fn

    def record(self, usage: Optional[Union[Dict[str, Any], Any]] = None, **kwargs: Any) -> None:
        if usage is None and kwargs:
            self._record(kwargs)
        elif isinstance(usage, dict) and kwargs:
            merged = {**usage, **kwargs}
            self._record(merged)
        else:
            self._record(usage)


class AgentSession:
    def __init__(self, data: Dict[str, Any]) -> None:
        self._data = data

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self._data[key] = value

    def get_all(self) -> Dict[str, Any]:
        return dict(self._data)

    def getAll(self) -> Dict[str, Any]:
        return self.get_all()


@dataclass
class AgentExecutionContext:
    """
    Execution context supplied to the agent's `execute(ctx)` handler.
    Supports both attribute access (`ctx.input`, `ctx.stream`, `ctx.run_id`, `ctx.runId`)
    and dict/destructuring access (`ctx["input"]`, `ctx["stream"]`).
    """

    run_id: str
    input: Any
    stream: Any
    signal: AbortSignal
    log: AgentLogger
    metric: AgentMetric
    usage: AgentUsage
    need_input: Callable[..., Dict[str, Any]]
    session: AgentSession
    metadata: Optional[Dict[str, Any]] = None
    deadline_ms: Optional[int] = None
    resume_token: Optional[str] = None

    @property
    def runId(self) -> str:
        return self.run_id

    @property
    def deadlineMs(self) -> Optional[int]:
        return self.deadline_ms

    @property
    def resumeToken(self) -> Optional[str]:
        return self.resume_token

    @property
    def needInput(self) -> Callable[..., Dict[str, Any]]:
        return self.need_input

    def __getitem__(self, key: str) -> Any:
        if hasattr(self, key):
            return getattr(self, key)
        raise KeyError(key)

    def keys(self) -> List[str]:
        return [
            "run_id",
            "runId",
            "input",
            "stream",
            "signal",
            "log",
            "metric",
            "usage",
            "metadata",
            "deadline_ms",
            "deadlineMs",
            "resume_token",
            "resumeToken",
            "need_input",
            "needInput",
            "session",
        ]

