# Multi-Service Architecture & Deployment Guide

This project is separated into **3 independent components** designed to be deployed and scaled separately:

```
┌─────────────────────────────────┐
│     1. Marketplace Agent API    │  <- Catelog MAPS Protocol (Sync/Async /execute, /health, /schema, /tasks/:id)
│       (src/agent-server.ts)     │
└──────────────┬──────────────────┘
               │  tasks.trigger(...)
               ▼
┌─────────────────────────────────┐
│   2. Trigger.dev Cloud Worker   │  <- Autonomous 4+ Min LangGraph + Firecrawl Research
│  (src/trigger/deep-research)    │
└──────────────┬──────────────────┘
               │  POST /api/trigger-callback
               ▼
┌─────────────────────────────────┐
│       3. Frontend Web UI        │  <- Real-time ChatGPT-style SSE Chat & JEV Telemetry
│        (src/ui-server.ts)       │
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
  - `POST /api/trigger-callback` - Webhook callback from Trigger.dev

### Deployment to Render / Railway / Fly.io:
1. Build Command: `pnpm install`
2. Start Command: `pnpm start:agent`
3. Environment Variables:
   ```env
   PORT=3005
   CATELOG_SECRET_KEY=cat_sec_live_fe471b4c5047d5b81e369db1f67d78dd8fc6dd1d371634d7a3ad7566041422f0
   CATELOG_PUBLIC_KEY=cat_pub_live_21030fbabcbe3b8a1b8a09dd
   TRIGGER_SECRET_KEY=tr_dev_sk_...
   SERVER_URL=https://your-agent-domain.onrender.com
   ```

---

## 2. Background Worker (Trigger.dev Cloud)

- **Config**: `trigger.config.ts`
- **Task Definition**: `src/trigger/deep-research-task.ts`
- **Local Dev Worker**: `pnpm trigger:dev`
- **Deploy to Cloud**: `pnpm trigger:deploy`
- **Description**: Handles long-running (4-10 minute) multi-node LangGraph research workflows with 3 automatic retries and exponential backoff.
- **Environment Variables** (Set in Trigger.dev Dashboard):
   ```env
   OPENAI_API_KEY=sk-...
   FIRECRAWL_API_KEY=fc-...
   GROQ_API_KEY=gsk-...
   OPENROUTER_JEV=sk-or-v1-...
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
  - `POST /api/chat-sse` - Realtime SSE stream with live JEV guardrail telemetry & LangGraph node events

### Deployment to Vercel / Render:
1. Build Command: `pnpm install`
2. Start Command: `pnpm start:ui`
3. Environment Variables:
   ```env
   PORT=3000
   OPENAI_API_KEY=sk-...
   GROQ_API_KEY=gsk-...
   ```

---

## Local Development (All-In-One)

To run the unified server locally serving both the Marketplace API and the Web UI on a single port:
```bash
pnpm dev
```
To run the Trigger.dev dev worker locally in parallel:
```bash
pnpm trigger:dev
```
