# Multi-Service Architecture & Deployment Guide (Temporal + LangGraph)

This project is separated into **3 components** designed to run and scale reliably:

```
┌─────────────────────────────────┐
│     1. Marketplace Agent API    │  <- Catelog MAPS Protocol (Sync/Async /execute, /health, /schema, /tasks/:id)
│       (src/agent-server.ts)     │     • JEV Guardrails evaluated first
│                                 │     • Chit-chat: Groq direct answer in 1-2s (NO background worker)
└──────────────┬──────────────────┘     • Deep Research: Dispatches Temporal Workflow
               │
               ▼ client.workflow.start('deepResearchWorkflow')
┌─────────────────────────────────┐
│     2. Temporal Job Cluster     │  <- Temporal Cloud / Dev Server (research-2-langgraph.odwdl)
│   (research-2-langgraph.odwdl)  │     • Durable execution, event logs, heartbeats & retries
└──────────────┬──────────────────┘
               │
               ▼ Task Queue: deep-research
┌─────────────────────────────────┐
│   3. Temporal Research Worker   │  <- Autonomous 4+ Min LangGraph + Firecrawl Research
│    (src/temporal/worker.ts)     │     • Emits heartbeats & progress events
└─────────────────────────────────┘
```

---

## 1. Backend Marketplace Agent (Microservice)

- **Entrypoint**: `src/agent-server.ts`
- **Script**: `pnpm start:agent`
- **Default Port**: `3005` (configurable via `PORT`)
- **Protocol**: Catelog MAPS 1.0.0 (Mode: `async`)
- **Key Endpoints**:
  - `GET  /health` - Liveness probe & capabilities manifest
  - `GET  /schema` - Input / Output JSON schemas
  - `POST /execute` - Async execution (responds `202 Accepted` with `run_id` + `poll_url`)
  - `GET  /tasks/:run_id` - Polling status (`working` -> `completed` / `failed`)
  - `GET  /api/temporal/events?workflowId=...` - Live emitted events & state

### Deployment to Render / Railway / Fly.io:
1. Build Command: `pnpm install`
2. Start Command: `pnpm start:agent`
3. Environment Variables:
   ```env
   PORT=3005
   CATELOG_SECRET_KEY=cat_sec_live_...
   CATELOG_PUBLIC_KEY=cat_pub_live_...
   TEMPORAL_ADDRESS=research-2-langgraph.odwdl.tmprl.cloud:7233
   TEMPORAL_NAMESPACE=research-2-langgraph.odwdl
   TEMPORAL_API_KEY=eyJhbGci...
   TEMPORAL_TASK_QUEUE=deep-research
   ```

---

## 2. Background Worker (Temporal Worker)

- **Worker Script**: `src/temporal/worker.ts`
- **Workflow**: `src/temporal/workflows.ts`
- **Activities**: `src/temporal/activities.ts`
- **Run Command**: `npm run worker`
- **Description**: Handles long-running (4-10 minute) multi-node LangGraph research workflows with 3 automatic retries and exponential backoff.
- **Environment Variables**:
   ```env
   TEMPORAL_ADDRESS=research-2-langgraph.odwdl.tmprl.cloud:7233
   TEMPORAL_NAMESPACE=research-2-langgraph.odwdl
   TEMPORAL_API_KEY=eyJhbGci...
   TEMPORAL_TASK_QUEUE=deep-research
   OPENAPI_KEY=sk-...
   FIRECRAWL_API_KEY=fc-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   ```

---

## 3. Frontend Web UI (Chat & Telemetry)

- **Entrypoint**: `src/ui-server.ts`
- **Script**: `pnpm start:ui`
- **Default Port**: `3000` (configurable via `PORT` or `UI_PORT`)
- **Static Assets**: `public/index.html`, `public/style.css`, `public/app.js`
- **Endpoints**:
  - `GET  /` - Chat UI
  - `POST /api/chat-sse` - Realtime SSE stream with live JEV guardrail telemetry & Temporal event stream

---

## Local Development (All-In-One)

1. **Start the API Server & UI**:
   ```bash
   npm run dev
   ```
2. **Start the Temporal Research Worker**:
   ```bash
   npm run worker
   ```
3. Test chit-chat (e.g., "hello good morning !!") -> answers immediately via Groq in 1-2s with no worker interaction!
4. Test deep research -> triggers Temporal workflow and streams progress.
