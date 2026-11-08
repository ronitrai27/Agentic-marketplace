from __future__ import annotations

import contextvars
import json
import math
import re
import time
import weakref
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, TypeVar, Union

from .types import AgentUsage, AttrDict, CostSource, to_attr_dict

MAX_MODELS_PER_RUN = 50
T = TypeVar("T")


def _num(v: Any) -> Optional[Union[int, float]]:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            n = float(s)
            if n.is_integer():
                n = int(n)
        except ValueError:
            return None
    elif isinstance(v, (int, float)):
        n = v
    else:
        return None
    if isinstance(n, float) and (math.isnan(n) or math.isinf(n)):
        return None
    return n if n >= 0 else None


def _str(v: Any) -> Optional[str]:
    if isinstance(v, str):
        s = v.strip()
        return s if s else None
    return None


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _clean_tokens(t: Any) -> Dict[str, Union[int, float]]:
    out: Dict[str, Union[int, float]] = {}
    if not t:
        return out
    for key in ("prompt", "completion", "total", "cached", "reasoning"):
        val = _get(t, key)
        n = _num(val)
        if n is not None:
            out[key] = n
    if "total" not in out and ("prompt" in out or "completion" in out):
        out["total"] = out.get("prompt", 0) + out.get("completion", 0)
    return out


def _round6(n: float) -> float:
    val = round(float(n), 6)
    return int(val) if val.is_integer() else val


class _Entry:
    def __init__(self, model_id: str, provider: Optional[str]) -> None:
        self.usage: Dict[str, Any] = {"id": model_id, "tokens": {}}
        if provider is not None:
            self.usage["provider"] = provider
        self.costed_calls = 0
        self.total_calls = 0
        self.cost_sources: Set[str] = set()


class UsageTracker:
    """Per-run tracker for LLM models, tokens, and provider/agent-reported costs."""

    def __init__(self) -> None:
        self._entries: Dict[str, _Entry] = {}

    def record(self, rec: Any, cost_source: CostSource = "agent") -> None:
        try:
            if not rec:
                return
            model_id = _str(_get(rec, "model"))
            if not model_id:
                return
            provider = _str(_get(rec, "provider"))
            key = f"{provider or ''}\u0000{model_id}"

            entry = self._entries.get(key)
            if entry is None:
                if len(self._entries) >= MAX_MODELS_PER_RUN:
                    return
                entry = _Entry(model_id, provider)
                self._entries[key] = entry

            raw_calls = _num(_get(rec, "calls"))
            calls = max(1, int(math.floor(raw_calls if raw_calls is not None else 1)))
            entry.total_calls += calls
            entry.usage["calls"] = entry.total_calls

            tokens = _clean_tokens(_get(rec, "tokens"))
            for k, v in tokens.items():
                entry.usage["tokens"][k] = entry.usage["tokens"].get(k, 0) + v

            cost = _num(_get(rec, "cost_usd") if _get(rec, "cost_usd") is not None else _get(rec, "costUsd"))
            if cost is not None:
                entry.costed_calls += calls
                entry.usage["cost_usd"] = entry.usage.get("cost_usd", 0.0) + cost
                entry.cost_sources.add(cost_source)

            latency = _num(_get(rec, "latency_ms") if _get(rec, "latency_ms") is not None else _get(rec, "latencyMs"))
            if latency is not None:
                entry.usage["latency_ms"] = entry.usage.get("latency_ms", 0) + latency
        except Exception:
            # Usage capture must never affect the run
            pass

    @property
    def is_empty(self) -> bool:
        return len(self._entries) == 0

    @property
    def isEmpty(self) -> bool:
        return self.is_empty

    def snapshot(self) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for e in self._entries.values():
            u: Dict[str, Any] = {**e.usage, "tokens": dict(e.usage["tokens"])}
            if e.costed_calls < e.total_calls:
                u.pop("cost_usd", None)
            elif "cost_usd" in u and u["cost_usd"] is not None:
                u["cost_usd"] = _round6(u["cost_usd"])
                u["cost_source"] = "agent" if "agent" in e.cost_sources else "provider"
            out.append(to_attr_dict(u))
        return out

    def facade(self) -> AgentUsage:
        return AgentUsage(lambda usage: self.record(usage, "agent"))


def summarize_models(models: List[Dict[str, Any]]) -> Dict[str, Any]:
    llm_tokens: Dict[str, Union[int, float]] = {}
    for m in models:
        toks = _get(m, "tokens") or {}
        if isinstance(toks, dict):
            for k, v in toks.items():
                if isinstance(v, (int, float)):
                    llm_tokens[k] = llm_tokens.get(k, 0) + v
    ids = [_get(m, "id") for m in models if _get(m, "id")]
    out: Dict[str, Any] = {
        "llm_tokens": to_attr_dict(llm_tokens),
    }
    if ids:
        out["model_used"] = ",".join(ids)
    if models and all(_get(m, "cost_usd") is not None for m in models):
        out["cost_usd"] = _round6(sum(float(_get(m, "cost_usd") or 0.0) for m in models))
        out["cost_source"] = (
            "agent" if any(_get(m, "cost_source") == "agent" for m in models) else "provider"
        )
    return out


summarizeModels = summarize_models


def _pick_cost(t: Dict[str, Any]) -> Dict[str, Any]:
    c = _num(_get(t, "cost_usd"))
    if c is None:
        return {}
    return {"cost_usd": c, "cost_source": _get(t, "cost_source") or "provider"}


def resolve_usage_telemetry(
    adapter: Optional[Dict[str, Any]],
    tracker: Optional[UsageTracker],
) -> Dict[str, Any]:
    try:
        if tracker is not None and not tracker.is_empty:
            models = tracker.snapshot()
            return {"models": models, **summarize_models(models)}
        if adapter:
            adapter_models = _get(adapter, "models")
            if isinstance(adapter_models, list) and len(adapter_models) > 0:
                return {
                    "models": to_attr_dict(adapter_models),
                    **summarize_models(adapter_models),
                    **_pick_cost(adapter),
                }
            model_used = _get(adapter, "model_used")
            llm_tokens = _get(adapter, "llm_tokens")
            if model_used or llm_tokens:
                ids = [s.strip() for s in str(model_used or "").split(",") if s.strip()]
                if len(ids) <= 1:
                    m: Dict[str, Any] = {
                        "id": ids[0] if ids else "unknown",
                        "tokens": _clean_tokens(llm_tokens),
                    }
                    c = _num(_get(adapter, "cost_usd"))
                    if c is not None:
                        m["cost_usd"] = c
                        m["cost_source"] = _get(adapter, "cost_source") or "provider"
                    return {"models": [to_attr_dict(m)]}
                return {"models": [to_attr_dict({"id": i, "tokens": {}}) for i in ids]}
    except Exception:
        pass
    return {}


resolveUsageTelemetry = resolve_usage_telemetry

# ─────────────────────────────────────────────────
#  Run scoping (contextvars so OpenTelemetry spans reach the right run)
# ─────────────────────────────────────────────────

_run_scope: contextvars.ContextVar[Optional[UsageTracker]] = contextvars.ContextVar(
    "catelog_run_scope", default=None
)
_tracker_by_ctx: Dict[int, UsageTracker] = {}


def bind_tracker(ctx: Any, tracker: UsageTracker) -> None:
    _tracker_by_ctx[id(ctx)] = tracker


bindTracker = bind_tracker


def get_bound_tracker(ctx: Any) -> Optional[UsageTracker]:
    return _tracker_by_ctx.get(id(ctx))


def unbind_tracker(ctx: Any) -> None:
    _tracker_by_ctx.pop(id(ctx), None)


def get_current_tracker() -> Optional[UsageTracker]:
    return _run_scope.get()


def set_current_tracker(tracker: Optional[UsageTracker]) -> contextvars.Token[Optional[UsageTracker]]:
    return _run_scope.set(tracker)


def reset_current_tracker(token: contextvars.Token[Optional[UsageTracker]]) -> None:
    _run_scope.reset(token)


# ─────────────────────────────────────────────────
#  OpenTelemetry span processor (zero OTel dependency)
# ─────────────────────────────────────────────────

LLM_OPERATIONS = {"chat", "text_completion", "generate_content", "completion", "embeddings", "embed"}


def _cost_from_provider_metadata(raw: Any) -> Optional[Union[int, float]]:
    try:
        meta = json.loads(raw) if isinstance(raw, str) else raw
        if isinstance(meta, dict):
            return _num(meta.get("openrouter", {}).get("usage", {}).get("cost"))
    except Exception:
        pass
    return None


def usage_from_span(name: Optional[str], attrs: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    try:
        if not attrs or not isinstance(attrs, dict):
            return None
        operation = _str(attrs.get("gen_ai.operation.name"))
        has_gen_ai = any(
            k.startswith("gen_ai.request.model") or k.startswith("gen_ai.usage.") for k in attrs.keys()
        )
        is_vercel_call = isinstance(name, str) and bool(
            re.search(r"\.(doGenerate|doStream|doEmbed)$", name)
        )
        if not has_gen_ai and not is_vercel_call:
            return None
        if operation and operation not in LLM_OPERATIONS:
            return None

        model = (
            _str(attrs.get("gen_ai.response.model"))
            or _str(attrs.get("gen_ai.request.model"))
            or _str(attrs.get("ai.response.model"))
            or _str(attrs.get("ai.model.id"))
        )
        if not model:
            return None

        ai_provider = _str(attrs.get("ai.model.provider"))
        provider = (
            _str(attrs.get("gen_ai.provider.name"))
            or _str(attrs.get("gen_ai.system"))
            or (ai_provider.split(".")[0] if ai_provider else None)
        )

        def pick(*keys: str) -> Optional[Union[int, float]]:
            for k in keys:
                n = _num(attrs.get(k))
                if n is not None:
                    return n
            return None

        tokens = _clean_tokens(
            {
                "prompt": pick(
                    "gen_ai.usage.input_tokens",
                    "gen_ai.usage.prompt_tokens",
                    "ai.usage.inputTokens",
                    "ai.usage.promptTokens",
                ),
                "completion": pick(
                    "gen_ai.usage.output_tokens",
                    "gen_ai.usage.completion_tokens",
                    "ai.usage.outputTokens",
                    "ai.usage.completionTokens",
                ),
                "cached": pick(
                    "gen_ai.usage.cache_read.input_tokens",
                    "gen_ai.usage.cached_tokens",
                    "ai.usage.cachedInputTokens",
                ),
                "reasoning": pick(
                    "gen_ai.usage.reasoning_tokens",
                    "ai.usage.reasoningTokens",
                ),
            }
        )

        cost_usd = pick("gen_ai.usage.cost")
        if cost_usd is None:
            cost_usd = _cost_from_provider_metadata(attrs.get("ai.response.providerMetadata"))

        out: Dict[str, Any] = {
            "model": model,
            "tokens": tokens,
        }
        if provider:
            out["provider"] = provider
        if cost_usd is not None:
            out["costUsd"] = cost_usd
        return out
    except Exception:
        return None


usageFromSpan = usage_from_span


def _span_duration_ms(span: Any) -> Optional[Union[int, float]]:
    # Support JS-style hrtime [sec, ns] or Python OpenTelemetry start_time / end_time (nanoseconds)
    dur = _get(span, "duration")
    if isinstance(dur, (list, tuple)) and len(dur) == 2:
        if isinstance(dur[0], (int, float)) and isinstance(dur[1], (int, float)):
            ms = dur[0] * 1000 + dur[1] / 1e6
            return int(ms) if ms.is_integer() else ms
    start_ns = _get(span, "start_time")
    end_ns = _get(span, "end_time")
    if isinstance(start_ns, (int, float)) and isinstance(end_ns, (int, float)) and end_ns >= start_ns:
        ms = (end_ns - start_ns) / 1e6
        return int(ms) if ms.is_integer() else round(ms, 2)
    return None


class CatelogSpanProcessor:
    """
    Drop-in OpenTelemetry `SpanProcessor` for Python and JS-compatible span objects.
    Add it once to your OpenTelemetry `TracerProvider` and every `gen_ai.*` LLM span
    created during a run is attributed to that run's `telemetry.models`.
    """

    def __init__(self) -> None:
        self._pending: Dict[str, UsageTracker] = {}

    def _span_id(self, span: Any) -> Optional[str]:
        try:
            ctx_fn = getattr(span, "get_span_context", None) or getattr(span, "spanContext", None)
            if callable(ctx_fn):
                ctx = ctx_fn()
                sid = _get(ctx, "span_id") or _get(ctx, "spanId")
                if sid is not None:
                    return str(sid)
            ctx_obj = _get(span, "context")
            if ctx_obj is not None:
                sid = _get(ctx_obj, "span_id") or _get(ctx_obj, "spanId")
                if sid is not None:
                    return str(sid)
        except Exception:
            pass
        return None

    def on_start(self, span: Any, parent_context: Any = None) -> None:
        try:
            tracker = _run_scope.get()
            sid = self._span_id(span)
            if tracker is not None and sid:
                self._pending[sid] = tracker
        except Exception:
            pass

    def onStart(self, span: Any, parent_context: Any = None) -> None:
        self.on_start(span, parent_context)

    def on_end(self, span: Any) -> None:
        try:
            sid = self._span_id(span)
            tracker = (self._pending.pop(sid, None) if sid else None) or _run_scope.get()
            if tracker is None:
                return
            name = _get(span, "name")
            attrs = _get(span, "attributes")
            if attrs is not None and not isinstance(attrs, dict):
                try:
                    attrs = dict(attrs)
                except Exception:
                    attrs = None
            rec = usage_from_span(name, attrs)
            if rec:
                dur = _span_duration_ms(span)
                if dur is not None:
                    rec["latencyMs"] = dur
                tracker.record(rec, "provider")
        except Exception:
            pass

    def onEnd(self, span: Any) -> None:
        self.on_end(span)

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True

    async def forceFlush(self) -> None:
        return None

    def shutdown(self) -> None:
        self._pending.clear()


catelog_span_processor = CatelogSpanProcessor()
catelogSpanProcessor = catelog_span_processor


# ─────────────────────────────────────────────────
#  LangChain / LangGraph callback handler
# ─────────────────────────────────────────────────


class LangChainUsageHandler:
    """
    Callback handler that reports every LLM call of a LangChain / LangGraph run.
    Compatible with both Python LangChain (`on_llm_start`, `on_chat_model_start`, `on_llm_end`, `on_llm_error`)
    and JS-style (`handleLLMStart`, `handleChatModelStart`, `handleLLMEnd`, `handleLLMError`) callbacks.
    """

    name = "catelog-usage"
    raise_error = False
    ignore_llm = False
    ignore_chat_model = False
    ignore_chain = False
    ignore_agent = False
    ignore_retriever = False
    ignore_custom_event = False

    def __init__(self, usage: AgentUsage) -> None:
        self._usage = usage
        self._started: Dict[str, Dict[str, Any]] = {}

    def _start(
        self,
        serialized: Any,
        prompts_or_messages: Any,
        run_id: Any = None,
        parent_run_id: Any = None,
        extra_params: Any = None,
        tags: Any = None,
        metadata: Any = None,
        **kwargs: Any,
    ) -> None:
        try:
            rid = str(run_id or kwargs.get("run_id") or "")
            if not rid:
                return
            inv = _get(extra_params, "invocation_params") or kwargs.get("invocation_params") or {}
            meta = metadata or kwargs.get("metadata") or {}
            ser_kwargs = _get(serialized, "kwargs") or {}
            model = (
                _str(_get(inv, "model"))
                or _str(_get(inv, "model_name"))
                or _str(_get(meta, "ls_model_name"))
                or _str(_get(ser_kwargs, "model"))
                or _str(_get(ser_kwargs, "model_name"))
            )
            provider = _str(_get(meta, "ls_provider"))
            self._started[rid] = {
                "model": model,
                "provider": provider,
                "t0": int(time.time() * 1000),
            }
        except Exception:
            pass

    def on_llm_start(
        self,
        serialized: Any,
        prompts: Any,
        *,
        run_id: Any = None,
        parent_run_id: Any = None,
        tags: Any = None,
        metadata: Any = None,
        **kwargs: Any,
    ) -> None:
        self._start(serialized, prompts, run_id, parent_run_id, kwargs, tags, metadata, **kwargs)

    def on_chat_model_start(
        self,
        serialized: Any,
        messages: Any,
        *,
        run_id: Any = None,
        parent_run_id: Any = None,
        tags: Any = None,
        metadata: Any = None,
        **kwargs: Any,
    ) -> None:
        self._start(serialized, messages, run_id, parent_run_id, kwargs, tags, metadata, **kwargs)

    def handleLLMStart(
        self,
        llm: Any,
        prompts: Any,
        run_id: str,
        parent_run_id: Any = None,
        extra_params: Any = None,
        tags: Any = None,
        metadata: Any = None,
        **kwargs: Any,
    ) -> None:
        self._start(llm, prompts, run_id, parent_run_id, extra_params, tags, metadata, **kwargs)

    def handleChatModelStart(
        self,
        llm: Any,
        messages: Any,
        run_id: str,
        parent_run_id: Any = None,
        extra_params: Any = None,
        tags: Any = None,
        metadata: Any = None,
        **kwargs: Any,
    ) -> None:
        self._start(llm, messages, run_id, parent_run_id, extra_params, tags, metadata, **kwargs)

    def _end(self, output: Any, run_id: Any = None, **kwargs: Any) -> None:
        try:
            rid = str(run_id or kwargs.get("run_id") or "")
            info = self._started.pop(rid, None)

            gens_raw = _get(output, "generations") or []
            messages: List[Any] = []
            for row in gens_raw:
                if isinstance(row, list):
                    for g in row:
                        msg = _get(g, "message")
                        if msg is not None:
                            messages.append(msg)
                else:
                    msg = _get(row, "message")
                    if msg is not None:
                        messages.append(msg)

            def sum_msg(fn: Callable[[Any], Any]) -> int:
                total = 0
                for m in messages:
                    n = _num(fn(m))
                    if n is not None:
                        total += int(n)
                return total

            llm_output = _get(output, "llm_output") or _get(output, "llmOutput") or {}
            legacy = (
                _get(llm_output, "token_usage")
                or _get(llm_output, "tokenUsage")
                or _get(llm_output, "estimatedTokenUsage")
                or {}
            )

            prompt = _num(_get(legacy, "prompt_tokens") or _get(legacy, "promptTokens"))
            if prompt is None and messages:
                prompt = sum_msg(lambda m: _get(_get(m, "usage_metadata"), "input_tokens"))

            completion = _num(_get(legacy, "completion_tokens") or _get(legacy, "completionTokens"))
            if completion is None and messages:
                completion = sum_msg(lambda m: _get(_get(m, "usage_metadata"), "output_tokens"))

            msg_model: Optional[str] = None
            for m in messages:
                rm = _get(m, "response_metadata") or {}
                cand = _str(_get(rm, "model_name") or _get(rm, "model"))
                if cand:
                    msg_model = cand
                    break

            model = (
                (info.get("model") if info else None)
                or msg_model
                or _str(_get(llm_output, "model_name") or _get(llm_output, "model"))
            )
            if not model:
                return

            first_msg_model = (
                _str(_get(_get(messages[0], "response_metadata"), "model_name")) if messages else None
            )
            cached = sum_msg(
                lambda m: _get(_get(_get(m, "usage_metadata"), "input_token_details"), "cache_read")
            )
            reasoning = sum_msg(
                lambda m: _get(_get(_get(m, "usage_metadata"), "output_token_details"), "reasoning")
            )

            rec: Dict[str, Any] = {
                "model": first_msg_model or model,
                "tokens": {
                    "prompt": prompt,
                    "completion": completion,
                    "cached": cached if cached > 0 else None,
                    "reasoning": reasoning if reasoning > 0 else None,
                },
            }
            if info and info.get("provider"):
                rec["provider"] = info["provider"]
            if info and "t0" in info:
                rec["latencyMs"] = max(0, int(time.time() * 1000) - info["t0"])

            self._usage.record(rec)
        except Exception:
            pass

    def on_llm_end(self, response: Any, *, run_id: Any = None, **kwargs: Any) -> None:
        self._end(response, run_id, **kwargs)

    def handleLLMEnd(self, output: Any, run_id: str = "", **kwargs: Any) -> None:
        self._end(output, run_id, **kwargs)

    def on_llm_error(self, error: BaseException, *, run_id: Any = None, **kwargs: Any) -> None:
        rid = str(run_id or kwargs.get("run_id") or "")
        self._started.pop(rid, None)

    def handleLLMError(self, err: Any, run_id: str = "", **kwargs: Any) -> None:
        self._started.pop(str(run_id), None)


def create_langchain_usage_handler(usage: AgentUsage) -> LangChainUsageHandler:
    return LangChainUsageHandler(usage)


createLangChainUsageHandler = create_langchain_usage_handler

