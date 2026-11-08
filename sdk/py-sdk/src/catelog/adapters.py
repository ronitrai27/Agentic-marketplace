from __future__ import annotations

import inspect
import math
from typing import Any, AsyncIterator, Callable, Dict, Iterable, List, Optional, Set, Union

from .types import AbortSignal, AgentStream, AgentUsage, AttrDict, to_attr_dict
from .usage import create_langchain_usage_handler


class CatelogAdapterError(Exception):
    def __init__(self, message: str, code: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.retryable = retryable


async def _settle(val: Any) -> Any:
    try:
        if inspect.isawaitable(val):
            return await val
        return val
    except Exception:
        return None


def _num_or_undef(v: Any) -> Optional[Union[int, float]]:
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
        return v if v >= 0 else None
    return None


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


async def _iter_items(source: Any) -> AsyncIterator[Any]:
    if hasattr(source, "__aiter__"):
        async for item in source:
            yield item
    elif hasattr(source, "__iter__") and not isinstance(source, (str, bytes, dict)):
        for item in source:
            yield item


# ─────────────────────────────────────────────────
#  Vercel AI SDK / Generic Stream Result Adapter
# ─────────────────────────────────────────────────


async def pipe_ai_sdk_stream(ai_result: Any, stream: Any) -> AttrDict:
    full_text = ""
    telemetry: Dict[str, Any] = {"framework": {"adapter": "vercel-ai-sdk"}}

    try:
        text_stream = _get(ai_result, "textStream") or _get(ai_result, "text_stream")
        if text_stream is not None and (hasattr(text_stream, "__aiter__") or hasattr(text_stream, "__iter__")):
            async for chunk in _iter_items(text_stream):
                if isinstance(chunk, str) and len(chunk) > 0:
                    stream.delta(chunk)
                    full_text += chunk
        else:
            raw_text = await _settle(_get(ai_result, "text"))
            if isinstance(raw_text, str):
                full_text = raw_text
                stream.delta(full_text)
            elif ai_result is not None and (
                hasattr(ai_result, "__aiter__")
                or (hasattr(ai_result, "__iter__") and not isinstance(ai_result, (str, bytes, dict)))
            ):
                async for chunk in _iter_items(ai_result):
                    text = (
                        chunk
                        if isinstance(chunk, str)
                        else (_get(chunk, "textDelta") or _get(chunk, "delta") or "")
                    )
                    if text:
                        stream.delta(str(text))
                        full_text += str(text)

        usage_raw = _get(ai_result, "totalUsage")
        if usage_raw is None:
            usage_raw = _get(ai_result, "total_usage")
        if usage_raw is None:
            usage_raw = _get(ai_result, "usage")
        usage = await _settle(usage_raw)
        if usage:
            prompt = _num_or_undef(
                _get(usage, "inputTokens")
                if _get(usage, "inputTokens") is not None
                else (
                    _get(usage, "promptTokens")
                    if _get(usage, "promptTokens") is not None
                    else (_get(usage, "prompt_tokens") or _get(usage, "input_tokens"))
                )
            )
            completion = _num_or_undef(
                _get(usage, "outputTokens")
                if _get(usage, "outputTokens") is not None
                else (
                    _get(usage, "completionTokens")
                    if _get(usage, "completionTokens") is not None
                    else (_get(usage, "completion_tokens") or _get(usage, "output_tokens"))
                )
            )
            total = _num_or_undef(
                _get(usage, "totalTokens")
                if _get(usage, "totalTokens") is not None
                else _get(usage, "total_tokens")
            )
            if total is None:
                total = (prompt or 0) + (completion or 0)
            cached = _num_or_undef(_get(usage, "cachedInputTokens") or _get(usage, "cached_tokens"))
            reasoning = _num_or_undef(_get(usage, "reasoningTokens") or _get(usage, "reasoning_tokens"))
            toks: Dict[str, Any] = {
                "prompt": prompt,
                "completion": completion,
                "total": total,
            }
            if cached is not None:
                toks["cached"] = cached
            if reasoning is not None:
                toks["reasoning"] = reasoning
            telemetry["llm_tokens"] = toks

        response = await _settle(_get(ai_result, "response"))
        if response:
            model_id = _get(response, "modelId") or _get(response, "model_id") or _get(response, "model")
            if isinstance(model_id, str) and model_id:
                telemetry["model_used"] = model_id

        meta = await _settle(_get(ai_result, "providerMetadata") or _get(ai_result, "provider_metadata"))
        if meta:
            or_meta = _get(meta, "openrouter")
            or_usage = _get(or_meta, "usage") if or_meta else None
            gateway_cost = _num_or_undef(_get(or_usage, "cost"))
            if gateway_cost is not None:
                telemetry["cost_usd"] = gateway_cost
                telemetry["cost_source"] = "provider"

        tool_calls = _get(ai_result, "toolCalls") or _get(ai_result, "tool_calls")
        if isinstance(tool_calls, list):
            telemetry["framework"] = {
                **telemetry["framework"],
                "tool_calls": len(tool_calls),
                "tools_used": [
                    _get(tc, "toolName") or _get(tc, "tool_name") or _get(tc, "name")
                    for tc in tool_calls
                ],
            }
    except Exception:
        if full_text:
            return to_attr_dict({"output": {"text": full_text}, "telemetry": telemetry})
        raise

    return to_attr_dict({"output": {"text": full_text}, "telemetry": telemetry})


pipeAiSdkStream = pipe_ai_sdk_stream


# ─────────────────────────────────────────────────
#  OpenAI SDK Stream Adapter
# ─────────────────────────────────────────────────


async def pipe_openai_stream(openai_stream: Any, stream: Any) -> AttrDict:
    full_text = ""
    model: Optional[str] = None
    prompt_tokens: Optional[Union[int, float]] = None
    completion_tokens: Optional[Union[int, float]] = None
    cached: Optional[Union[int, float]] = None
    reasoning: Optional[Union[int, float]] = None
    real_cost: Optional[Union[int, float]] = None
    telemetry: Dict[str, Any] = {"framework": {"adapter": "openai"}}

    def capture_extras(u: Any) -> None:
        nonlocal cached, reasoning, real_cost
        p_details = _get(u, "prompt_tokens_details")
        c_details = _get(u, "completion_tokens_details")
        c_val = _num_or_undef(_get(p_details, "cached_tokens"))
        if c_val is not None:
            cached = c_val
        r_val = _num_or_undef(_get(c_details, "reasoning_tokens"))
        if r_val is not None:
            reasoning = r_val
        cost_val = _num_or_undef(_get(u, "cost"))
        if cost_val is not None:
            real_cost = cost_val

    try:
        is_stream = openai_stream is not None and (
            hasattr(openai_stream, "__aiter__")
            or (hasattr(openai_stream, "__iter__") and not isinstance(openai_stream, (str, bytes, dict)) and _get(openai_stream, "choices") is None)
        )
        if is_stream:
            async for chunk in _iter_items(openai_stream):
                choices = _get(chunk, "choices") or []
                first = choices[0] if len(choices) > 0 else None
                delta = _get(first, "delta") if first is not None else None
                if delta is not None:
                    content = _get(delta, "content")
                    if content:
                        stream.delta(str(content))
                        full_text += str(content)
                    tcs = _get(delta, "tool_calls")
                    if isinstance(tcs, list):
                        for tc in tcs:
                            fn = _get(tc, "function")
                            stream.activity(
                                "tool_call",
                                {
                                    "name": _get(fn, "name"),
                                    "arguments": _get(fn, "arguments"),
                                },
                            )
                c_model = _get(chunk, "model")
                if c_model and not model:
                    model = str(c_model)
                u = _get(chunk, "usage")
                if u is not None:
                    prompt_tokens = _num_or_undef(_get(u, "prompt_tokens"))
                    completion_tokens = _num_or_undef(_get(u, "completion_tokens"))
                    capture_extras(u)
        else:
            choices = _get(openai_stream, "choices") or []
            first = choices[0] if len(choices) > 0 else None
            message = _get(first, "message") if first is not None else None
            content = _get(message, "content") if message is not None else None
            if content:
                full_text = str(content)
                stream.delta(full_text)
                c_model = _get(openai_stream, "model")
                if c_model:
                    model = str(c_model)
                u = _get(openai_stream, "usage")
                if u is not None:
                    prompt_tokens = _num_or_undef(_get(u, "prompt_tokens"))
                    completion_tokens = _num_or_undef(_get(u, "completion_tokens"))
                    capture_extras(u)

        if model:
            telemetry["model_used"] = model
        if prompt_tokens is not None or completion_tokens is not None:
            toks: Dict[str, Any] = {
                "prompt": prompt_tokens,
                "completion": completion_tokens,
                "total": (prompt_tokens or 0) + (completion_tokens or 0),
            }
            if cached is not None:
                toks["cached"] = cached
            if reasoning is not None:
                toks["reasoning"] = reasoning
            telemetry["llm_tokens"] = toks
        if real_cost is not None:
            telemetry["cost_usd"] = real_cost
            telemetry["cost_source"] = "provider"
    except Exception:
        if full_text:
            return to_attr_dict({"output": {"text": full_text}, "telemetry": telemetry})
        raise

    return to_attr_dict({"output": {"text": full_text}, "telemetry": telemetry})


pipeOpenAiStream = pipe_openai_stream


# ─────────────────────────────────────────────────
#  OpenAI Responses API Adapter
# ─────────────────────────────────────────────────


async def pipe_openai_responses_stream(response: Any, stream: Any) -> AttrDict:
    telemetry: Dict[str, Any] = {"framework": {"adapter": "openai-responses"}}

    output_items = _get(response, "output") or []
    if isinstance(output_items, list):
        for item in output_items:
            item_type = _get(item, "type")
            if item_type in ("web_search_call", "search"):
                action = _get(item, "action")
                query = (_get(action, "query") if action else None) or _get(item, "query")
                stream.activity(
                    "web_search",
                    {
                        "query": query,
                        "status": _get(item, "status") or "completed",
                    },
                )
            elif item_type == "reasoning":
                summary = _get(item, "summary") or []
                if isinstance(summary, list):
                    reasoning_text = " ".join(str(_get(s, "text") or "") for s in summary).strip()
                    if reasoning_text:
                        stream.activity("reasoning", {"summary": reasoning_text[:200]})

    full_text = str(_get(response, "output_text") or "")
    if full_text:
        stream.delta(full_text)

    usage = _get(response, "usage")
    if usage is not None:
        inp_tok = _num_or_undef(
            _get(usage, "input_tokens")
            if _get(usage, "input_tokens") is not None
            else _get(usage, "prompt_tokens")
        )
        out_tok = _num_or_undef(
            _get(usage, "output_tokens")
            if _get(usage, "output_tokens") is not None
            else _get(usage, "completion_tokens")
        )
        tot_tok = _num_or_undef(_get(usage, "total_tokens"))
        if tot_tok is None:
            tot_tok = (inp_tok or 0) + (out_tok or 0)
        in_details = _get(usage, "input_tokens_details")
        out_details = _get(usage, "output_tokens_details")
        cached = _num_or_undef(_get(in_details, "cached_tokens"))
        reasoning = _num_or_undef(_get(out_details, "reasoning_tokens"))
        toks: Dict[str, Any] = {
            "prompt": inp_tok,
            "completion": out_tok,
            "total": tot_tok,
        }
        if cached is not None:
            toks["cached"] = cached
        if reasoning is not None:
            toks["reasoning"] = reasoning
        telemetry["llm_tokens"] = toks

        real_cost = _num_or_undef(_get(usage, "cost"))
        if real_cost is not None:
            telemetry["cost_usd"] = real_cost
            telemetry["cost_source"] = "provider"

    resp_model = _get(response, "model")
    if isinstance(resp_model, str) and resp_model:
        telemetry["model_used"] = resp_model

    return to_attr_dict({"output": {"text": full_text}, "telemetry": telemetry})


pipeOpenAiResponsesStream = pipe_openai_responses_stream


# ─────────────────────────────────────────────────
#  LangGraph / LangChain Adapter
# ─────────────────────────────────────────────────


async def pipe_langgraph_stream(
    graph: Any,
    graph_input: Dict[str, Any],
    stream: Any,
    options: Optional[Dict[str, Any]] = None,
    *,
    signal: Optional[AbortSignal] = None,
    usage: Optional[AgentUsage] = None,
) -> AttrDict:
    opts = options or {}
    sig = signal or opts.get("signal")
    usg = usage or opts.get("usage")
    last_output: Any = None
    node_count = 0
    nodes_visited: List[str] = []
    telemetry: Dict[str, Any] = {"framework": {"adapter": "langgraph"}}
    callbacks = [create_langchain_usage_handler(usg)] if usg is not None else None

    config: Dict[str, Any] = {}
    if callbacks is not None:
        config["callbacks"] = callbacks
    if sig is not None:
        config["signal"] = sig

    try:
        astream_fn = getattr(graph, "astream", None)
        stream_fn = getattr(graph, "stream", None) or getattr(graph, "streamEvents", None)
        if not callable(astream_fn) and not callable(stream_fn):
            ainvoke_fn = getattr(graph, "ainvoke", None)
            invoke_fn = getattr(graph, "invoke", None)
            if callable(ainvoke_fn):
                res = await ainvoke_fn(graph_input, config)
            elif callable(invoke_fn):
                res = await _settle(invoke_fn(graph_input, config))
            else:
                res = {}
            return to_attr_dict({"output": res, "telemetry": telemetry})

        if callable(astream_fn):
            try:
                graph_stream = astream_fn(graph_input, config=config, stream_mode="updates")
            except TypeError:
                graph_stream = astream_fn(graph_input, config)
            if inspect.isawaitable(graph_stream):
                graph_stream = await graph_stream
        else:
            assert callable(stream_fn)
            try:
                graph_stream = stream_fn(
                    graph_input,
                    {**config, "streamMode": "updates"},
                )
            except TypeError:
                graph_stream = stream_fn(graph_input)
            if inspect.isawaitable(graph_stream):
                graph_stream = await graph_stream

        async for event in _iter_items(graph_stream):
            if isinstance(event, dict):
                for node_name, node_output in event.items():
                    node_count += 1
                    nodes_visited.append(str(node_name))
                    stream.activity("graph_node", {"node": str(node_name), "step": node_count})
                    if isinstance(node_output, dict):
                        messages = node_output.get("messages") or []
                        if isinstance(messages, list):
                            for msg in messages:
                                content = _get(msg, "content")
                                if isinstance(content, str) and content:
                                    stream.delta(content)
                    last_output = node_output

        telemetry["framework"] = {
            **telemetry["framework"],
            "nodes_visited": nodes_visited,
            "node_count": node_count,
        }
    except Exception:
        if last_output is not None:
            return to_attr_dict({"output": last_output, "telemetry": telemetry})
        raise

    return to_attr_dict({"output": last_output if last_output is not None else {}, "telemetry": telemetry})


pipeLangGraphStream = pipe_langgraph_stream


# ─────────────────────────────────────────────────
#  Generic Async/Sync Iterable Adapter
# ─────────────────────────────────────────────────


async def pipe_async_iterable_stream(iterable: Any, stream: Any) -> AttrDict:
    full_text = ""
    telemetry: Dict[str, Any] = {"framework": {"adapter": "generic-iterable"}}

    async for chunk in _iter_items(iterable):
        text = (
            chunk
            if isinstance(chunk, str)
            else (_get(chunk, "text") or _get(chunk, "content") or _get(chunk, "delta") or "")
        )
        if text:
            stream.delta(str(text))
            full_text += str(text)

    return to_attr_dict({"output": {"text": full_text}, "telemetry": telemetry})


pipeAsyncIterableStream = pipe_async_iterable_stream


# ─────────────────────────────────────────────────
#  Claude Agent SDK Adapter
# ─────────────────────────────────────────────────

CLAUDE_API_ERRORS: Dict[str, tuple[str, bool]] = {
    "rate_limit": ("MODEL_RATE_LIMIT", True),
    "overloaded": ("MODEL_RATE_LIMIT", True),
    "server_error": ("UPSTREAM_TIMEOUT", True),
    "authentication_failed": ("MODEL_AUTH_FAILED", False),
    "billing_error": ("MODEL_BILLING_ERROR", False),
    "model_not_found": ("MODEL_NOT_FOUND", False),
    "invalid_request": ("MODEL_INVALID_REQUEST", False),
}


async def pipe_claude_agent_stream(
    claude_stream: Any,
    stream: Any,
    options: Optional[Dict[str, Any]] = None,
    *,
    parse: Optional[Callable[[Any], Any]] = None,
    signal: Optional[AbortSignal] = None,
    on_usage: Optional[Callable[[AttrDict], Any]] = None,
    onUsage: Optional[Callable[[AttrDict], Any]] = None,
    hide_tools: Optional[List[str]] = None,
    hideTools: Optional[List[str]] = None,
) -> AttrDict:
    opts = options or {}
    parse_fn = parse or opts.get("parse")
    sig: Optional[AbortSignal] = signal or opts.get("signal")
    on_usage_fn = on_usage or onUsage or opts.get("on_usage") or opts.get("onUsage")
    ht = (
        hide_tools
        if hide_tools is not None
        else (hideTools if hideTools is not None else opts.get("hide_tools", opts.get("hideTools")))
    )
    hidden: Set[str] = set(ht if ht is not None else ["StructuredOutput"])

    tool_calls: Dict[str, int] = {}
    tool_count = 0
    api_error: Optional[str] = None
    streamed_text = ""

    def on_abort() -> None:
        try:
            interrupt_fn = getattr(claude_stream, "interrupt", None) or (
                claude_stream.get("interrupt") if isinstance(claude_stream, dict) else None
            )
            if callable(interrupt_fn):
                res = interrupt_fn()
                if inspect.isawaitable(res):
                    import asyncio
                    try:
                        asyncio.get_running_loop().create_task(res)
                    except RuntimeError:
                        pass
        except Exception:
            pass

    if sig is not None:
        if sig.aborted:
            on_abort()
        else:
            sig.add_event_listener("abort", on_abort, {"once": True})

    try:
        async for msg in _iter_items(claude_stream):
            msg_type = _get(msg, "type")
            if msg_type == "assistant":
                err = _get(msg, "error")
                if err:
                    api_error = str(err)
                inner_msg = _get(msg, "message")
                blocks = _get(inner_msg, "content") if inner_msg is not None else (_get(msg, "content") or [])
                if isinstance(blocks, list):
                    for block in blocks:
                        b_type = _get(block, "type")
                        if b_type == "text":
                            txt = _get(block, "text")
                            if txt:
                                stream.delta(str(txt))
                                streamed_text += str(txt)
                        elif b_type == "tool_use":
                            b_name = str(_get(block, "name") or "")
                            if b_name and b_name not in hidden:
                                tool_calls[b_name] = tool_calls.get(b_name, 0) + 1
                                tool_count += 1
                                b_input = _get(block, "input")
                                stream.activity(
                                    b_name,
                                    b_input if isinstance(b_input, dict) else {},
                                )
                                stream.progress(min(15 + tool_count * 12, 85), f"Using {b_name}")
                continue

            if msg_type != "result":
                continue

            usage_map = _get(msg, "modelUsage") or _get(msg, "model_usage") or {}
            if not isinstance(usage_map, dict):
                usage_map = {}

            def sum_field(*keys: str) -> int:
                total = 0
                for u in usage_map.values():
                    for k in keys:
                        v = _get(u, k)
                        if isinstance(v, (int, float)):
                            total += int(v)
                            break
                return total

            prompt = (
                sum_field("inputTokens", "input_tokens")
                + sum_field("cacheReadInputTokens", "cache_read_input_tokens")
                + sum_field("cacheCreationInputTokens", "cache_creation_input_tokens")
            )
            completion = sum_field("outputTokens", "output_tokens")

            model_breakdown: List[Dict[str, Any]] = []
            for m_id, u in usage_map.items():
                in_t = int(_get(u, "inputTokens") or _get(u, "input_tokens") or 0)
                cr_t = int(_get(u, "cacheReadInputTokens") or _get(u, "cache_read_input_tokens") or 0)
                cc_t = int(_get(u, "cacheCreationInputTokens") or _get(u, "cache_creation_input_tokens") or 0)
                out_t = int(_get(u, "outputTokens") or _get(u, "output_tokens") or 0)
                p_toks = in_t + cr_t + cc_t
                m_cost = _num_or_undef(
                    _get(u, "costUSD") if _get(u, "costUSD") is not None else _get(u, "cost_usd")
                )
                tok_dict: Dict[str, Any] = {
                    "prompt": p_toks,
                    "completion": out_t,
                    "total": p_toks + out_t,
                }
                if cr_t:
                    tok_dict["cached"] = cr_t
                m_entry: Dict[str, Any] = {
                    "id": str(m_id),
                    "provider": "anthropic",
                    "tokens": tok_dict,
                }
                if m_cost is not None:
                    m_entry["cost_usd"] = m_cost
                    m_entry["cost_source"] = "provider"
                model_breakdown.append(m_entry)

            total_cost = _num_or_undef(_get(msg, "total_cost_usd"))
            subtype = _get(msg, "subtype")
            telemetry: Dict[str, Any] = {
                "llm_tokens": {"prompt": prompt, "completion": completion, "total": prompt + completion},
                "model_used": ",".join(usage_map.keys()) if usage_map else None,
                "models": model_breakdown if model_breakdown else None,
                "framework": {
                    "adapter": "claude-agent-sdk",
                    "num_turns": _get(msg, "num_turns"),
                    "duration_api_ms": _get(msg, "duration_api_ms"),
                    "tool_calls": tool_calls,
                    "web_search_requests": sum_field("webSearchRequests", "web_search_requests"),
                    "cache_read_tokens": sum_field("cacheReadInputTokens", "cache_read_input_tokens"),
                    "cache_creation_tokens": sum_field("cacheCreationInputTokens", "cache_creation_input_tokens"),
                    "stop_reason": _get(msg, "stop_reason"),
                    "result_subtype": subtype,
                },
            }
            if total_cost is not None:
                telemetry["cost_usd"] = total_cost
                telemetry["cost_source"] = "provider"

            tel_attr = to_attr_dict(telemetry)
            if callable(on_usage_fn):
                on_usage_fn(tel_attr)

            if subtype == "success":
                structured = _get(msg, "structured_output")
                if structured is not None:
                    try:
                        output = parse_fn(structured) if callable(parse_fn) else structured
                    except Exception as exc:
                        raise CatelogAdapterError(
                            f"Model output failed validation: {exc}",
                            "INTERNAL_CRASH",
                            True,
                        ) from exc
                    return to_attr_dict({"output": output, "telemetry": tel_attr})
                res_text = _get(msg, "result")
                return to_attr_dict(
                    {
                        "output": {"text": res_text if res_text is not None else streamed_text},
                        "telemetry": tel_attr,
                    }
                )

            if api_error and api_error in CLAUDE_API_ERRORS:
                code, retryable = CLAUDE_API_ERRORS[api_error]
                raise CatelogAdapterError(f"Claude API error: {api_error}", code, retryable)
            if subtype == "error_max_budget_usd":
                raise CatelogAdapterError("Run exceeded its cost cap", "BUDGET_EXCEEDED", False)
            if subtype == "error_max_turns":
                raise CatelogAdapterError("Agent ran out of turns", "TOOL_FAILURE", True)
            if _get(msg, "api_error_status") == 429:
                raise CatelogAdapterError("Model rate limit reached", "MODEL_RATE_LIMIT", True)
            raise CatelogAdapterError(f"Claude agent failed ({subtype})", "INTERNAL_CRASH", True)
    finally:
        if sig is not None:
            sig.remove_event_listener("abort", on_abort)

    if sig is not None and sig.aborted:
        err = Exception("aborted")
        setattr(err, "name", "AbortError")
        raise err
    raise CatelogAdapterError("Claude agent ended without a result", "INTERNAL_CRASH", True)


pipeClaudeAgentStream = pipe_claude_agent_stream

