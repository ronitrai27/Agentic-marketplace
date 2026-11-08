from __future__ import annotations

import json
import os
import threading
import urllib.request
from typing import Any, Dict, Optional, Union

from .types import AgentLogger, AgentMetric, AttrDict, to_attr_dict
from .usage import UsageTracker, resolve_usage_telemetry


class TelemetryCollector:
    def __init__(self, input_bytes: int, tracker: Optional[UsageTracker] = None) -> None:
        self._input_bytes = input_bytes
        self._tracker = tracker
        self._metrics: Dict[str, Union[int, float]] = {}
        self._chunks_streamed = 0

        self._metric_helper = AgentMetric(
            count_fn=lambda name, val=1: self.record(name, val if val is not None else 1),
            gauge_fn=lambda name, val: self._set_gauge(name, val),
            timing_fn=lambda name, dur: self.record(name, dur),
        )

    def _set_gauge(self, name: str, value: Union[int, float]) -> None:
        self._metrics[name] = value

    def record(self, name: str, value: Union[int, float]) -> None:
        self._metrics[name] = self._metrics.get(name, 0) + value

    def get_metric_helper(self) -> AgentMetric:
        return self._metric_helper

    def getMetricHelper(self) -> AgentMetric:
        return self._metric_helper

    def get_metrics(self) -> Dict[str, Union[int, float]]:
        return dict(self._metrics)

    def getMetrics(self) -> Dict[str, Union[int, float]]:
        return self.get_metrics()

    def finalize(self, overrides: Optional[Dict[str, Any]] = None) -> AttrDict:
        ovr = dict(overrides) if overrides else {}
        usage = resolve_usage_telemetry(ovr, self._tracker)
        base = dict(ovr)
        if usage.get("models"):
            base.pop("llm_tokens", None)
            base.pop("model_used", None)
            base.pop("cost_usd", None)
            base.pop("cost_source", None)

        fw_ovr = ovr.get("framework") if isinstance(ovr.get("framework"), dict) else {}
        result: Dict[str, Any] = {
            "input_bytes": self._input_bytes,
            "chunks_streamed": self._chunks_streamed,
            **base,
            **usage,
            "framework": {
                **fw_ovr,
                "custom_metrics": dict(self._metrics),
            },
        }
        return to_attr_dict(result)


def create_telemetry_collector(
    opts: Optional[Dict[str, Any]] = None,
    *,
    input_bytes: Optional[int] = None,
    inputBytes: Optional[int] = None,
    tracker: Optional[UsageTracker] = None,
) -> TelemetryCollector:
    o = opts or {}
    ib = (
        input_bytes
        if input_bytes is not None
        else (inputBytes if inputBytes is not None else o.get("input_bytes", o.get("inputBytes", 0)))
    )
    tr = tracker if tracker is not None else o.get("tracker")
    return TelemetryCollector(int(ib), tr)


createTelemetryCollector = create_telemetry_collector

# ─────────────────────────────────────────────────
#  Structured Logger
# ─────────────────────────────────────────────────

_LOG_COLORS = {
    "info": "\x1b[36m",
    "warn": "\x1b[33m",
    "error": "\x1b[31m",
    "debug": "\x1b[90m",
    "reset": "\x1b[0m",
}


def create_logger(run_id: str) -> AgentLogger:
    def _log(level: str, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        env = os.environ.get("CATELOG_ENV") or os.environ.get("PYTHON_ENV") or os.environ.get("NODE_ENV") or ""
        if level == "debug" and env == "production":
            return
        color = _LOG_COLORS.get(level, _LOG_COLORS["info"])
        prefix = f"{color}[{level.upper()}]{_LOG_COLORS['reset']}"
        run_tag = f"\x1b[90m[{run_id}]\x1b[0m"
        if data and len(data) > 0:
            print(f"{prefix} {run_tag} {message}", data)
        else:
            print(f"{prefix} {run_tag} {message}")

    return AgentLogger(
        info_fn=lambda msg, data=None: _log("info", msg, data),
        warn_fn=lambda msg, data=None: _log("warn", msg, data),
        error_fn=lambda msg, data=None: _log("error", msg, data),
        debug_fn=lambda msg, data=None: _log("debug", msg, data),
    )


createLogger = create_logger

# ─────────────────────────────────────────────────
#  Layer 2: Background Telemetry Reporter
#  Fire-and-forget — NEVER fails agent execution
# ─────────────────────────────────────────────────


class TelemetryReporter:
    def __init__(
        self,
        options: Optional[Dict[str, Any]] = None,
        *,
        endpoint: Optional[str] = None,
        timeout_ms: Optional[int] = None,
        timeoutMs: Optional[int] = None,
        disabled: Optional[bool] = None,
    ) -> None:
        opts = options or {}
        self.endpoint: Optional[str] = (
            endpoint or opts.get("endpoint") or os.environ.get("CATELOG_TELEMETRY_URL") or None
        )
        t_ms = (
            timeout_ms
            if timeout_ms is not None
            else (timeoutMs if timeoutMs is not None else opts.get("timeout_ms", opts.get("timeoutMs", 3000)))
        )
        self.timeout_sec: float = max(0.5, float(t_ms) / 1000.0)
        dis = disabled if disabled is not None else opts.get("disabled")
        if dis is None:
            dis = os.environ.get("CATELOG_TELEMETRY_DISABLED", "").lower() == "true"
        self.disabled: bool = bool(dis)

    def report(self, data: Dict[str, Any]) -> None:
        if self.disabled or not self.endpoint:
            return
        url = self.endpoint
        timeout = self.timeout_sec

        def _send() -> None:
            try:
                body = json.dumps(data, default=str).encode("utf-8")
                req = urllib.request.Request(
                    url,
                    data=body,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=timeout):
                    pass
            except Exception:
                # Telemetry failures NEVER affect agent execution
                pass

        t = threading.Thread(target=_send, daemon=True)
        t.start()

