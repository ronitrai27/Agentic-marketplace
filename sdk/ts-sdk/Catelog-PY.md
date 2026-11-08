# Catelog SDK (Python) — Setup Guide

> Installed by `catelog init` or `npx catelog init --lang py`. Read it yourself, or point your coding assistant at it.

`catelog` turns any AI agent (Claude Agent SDK, OpenAI, LangGraph, LangChain, CrewAI, or plain Python) into a marketplace-ready HTTP service. You write one `execute()` function; the SDK provides:

| Endpoint | Purpose |
| :--- | :--- |
| `GET /health` | Liveness probe, used when you register the agent |
| `GET /schema` | Manifest + input/output JSON Schemas (builds the buyer's form) |
| `POST /execute` | Runs the agent, via SSE stream or JSON |
| `GET /tasks/:id` | Polls a background job (`mode="async"` only) |

Requires **Python 3.10+**. Zero external C-extension dependencies required.

---

## 1. Install

```bash
pip install catelog pydantic      # or: uv add catelog pydantic | poetry add catelog pydantic
```

`pydantic` is optional. It gives you typed input validation and auto-generated marketplace forms (dataclasses and raw JSON Schema dicts also work out of the box).

## 2. CLI commands

```bash
catelog init                     # asks: add this guide? then Python or TypeScript
catelog init --yes               # no questions, installs Catelog-PY.md
catelog init --lang ts           # installs Catelog-TS.md
catelog init --force             # overwrite an existing guide
catelog --version
catelog --help
```

## 3. Environment

```env
CATELOG_SECRET_KEY=cat_sec_live_...     # production auth (required when PYTHON_ENV=production)
CATELOG_PUBLIC_KEY=cat_pub_live_...     # optional, read-only endpoints + dry-run test tokens
CATELOG_TELEMETRY_URL=https://...       # optional telemetry endpoint
CATELOG_TELEMETRY_DISABLED=false        # optional
CATELOG_SILENT=false                    # optional, hides banner output
PORT=3000
```

With no secret key and `PYTHON_ENV` / `CATELOG_ENV` not `production`, the SDK runs in permissive **dev mode** (no auth, warning logged).

## 4. Minimal agent

```python
from pydantic import BaseModel, Field
from catelog import create_agent

class SummarizeInput(BaseModel):
    text: str = Field(..., min_length=1)

async def execute(ctx):
    ctx.stream.progress(20, "Reading...")
    ctx.stream.delta("Working on it...\n")
    return {"output": {"summary": ctx.input.text[:100]}}

agent = create_agent(
    max_timeout_minute=5,  # required: hard limit per run, in minutes
    name="Summarizer",
    input_schema=SummarizeInput,
    execute=execute,
)

if __name__ == "__main__":
    agent.listen(3000)     # alias: agent.serve(3000)
```

- **Return** a value → task completes. **Raise** an exception → task fails. You never set task state by hand.
- Returning `{"output": ..., "telemetry": ...}` or a plain dict/model both work.
- Both `snake_case` (`create_agent(max_timeout_minute=5, input_schema=...)`) and `camelCase` (`createAgent({"maxTimeoutMinute": 5, "inputSchema": ...})`) are supported.

---

### Do I need a separate server file?

**No.** `catelog` *is* the server. Pick one:

| You have... | Do this |
| :--- | :--- |
| Nothing yet (new agent) | `agent.listen(3000)`. Done, that is the whole server. |
| An existing FastAPI / Starlette / ASGI server | `app.mount("/agent", agent.asgi_app())`. No second port, no second process. |

```python
# Existing FastAPI app: mount the agent as a sub-application
from fastapi import FastAPI
from my_agent import agent

app = FastAPI()

@app.get("/")
def home():
    return "my existing app"

app.mount("/agent", agent.asgi_app())  # /agent/health, /agent/schema, /agent/execute, /agent/tasks/:id
```

When you register on the marketplace, give it the URL that serves `/health` and `/schema` (e.g. `https://api.example.com/agent`).

---

## 5. Streaming events (SSE)

Everything you call on `ctx.stream` inside `execute()` becomes a **Server-Sent Event** the buyer sees live. No setup needed: call the helper and the SDK sends the event.

### The `stream` helpers

| You call | SSE event sent | Use it for |
| :--- | :--- | :--- |
| `stream.progress(percent, message=None)` | `task.progress` | Progress bar + status text (0–100) |
| `stream.step(label)` | `task.progress` (0%) | "Now doing X" labels |
| `stream.delta(text, delta_type="text")` | `task.delta` | Live LLM tokens. `delta_type` = `"text"` (default) or `"json_patch"` |
| `stream.write(text)` / `stream.chunk(text)` | `task.delta` | Aliases for `delta` |
| `stream.activity(type, data=None)` | `task.activity` | Tool calls, searches, DB queries |
| `stream.emit(name, data)` | `<name>` (your own) | Any custom event |
| `stream.is_closed()` / `stream.isClosed()` | — | `True` if the client disconnected |

```python
async def execute(ctx):
    stream = ctx.stream
    stream.step("Searching the web")
    stream.activity("web_search", {"query": ctx.input.query})       # task.activity

    stream.progress(40, "Reading 5 sources")                        # task.progress

    async for token in generate(ctx.input.query):
        if stream.is_closed():
            break                                                   # buyer left, stop work
        stream.delta(token)                                         # task.delta

    stream.emit("source_found", {"url": "https://example.com"})     # custom event
    return {"output": {"done": True}}                               # task.completed
```

### Streaming from AI frameworks (one line)

The adapters read the framework's stream and call `stream.delta` / `stream.activity` for you:

```python
from catelog import (
    pipe_openai_stream,
    pipe_openai_responses_stream,
    pipe_langgraph_stream,
    pipe_claude_agent_stream,
    pipe_async_iterable_stream,
)

return await pipe_openai_stream(await client.chat.completions.create(model=..., messages=..., stream=True), ctx.stream)
return await pipe_openai_responses_stream(await client.responses.create(model=..., input=...), ctx.stream)
return await pipe_langgraph_stream(graph, {"messages": [ctx.input.topic]}, ctx.stream, signal=ctx.signal, usage=ctx.usage)
return await pipe_claude_agent_stream(query(prompt=..., options=...), ctx.stream, signal=ctx.signal)
return await pipe_async_iterable_stream(my_async_generator(), ctx.stream)
```

---

## 6. Execution modes

| `mode` | Behaviour |
| :--- | :--- |
| `"sync"` (default) | Result streams back on the same connection (SSE or JSON). |
| `"async"` | `POST /execute` returns `202` + `poll_url`; buyer polls `GET /tasks/:id`. For jobs that take minutes. |
| `"conversational"` | `ctx.need_input(...)` pauses the task and asks the buyer a question (human-in-the-loop). |

```python
# Conversational: ask a question, then continue when the buyer answers
async def sql_execute(ctx):
    table = ctx.input.get("table")
    if not table:
        return ctx.need_input(
            prompt="Which table?",
            schema={
                "type": "object",
                "properties": {"table": {"type": "string", "enum": ["orders", "users"]}},
                "required": ["table"],
            },
        )
    ctx.stream.progress(50, f"Querying {table}")
    ctx.session.set("last_table", table)
    return {"output": {"table": table}}

agent = create_agent(
    max_timeout_minute=5,
    name="SQL Assistant",
    mode="conversational",
    execute=sql_execute,
)
```

---

## 7. The `execute(ctx)` context

| Field | What it is |
| :--- | :--- |
| `ctx.input` | Validated input (Pydantic model instance or `AttrDict` supporting `ctx.input.field` and `ctx.input["field"]`) |
| `ctx.stream` | Streaming helpers (section 5) |
| `ctx.signal` | `AbortSignal`: check `ctx.signal.aborted`, `await ctx.signal.wait()`, or `ctx.signal.add_event_listener("abort", fn)` |
| `ctx.log` | `ctx.log.info/warn/error/debug(message, data=None)` |
| `ctx.metric` | `ctx.metric.count/gauge/timing(name, value)` → sent in telemetry |
| `ctx.usage` | `ctx.usage.record(model=..., provider=..., tokens=...)` reports an LLM call to telemetry |
| `ctx.run_id`, `ctx.metadata`, `ctx.deadline_ms`, `ctx.resume_token` | Run info from the marketplace (camelCase `runId`, `deadlineMs`, `resumeToken` also work) |
| `ctx.need_input(prompt=..., schema=...)` | Pause for buyer input (conversational mode; alias `ctx.needInput`) |
| `ctx.session` | `get/set/get_all` state that persists across turns |

---

## 8. Tracing and telemetry usage using catelog sdk

The marketplace needs to see **which model your agent used and how many tokens it spent**. Cost is calculated by the marketplace from tokens, so you never report prices unless the provider itself returned a real cost.

### A. OpenAI SDK (chat completions & Responses API)

```python
from openai import AsyncOpenAI
from catelog import create_agent, pipe_openai_stream

client = AsyncOpenAI()

async def execute(ctx):
    completion = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": ctx.input.prompt}],
        stream=True,
        stream_options={"include_usage": True},  # REQUIRED when streaming
    )
    return await pipe_openai_stream(completion, ctx.stream)
```

### B. LangGraph / LangChain

```python
from catelog import create_agent, pipe_langgraph_stream, create_langchain_usage_handler

async def execute(ctx):
    return await pipe_langgraph_stream(
        compiled_graph,
        {"messages": [{"role": "user", "content": ctx.input.prompt}]},
        ctx.stream,
        signal=ctx.signal,
        usage=ctx.usage,  # captures model + tokens of EVERY LLM call inside the graph
    )
```

Or pass `create_langchain_usage_handler(ctx.usage)` directly in `config={"callbacks": [create_langchain_usage_handler(ctx.usage)]}`.

### C. Anything else (one line)

```python
# Anthropic SDK, Groq, Ollama, Mistral, Gemini, etc.
msg = await anthropic_client.messages.create(model="claude-sonnet-5-5", max_tokens=1024, messages=messages)
ctx.usage.record(
    model=msg.model,
    provider="anthropic",
    tokens={
        "prompt": msg.usage.input_tokens,
        "completion": msg.usage.output_tokens,
        "cached": getattr(msg.usage, "cache_read_input_tokens", None),
    },
)
```

### D. OpenTelemetry

```python
from opentelemetry.sdk.trace import TracerProvider
from catelog import catelog_span_processor

provider = TracerProvider()
provider.add_span_processor(catelog_span_processor)
```

---

## 9. Production options

### Keep async jobs across restarts

```python
from catelog import create_agent, RedisJobStore, SqliteJobStore

agent = create_agent(
    max_timeout_minute=5,
    name="Deep Researcher",
    mode="async",
    job_store=SqliteJobStore(path="/data/jobs.db"),  # built-in sqlite3, zero extra dependencies!
    # job_store=RedisJobStore(redis_client),         # sync or async redis-py client
    execute=execute,
)
```

### Limits (all optional, off by default)

```python
agent = create_agent(
    max_timeout_minute=5,
    name="My Agent",
    limits={
        "max_concurrent": 10,                        # over the cap → 429 SERVER_BUSY
        "max_body_bytes": 1_000_000,                 # bigger bodies → 413 PAYLOAD_TOO_LARGE
        "rate_limit": {"max": 60, "window_ms": 60_000},  # per client IP → 429 RATE_LIMITED (+ Retry-After)
        "trust_proxy": True,                         # read X-Forwarded-For
    },
    execute=execute,
)
```

### Graceful shutdown

`agent.listen()` handles `SIGTERM` / `SIGINT`: it stops accepting new runs (`503 SHUTTING_DOWN`), lets in-flight tasks finish, then exits.

```python
agent.listen(port=3000, shutdown_timeout_ms=25_000)
```

