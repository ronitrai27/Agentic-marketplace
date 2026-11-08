# Catelog Python SDK (`catelog`)

Official Python SDK for the **Marketplace Agent Protocol Specification (MAPS)**.

Turn any Python AI agent (OpenAI, Claude Agent SDK, LangGraph, LangChain, CrewAI, or custom Python) into a marketplace-compliant HTTP & SSE service in under 20 lines of code.

## Features

- **Inferred Task Lifecycle**: Return a value → `task.completed`; raise an error → `task.failed`; `ctx.need_input()` → `task.input_required`.
- **Dual-Mode Security**:
  - Gateway HMAC-SHA256 verification (`X-Marketplace-Signature`) with timestamp drift and nonce/run-id replay protection.
  - Bearer Secret Key (`cat_sec_live_...`) & Public Key (`cat_pub_live_...`).
  - Ed25519 Marketplace Test Tokens (`cat_test_...`) for Creator Space dry runs (pure-Python RFC 8032 verifier included, zero C dependencies).
  - Automatic permissive Dev Mode when no secret key is set outside production.
- **Real-Time SSE Streaming**:
  - `stream.progress()`, `stream.step()`, `stream.delta()`, `stream.write()`, `stream.chunk()`, `stream.activity()`, `stream.emit()`.
  - 15-second keep-alive heartbeats and automatic client disconnect detection (`stream.is_closed()`, `ctx.signal`).
- **2-Layer Telemetry & Usage Tracking**:
  - Automatic base metrics (`duration_ms`, `input_bytes`, `output_bytes`, `chunks_streamed`) + background non-blocking reporter.
  - Per-model token & cost tracking via `ctx.usage.record()`, `catelog_span_processor` (OpenTelemetry `gen_ai.*` spans), `create_langchain_usage_handler`, and framework stream adapters.
- **Framework Adapters**:
  - `pipe_openai_stream`, `pipe_openai_responses_stream`, `pipe_langgraph_stream`, `pipe_claude_agent_stream`, `pipe_ai_sdk_stream`, `pipe_async_iterable_stream`.
- **Production Readiness**:
  - Execution modes: `"sync"`, `"async"` (202 Accepted + `GET /tasks/:id?since=` live event polling), and `"conversational"` (HITL multi-turn with session store).
  - Pluggable async job persistence: `MemoryJobStore`, `RedisJobStore`, `SqliteJobStore` (built-in `sqlite3`).
  - Request protection limits: `max_concurrent`, `max_body_bytes`, `rate_limit`, `trust_proxy`.
  - Enforced `max_timeout_minute` deadline and graceful `shutdown()` draining (`503 SHUTTING_DOWN`).
  - Built-in standalone `asyncio` HTTP server (`agent.listen(3000)`) + ASGI app mounting (`app.mount("/agent", agent.asgi_app())` for FastAPI / Starlette / Uvicorn).

## Quick Start

```python
from pydantic import BaseModel
from catelog import create_agent

class Input(BaseModel):
    text: str

async def execute(ctx):
    ctx.stream.progress(50, "Summarizing...")
    ctx.stream.delta("Hello from Python!")
    return {"output": {"summary": ctx.input.text[:100]}}

agent = create_agent(
    name="Python Summarizer",
    max_timeout_minute=5,
    input_schema=Input,
    execute=execute,
)

if __name__ == "__main__":
    agent.listen(3000)
```

See [`Catelog-PY.md`](./Catelog-PY.md) for the complete setup guide and recipes.

