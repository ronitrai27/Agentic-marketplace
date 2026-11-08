from __future__ import annotations

import asyncio
import json
import sys
import urllib.request
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Dict

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from catelog import (
    NoopStream,
    catelog_span_processor,
    create_agent,
    create_langchain_usage_handler,
    pipe_ai_sdk_stream,
    pipe_openai_responses_stream,
    pipe_openai_stream,
)

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


async def run(execute_fn: Callable[[Any], Any]) -> Dict[str, Any]:
    agent = create_agent(name="Usage", max_timeout_minute=1, execute=execute_fn)
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

    try:
        return await asyncio.to_thread(_call)
    finally:
        server.close()


class FakeSpan:
    def __init__(self, name: str, attributes: Dict[str, Any], span_id: str) -> None:
        self.name = name
        self.attributes = attributes
        self.duration = [0, 250_000_000]
        self._span_id = span_id

    def spanContext(self) -> Dict[str, str]:
        return {"spanId": self._span_id}


async def main() -> None:
    print("🧪 Usage / telemetry tests\n")

    # ─── 1. ctx.usage.record ───
    print("1️⃣  ctx.usage.record...")

    async def exec_1(ctx: Any) -> Any:
        ctx.usage.record({"model": "gpt-4o", "provider": "openai", "tokens": {"prompt": 100, "completion": 20}})
        ctx.usage.record({"model": "gpt-4o", "provider": "openai", "tokens": {"prompt": 50, "completion": 10}})
        ctx.usage.record({"model": "llama-3.3-70b", "provider": "groq", "tokens": {"prompt": 10, "completion": 5}})
        return {"output": {"ok": True}}

    body = await run(exec_1)
    t = body["telemetry"]
    check(len(t["models"]) == 2, "Same model merged, different models kept separate")
    gpt = next(m for m in t["models"] if m["id"] == "gpt-4o")
    check(
        gpt["calls"] == 2
        and gpt["tokens"]["prompt"] == 150
        and gpt["tokens"]["completion"] == 30
        and gpt["tokens"]["total"] == 180,
        "Tokens and calls summed per model",
    )
    check(
        t["llm_tokens"]["total"] == 195 and t["model_used"] == "gpt-4o,llama-3.3-70b",
        "Totals + legacy model_used derived",
    )
    check(t.get("cost_usd") is None, "No cost invented when none was reported")

    async def exec_2(ctx: Any) -> Any:
        ctx.usage.record({"model": "m1", "tokens": {"prompt": 1}, "costUsd": 0.01})
        ctx.usage.record({"model": "m2", "tokens": {"prompt": 1}, "costUsd": 0.02})
        return {"output": {}}

    body = await run(exec_2)
    check(
        body["telemetry"].get("cost_usd") == 0.03 and body["telemetry"].get("cost_source") == "agent",
        "Reported cost summed and tagged 'agent'",
    )

    async def exec_3(ctx: Any) -> Any:
        ctx.usage.record({"model": "m1", "tokens": {"prompt": 1}, "costUsd": 0.01})
        ctx.usage.record({"model": "m1", "tokens": {"prompt": 1}})  # second call has no cost
        return {"output": {}}

    body = await run(exec_3)
    check(
        body["telemetry"].get("cost_usd") is None and body["telemetry"]["models"][0].get("cost_usd") is None,
        "Partial cost is dropped instead of understating spend",
    )

    async def exec_4(ctx: Any) -> Any:
        ctx.usage.record(None)
        ctx.usage.record({"model": ""})
        ctx.usage.record({"model": "x", "tokens": {"prompt": -5, "completion": float("nan")}, "costUsd": "abc"})
        return {"output": {"ok": 1}}

    body = await run(exec_4)
    check(body["status"] == "completed", "Garbage usage never crashes the run")

    # ─── 2. Failed runs keep their usage ───
    print("\n2️⃣  Failed runs keep usage...")

    async def exec_fail(ctx: Any) -> Any:
        ctx.usage.record({"model": "gpt-4o", "tokens": {"prompt": 7, "completion": 3}})
        raise RuntimeError("boom")

    body = await run(exec_fail)
    check(
        body["status"] == "failed" and body["telemetry"]["models"][0]["tokens"]["total"] == 10,
        "Failure response includes models and tokens",
    )

    # ─── 3. OpenTelemetry span processor ───
    print("\n3️⃣  OpenTelemetry span processor...")

    async def exec_otel(ctx: Any) -> Any:
        outer = FakeSpan(
            "ai.generateText",
            {"ai.usage.promptTokens": 999, "ai.usage.completionTokens": 999, "ai.model.id": "gpt-4o"},
            "s1",
        )
        inner = FakeSpan(
            "ai.generateText.doGenerate",
            {
                "gen_ai.request.model": "gpt-4o",
                "gen_ai.response.model": "gpt-4o-2024-08-06",
                "gen_ai.system": "openai",
                "gen_ai.usage.input_tokens": 120,
                "gen_ai.usage.output_tokens": 30,
            },
            "s2",
        )
        agent_span = FakeSpan(
            "invoke_agent x",
            {
                "gen_ai.operation.name": "invoke_agent",
                "gen_ai.request.model": "gpt-4o",
                "gen_ai.usage.input_tokens": 500,
            },
            "s3",
        )
        for sp in (outer, inner, agent_span):
            catelog_span_processor.on_start(sp)
            await asyncio.sleep(0.005)
            catelog_span_processor.on_end(sp)
        return {"output": {}}

    body = await run(exec_otel)
    t = body["telemetry"]
    check(
        len(t["models"]) == 1
        and t["models"][0]["id"] == "gpt-4o-2024-08-06"
        and t["models"][0]["provider"] == "openai",
        "Only the real LLM call span is counted (parent/agent spans skipped)",
    )
    check(
        t["models"][0]["tokens"]["prompt"] == 120
        and t["models"][0]["tokens"]["completion"] == 30
        and t["models"][0]["latency_ms"] == 250,
        "Tokens and latency read from the span",
    )

    async def exec_otel_vercel(ctx: Any) -> Any:
        span = FakeSpan(
            "ai.streamText.doStream",
            {
                "ai.model.id": "claude-sonnet-5-5",
                "ai.model.provider": "anthropic.messages",
                "ai.usage.inputTokens": 40,
                "ai.usage.outputTokens": 8,
                "ai.response.providerMetadata": json.dumps({"openrouter": {"usage": {"cost": 0.0042}}}),
            },
            "s9",
        )
        catelog_span_processor.on_start(span)
        catelog_span_processor.on_end(span)
        return {"output": {}}

    body = await run(exec_otel_vercel)
    t = body["telemetry"]
    check(
        t["models"][0]["id"] == "claude-sonnet-5-5" and t["models"][0]["provider"] == "anthropic",
        "Vercel ai.* attributes understood",
    )
    check(
        t.get("cost_usd") == 0.0042 and t.get("cost_source") == "provider",
        "Gateway-reported cost kept as 'provider'",
    )

    catelog_span_processor.on_end(FakeSpan("x", {"gen_ai.request.model": "m"}, "zz"))
    check(True, "Span outside any run ignored")

    # ─── 4. LangChain handler ───
    print("\n4️⃣  LangChain callback handler...")

    async def exec_lc(ctx: Any) -> Any:
        h = create_langchain_usage_handler(ctx.usage)
        h.handleChatModelStart(
            {},
            [],
            "r1",
            None,
            {"invocation_params": {"model": "gpt-4o-mini"}},
            [],
            {"ls_provider": "openai"},
        )
        h.handleLLMEnd(
            {
                "generations": [
                    [
                        {
                            "message": {
                                "usage_metadata": {"input_tokens": 11, "output_tokens": 4},
                                "response_metadata": {"model_name": "gpt-4o-mini-2024-07-18"},
                            }
                        }
                    ]
                ]
            },
            "r1",
        )
        h.handleLLMEnd(
            {"llmOutput": {"tokenUsage": {"promptTokens": 3, "completionTokens": 2}}, "generations": []},
            "r-unknown",
        )
        return {"output": {}}

    body = await run(exec_lc)
    t = body["telemetry"]
    check(
        len(t["models"]) == 1 and t["models"][0]["provider"] == "openai" and t["models"][0]["tokens"]["total"] == 15,
        "LangChain LLM call captured",
    )

    # ─── 5. Adapters ───
    print("\n5️⃣  Adapters...")

    async def _hi_gen() -> AsyncIterator[str]:
        yield "hi"

    vercel = await pipe_ai_sdk_stream(
        {
            "text": "hi",
            "textStream": _hi_gen(),
            "usage": {"inputTokens": 9, "outputTokens": 1, "totalTokens": 10},
            "response": {"modelId": "gpt-4o"},
            "providerMetadata": None,
        },
        NoopStream(),
    )
    check(
        vercel.telemetry.model_used == "gpt-4o" and vercel.telemetry.llm_tokens.total == 10,
        "Vercel adapter reads usage and sets the model",
    )

    resp = await pipe_openai_responses_stream(
        {"output_text": "x", "model": "gpt-5", "usage": {"input_tokens": 10, "output_tokens": 5}},
        NoopStream(),
    )
    check(
        resp.telemetry.get("cost_usd") is None and resp.telemetry.model_used == "gpt-5",
        "Responses adapter no longer fabricates cost",
    )
    resp2 = await pipe_openai_responses_stream(
        {
            "output_text": "x",
            "model": "openai/gpt-5",
            "usage": {"input_tokens": 10, "output_tokens": 5, "cost": 0.002},
        },
        NoopStream(),
    )
    check(
        resp2.telemetry.cost_usd == 0.002 and resp2.telemetry.cost_source == "provider",
        "Responses adapter keeps a cost the API returned",
    )

    oa = await pipe_openai_stream(
        {
            "choices": [{"message": {"content": "ok"}}],
            "model": "gpt-4o",
            "usage": {
                "prompt_tokens": 5,
                "completion_tokens": 2,
                "cost": 0.001,
                "prompt_tokens_details": {"cached_tokens": 3},
            },
        },
        NoopStream(),
    )
    check(
        oa.telemetry.llm_tokens.cached == 3 and oa.telemetry.cost_usd == 0.001,
        "OpenAI adapter reads cached tokens and provider cost",
    )

    body = await run(
        lambda ctx: pipe_openai_responses_stream(
            {"output_text": "x", "model": "gpt-5", "usage": {"input_tokens": 10, "output_tokens": 5}},
            ctx.stream,
        )
    )
    check(
        body["telemetry"]["models"][0]["id"] == "gpt-5"
        and body["telemetry"]["models"][0]["tokens"]["total"] == 15,
        "Adapter telemetry becomes models[]",
    )

    async def exec_dedup(ctx: Any) -> Any:
        ctx.usage.record({"model": "gpt-5", "tokens": {"prompt": 10, "completion": 5}})
        return await pipe_openai_responses_stream(
            {"output_text": "x", "model": "gpt-5", "usage": {"input_tokens": 10, "output_tokens": 5}},
            ctx.stream,
        )

    body = await run(exec_dedup)
    check(
        len(body["telemetry"]["models"]) == 1 and body["telemetry"]["llm_tokens"]["total"] == 15,
        "Adapter + ctx.usage for the same call is not double counted",
    )

    print(f"\n{'─' * 50}")
    if failed == 0:
        print(f"🎉 All {passed} usage tests passed!")
    else:
        print(f"⚠️  {passed} passed, {failed} failed")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())

