from __future__ import annotations

import asyncio
import json
import sys
import urllib.request
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from catelog import AbortController, create_agent, pipe_claude_agent_stream

passed = 0
failed = 0


def check(condition: bool, label: str) -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"   ✅ {label}")
    else:
        failed += 1
        print(f"   ❌ {label}")


usage = {
    "claude-haiku-5-5": {
        "inputTokens": 100,
        "outputTokens": 40,
        "cacheReadInputTokens": 10,
        "cacheCreationInputTokens": 5,
        "webSearchRequests": 2,
        "costUSD": 0.01,
    }
}


def make_result(extra: Dict[str, Any] | None = None) -> Dict[str, Any]:
    return {
        "type": "result",
        "subtype": "success",
        "total_cost_usd": 0.0123,
        "num_turns": 3,
        "duration_api_ms": 900,
        "stop_reason": "end_turn",
        "modelUsage": usage,
        "result": "plain answer",
        **(extra or {}),
    }


def tool_use(name: str, input_data: Any = None) -> Dict[str, Any]:
    return {
        "type": "assistant",
        "message": {"content": [{"type": "tool_use", "name": name, "input": input_data or {}}]},
    }


async def gen(msgs: List[Any]) -> AsyncIterator[Any]:
    for m in msgs:
        yield m


async def rejects(coro: Any) -> Any:
    try:
        await coro
        return None
    except Exception as e:
        return e


class FakeStream:
    def __init__(self) -> None:
        self.events: List[Dict[str, Any]] = []

    def progress(self, p: float, m: str | None = None) -> None:
        self.events.append({"type": "progress", "text": m})

    def delta(self, t: str, delta_type: str = "text") -> None:
        self.events.append({"type": "delta", "text": t})

    def chunk(self, t: str) -> None:
        pass

    def write(self, t: str) -> None:
        pass

    def step(self, t: str) -> None:
        pass

    def emit(self, e: str, d: Any) -> None:
        pass

    def activity(self, n: str, d: Any = None) -> None:
        self.events.append({"type": "activity", "name": n})

    def is_closed(self) -> bool:
        return False

    def isClosed(self) -> bool:
        return False


async def main() -> None:
    print("🧪 Adapter tests: pipe_claude_agent_stream\n")

    print("1️⃣  Structured output + telemetry + events")
    stream = FakeStream()
    usage_cb: Any = None

    def set_usage(t: Any) -> None:
        nonlocal usage_cb
        usage_cb = t

    r = await pipe_claude_agent_stream(
        gen([tool_use("WebSearch", {"query": "x"}), tool_use("StructuredOutput"), make_result({"structured_output": {"a": 1}})]),
        stream,
        {"parse": lambda v: {**v, "parsed": True}, "onUsage": set_usage},
    )
    check(r.output.parsed is True and r.output.a == 1, "parse() applied to structured_output")
    check(
        r.telemetry.llm_tokens.prompt == 115 and r.telemetry.llm_tokens.completion == 40,
        "tokens summed (incl. cache)",
    )
    check(
        r.telemetry.model_used == "claude-haiku-5-5" and r.telemetry.cost_usd == 0.0123,
        "model + cost reported",
    )
    check(r.telemetry.framework.tool_calls.WebSearch == 1, "tool counted")
    check("StructuredOutput" not in r.telemetry.framework.tool_calls, "StructuredOutput hidden from counts")
    check(
        len([e for e in stream.events if e["type"] == "activity"]) == 1,
        "one activity event (internal tool hidden)",
    )
    check(usage_cb is not None and usage_cb.cost_usd == 0.0123, "onUsage fired")

    print("\n2️⃣  Plain text run (no schema)")
    stream2 = FakeStream()
    r2 = await pipe_claude_agent_stream(
        gen([{"type": "assistant", "message": {"content": [{"type": "text", "text": "hi"}]}}, make_result()]),
        stream2,
    )
    check(r2.output.text == "plain answer", "falls back to { text }")
    check(
        any(e["type"] == "delta" and e.get("text") == "hi" for e in stream2.events),
        "assistant text streamed as delta",
    )

    print("\n3️⃣  Errors map to Catelog codes")
    stream3 = FakeStream()
    rl = await rejects(
        pipe_claude_agent_stream(
            gen(
                [
                    {"type": "assistant", "error": "rate_limit", "message": {"content": []}},
                    make_result({"subtype": "error_during_execution"}),
                ]
            ),
            stream3,
        )
    )
    check(
        getattr(rl, "code", None) == "MODEL_RATE_LIMIT" and getattr(rl, "retryable", None) is True,
        "rate_limit → MODEL_RATE_LIMIT (retryable)",
    )
    bg = await rejects(
        pipe_claude_agent_stream(gen([make_result({"subtype": "error_max_budget_usd"})]), stream3)
    )
    check(
        getattr(bg, "code", None) == "BUDGET_EXCEEDED" and getattr(bg, "retryable", None) is False,
        "budget → BUDGET_EXCEEDED (not retryable)",
    )
    mt = await rejects(
        pipe_claude_agent_stream(gen([make_result({"subtype": "error_max_turns"})]), stream3)
    )
    check(getattr(mt, "code", None) == "TOOL_FAILURE", "max turns → TOOL_FAILURE")

    def bad_parse(v: Any) -> Any:
        raise ValueError("nope")

    bad = await rejects(
        pipe_claude_agent_stream(
            gen([make_result({"structured_output": {"a": 1}})]),
            stream3,
            {"parse": bad_parse},
        )
    )
    check(getattr(bad, "code", None) == "INTERNAL_CRASH", "parse failure → INTERNAL_CRASH")
    none_err = await rejects(pipe_claude_agent_stream(gen([]), stream3))
    check(getattr(none_err, "code", None) == "INTERNAL_CRASH", "no result → INTERNAL_CRASH")

    usage_on_fail = False

    def mark_fail_usage(t: Any) -> None:
        nonlocal usage_on_fail
        usage_on_fail = True

    await rejects(
        pipe_claude_agent_stream(
            gen([make_result({"subtype": "error_max_turns"})]),
            stream3,
            {"onUsage": mark_fail_usage},
        )
    )
    check(usage_on_fail, "onUsage still fires on failure (cost not lost)")

    print("\n4️⃣  Abort signal interrupts the query")
    stream4 = FakeStream()
    ac = AbortController()
    interrupted = False

    class InterruptibleQuery:
        def __init__(self, items: List[Any]) -> None:
            self._items = items

        def __aiter__(self) -> AsyncIterator[Any]:
            return gen(self._items)

        async def interrupt(self) -> None:
            nonlocal interrupted
            interrupted = True

    q = InterruptibleQuery([make_result({"structured_output": {}})])
    ac.abort()
    await pipe_claude_agent_stream(q, stream4, {"signal": ac.signal})
    await asyncio.sleep(0.01)
    check(interrupted, "interrupt() called when signal aborted")

    print("\n5️⃣  End to end through create_agent (HTTP)")

    async def e2e_exec(ctx: Any) -> Any:
        return await pipe_claude_agent_stream(
            gen([tool_use("WebSearch"), make_result({"structured_output": {"ok": True}})]),
            ctx.stream,
            {
                "signal": ctx.signal,
                "onUsage": lambda t: ctx.metric.gauge("cost_usd", t.cost_usd or 0),
            },
        )

    agent = create_agent(
        max_timeout_minute=1,
        name="Claude E2E",
        execute=e2e_exec,
    )
    server = agent.listen({"port": 0, "host": "127.0.0.1", "silent": True, "handleSignals": False})
    await asyncio.sleep(0.02)

    def _call() -> Dict[str, Any]:
        req = urllib.request.Request(
            f"http://127.0.0.1:{server.port}/execute",
            data=b'{"input": {}}',
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))

    res = await asyncio.to_thread(_call)
    check(res.get("status") == "completed" and res.get("output", {}).get("ok") is True, "completed with output")
    check(
        res.get("telemetry", {}).get("cost_usd") == 0.0123
        and res.get("telemetry", {}).get("llm_tokens", {}).get("total") == 155,
        "telemetry in HTTP response",
    )
    check(
        res.get("telemetry", {}).get("framework", {}).get("custom_metrics", {}).get("cost_usd") == 0.0123,
        "custom metric recorded",
    )
    await agent.shutdown(1000)
    server.close()

    print(f"\n{'─' * 50}")
    if failed == 0:
        print(f"🎉 All {passed} adapter tests passed!")
    else:
        print(f"⚠️  {passed} passed, {failed} failed")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

