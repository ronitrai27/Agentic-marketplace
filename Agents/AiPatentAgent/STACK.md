# AI Patent & Prior-Art Research Agent — Full Tech Stack

The complete bill of materials: every layer, the exact packages, why they were chosen, and what was rejected.
Companion documents: [`README.md`](./README.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) §5 (summary table) · [`DATABASE.md`](./DATABASE.md) · [`FEATURES.md`](./FEATURES.md) · [`UIUX.md`](./UIUX.md).

**Version policy:** Node **20 LTS+** (`engines: node >= 20`), TypeScript **5.x strict**, all deps pinned via `package-lock.json`; minor/patch updates monthly, majors deliberately. Known-good references from sibling projects: Trigger.dev v4 SDK, Langfuse v3 SDK.

---

## Layer Map

```
┌─ Frontend ──── React 19 + Vite + TypeScript · EventSource SSE · Motion · Blackglass tokens
├─ API ───────── Fastify 5 + Zod + @fastify/swagger  (REST + SSE + OpenAPI)
├─ Durable jobs ─ Trigger.dev v4  (or BullMQ + Redis, self-hosted fallback)
├─ Agent core ── LlamaIndex.TS Workflow + OpenAI-compatible models (structured outputs)
├─ Connectors ── @google-cloud/bigquery · USPTO ODP (fetch) · EPO OPS · arXiv · TinyFish MCP
├─ Parse ─────── pdf-parse · mammoth · gray-matter/custom LaTeX · marked
├─ Data ──────── PostgreSQL 16 + pgvector  (rows · JSONB · vectors — one store)
├─ Payments ──── PayPal (Orders authorize/capture · Vault · Payouts · webhooks)
├─ Observability ─ Langfuse (traces) · pino (logs) · run-cost telemetry table
└─ DevOps ────── Docker Compose · node-pg-migrate · vitest · eslint/prettier · CI
```

---

## 1. Runtime & Language

| Item | Choice | Notes |
|---|---|---|
| Runtime | **Node.js 20 LTS** (22 OK) | native `fetch`, no polyfills; same language as LlamaIndex.TS and the marketplace client |
| Language | **TypeScript 5.x**, `strict: true`, `noUncheckedIndexedAccess` | every stage IO is typed end-to-end (Zod → TS types) |
| Module | **ESM** (`"type": "module"`) | LlamaIndex.TS is ESM-first |
| Dev runner | **tsx** (API) + **Vite** (web) | `npm run dev` runs both via `concurrently` — API watch on :3008, Vite HMR on :5173 |
| Package manager | **npm** (lockfile committed) | zero extra tooling; corepack/pnpm optional |

**Why Node/TS (vs. the repo's Python + CrewAI pattern):** Concept 3 specifies **LlamaIndex.TS** — its Workflow + structured-output ergonomics are the best fit for a deterministic 4-stage pipeline, and the marketplace client is already TS. Cost: this repo's first TS agent (Python ops conventions don't transfer), so the DB/ops docs carry extra detail to compensate.

---

## 2. Agent Core

| Package | Role |
|---|---|
| **`llamaindex`** | `Workflow` (step handlers, typed events), retriever abstractions, schema/structured output |
| **`@llamaindex/openai`** (or provider pkg matching `MODEL`) | model + embedding wrappers; any OpenAI-compatible endpoint via `baseURL` |
| **`zod`** | stage I/O schemas — parse, fail fast, generate TS types (`z.infer`) for one source of truth |

**Model defaults (env-driven — free-first; see §15 Budget Mode):**

| Purpose | Default (free) | Fallback chain |
|---|---|---|
| Chart/verdict/critique (temp 0.1) | **Groq** `gpt-oss-120b` (no card) | Gemini free tier → Ollama local → `gpt-4.1-mini` (paid, at revenue) |
| Claim extraction / query formulation (temp 0.2) | Groq `gpt-oss-20b` / Gemini free Flash | same chain |
| Embeddings | **local `bge-small-en-v1.5` via transformers.js (384-d, $0, offline)** | `text-embedding-3-small` (1536-d) if quality demands |
| Grounded follow-up chat (F25) | same free chain, evidence-restricted prompt | — |

**Provider fallback chain (hard-coded, env-ordered):** `groq → gemini-free → ollama → paid` — a free-tier rate limit (30 req/min on Groq, 5–15 RPM on Gemini) degrades to the next provider mid-run instead of failing, and the chart step's concurrency-5 queue naturally stays inside free RPM limits.

**Design law:** the LLM never composes free narration or rail dialogue mid-run — only pre-authored templates bound to events (UIUX §3.2). Deterministic, cheap, truthful.

---

## 3. API Layer

| Package | Role |
|---|---|
| **`fastify`** 5 | HTTP server (chosen over Express: schema-first, faster, first-class TS) |
| `@fastify/multipart` | draft file uploads (PDF/DOCX) |
| `@fastify/cors`, `@fastify/helmet` | browser + security headers |
| `@fastify/rate-limit` | global request guard (per-tenant limits are custom, F16) |
| `@fastify/swagger` | `/docs` OpenAPI for marketplace API buyers |
| **`zod`** | request/response validation → OpenAPI + TS types |

Routes: `POST /api/analyses` · `GET /api/analyses/:id` · `GET /api/analyses/:id/stream` (SSE) · `GET /api/analyses` · `DELETE /api/analyses/:id` · `GET /health` · `POST /execute` (marketplace BYOS + signature).

---

## 4. Durable Execution

| Choice | When | Notes |
|---|---|---|
| **`@trigger.dev/sdk` v4** | default (managed) | durable 4-stage task, retries + backoff, 15-min ceiling, webhooks on completion → marketplace + PayPal capture. Same generation as sibling `researchAgent` |
| **`bullmq` + `ioredis`** | self-hosted fallback | queue semantics with `run_id` idempotency; Redis is **queue-only**, never a system of record |
| Stage checkpoints | always | every stage commits to Postgres in one transaction → crash resumes from last completed stage |

Both modes emit the identical SSE event set (`stage`, `progress`, `candidate_found`, `cell_decided`, `agent_msg`, `ari_line`, `partial_result`).

---

## 5. Data Connectors

| Package / API | Source | Auth | Quirks handled in code |
|---|---|---|---|
| **`@google-cloud/bigquery`** | Google Patents Public Data (`patents-public-data.patents.publications`) — **OPTIONAL, skipped in `FREE_MODE=true`** (needs a GCP billing account/card; free tier = 1 TB queries/mo once attached) | service account (ADC) | `maximum_bytes_billed = 1 GB` on every query; filters mandatory; `tooLarge` → degrade |
| **`fetch` + Zod** | USPTO Open Data Portal | `X-API-KEY` | ≤2 concurrent, `Retry-After` on 429; legacy PatentsView keys rejected by design |
| **`fast-xml-parser`** | EPO OPS (XML) + arXiv Atom | OPS: OAuth2 client-credentials (token cached); arXiv: none | OPS token bucket (~4 GB/day, 4 req/s); arXiv ≥3 s spacing |
| **`fetch`** | Semantic Scholar Graph API | none (light use) | NPL citation chasing |
| **TinyFish MCP client** | `search` + `fetch_content` | `TINYFISH_API_KEY` → `~/.tinyfish/config.json` fallback | raw MCP JSON-RPC over HTTP (small client in `src/connectors/tinyfish.ts`), no SDK dependency; optional — no key = clean degradation |

All connector responses are **normalized to one `PriorArtCandidate` Zod schema** before entering the workflow — the pipeline never sees provider shapes.

---

## 6. Document Parsing

| Package | Format |
|---|---|
| **`pdf-parse`** | PDF (text layer; text-density check flags scanned PDFs with a human error) |
| **`mammoth`** | DOCX → Markdown-ish structure |
| **`gray-matter`** + custom splitter | LaTeX (`claims` blocks, `\item` enumerations) |
| **`marked`** | Markdown headings → section detection ("Claims", "Architecture") |
| native | pasted text |

Output: normalized document + `source_map` (page/line) + sha256 `draft_hash`. 20 000-char cap enforced pre-parse.

---

## 7. Datastore — PostgreSQL 16 + pgvector

| Item | Choice | Notes |
|---|---|---|
| Engine | **`postgres:16`** via `pgvector/pgvector:pg16` image | Docker Compose port **5437** (avoids 5432 collisions); **$0 locally** |
| Free hosted option | **Neon free (0.5 GB) or Supabase free (500 MB)** — both support pgvector | upgrade only when data outgrows free tier (~early thousands of runs) |
| Driver | **`pg`** (node-postgres) pool, `max 20` | behind pgbouncer in prod (transaction mode) |
| Vectors | **pgvector ≥ 0.7**, `vector(1536)`, ivfflat → HNSW at scale | one store for rows + JSONB + vectors (rejected: separate vector DB) |
| Migrations | **`node-pg-migrate`** | forward-only; `db/001_init.sql` auto-applies on first boot |
| RLS | built-in | `patent_app` role + `SET LOCAL app.tenant_id` (DATABASE §6) |

Full DDL: [`DATABASE.md`](./DATABASE.md).

**Rejected alternatives:** Chroma/Qdrant/Pinecone (ops + consistency cost at this scale), Redis-as-cache for results (tenant-safety complexity), Prisma (RLS + vector + JSONB gymnastics get in the way — raw SQL with Zod parsing is clearer here).

---

## 8. Payments & Marketplace

| Item | Role |
|---|---|
| **`@paypal/paypal-server-sdk`** (or REST v2 via `fetch`) | Orders `intent: AUTHORIZE` → partial capture → void; Vault agreements for agent buyers; Payouts to developers |
| Webhooks | `PAYMENT.CAPTURE.COMPLETED`, `AUTHORIZATION.VOIDED`, `CHECKOUT.ORDER.APPROVED`, `PAYOUTS-ITEM.SUCCEEDED` — signature-verified, idempotent inbox table |
| Idempotency | `PayPal-Request-Id = run_id + step` |
| Marketplace contract | `GET /health` ping shape · `X-Marketplace-Signature` HMAC · `POST /execute` with `dryRun` |

---

## 9. Frontend — React 19 + Vite

| Item | Choice | Notes |
|---|---|---|
| Framework | **React 19** + **TypeScript** | hooks-first; shared types imported from a `shared/` folder (Zod schemas → TS types) so API and UI can't drift |
| Build/dev | **Vite 6** + `@vitejs/plugin-react` | dev server on **:5173** with `/api` proxy → :3008; prod `vite build` → `web/dist`, **served by Fastify** (one origin, no CORS in prod) |
| Routing | **react-router** (v7) | `/` intake · `/analyses/:id` workbench+verdict (URL = shareable session link) |
| Server state | **TanStack Query** | history, scorecard fetch, retry/backoff for polls |
| Client store | **zustand** (tiny) | analysis slice, chart matrix, rail messages, UI flags (rail collapsed, inspector open) |
| Realtime | custom **`useSSE`** hook over native `EventSource` | applies `partial_result` patches to the store; auto-reconnect; on reconnect rehydrates `GET /api/analyses/:id` (truth is the DB row, not the stream) |
| Animation | **`motion/react`** | springs/flips/snaps per UIUX §2.3; `useReducedMotion` toggle for the reduced-motion fallback |
| Styling | **plain CSS + CSS Modules**, tokens in `styles/tokens.css` | Blackglass system (UIUX §2.1) stays a single source of truth; no Tailwind — the design language is custom, utility classes would fight it |
| Components | `AriChat` · `IntakeInterview` · `Desk` (Claims/Candidates/Chart tabs) · `TeamRail` · `MissionControl` · `EvidenceInspector` · `Scorecard` · `CommandPalette` | one component per UIUX §4 screen/region |

**Component data flow:**

```
useSSE(EventSource) ──patch──▶ zustand store ──▶ Desk / TeamRail / MissionControl
GET /api/analyses/:id ───────▶ TanStack Query ──▶ Scorecard (after completion/refresh)
```

**Testing:** `vitest` + `@testing-library/react` — SSE reducer patches, rail template rendering, matrix cell accessibility, scorecard fixture snapshots (offline, no API keys).

---

## 10. Observability

| Item | Role |
|---|---|
| **`langfuse`** (v3 SDK) | traces: analysis → stage → connector/LLM call; token + $ per stage; golden-set evals on scoring regressions |
| **`pino`** (Fastify default logger) | structured logs; `LOG_LEVEL` env |
| `run_costs` table | ground truth for pricing: tokens, BigQuery bytes, connector calls, est cost (F12) |
| `/health` | per-dependency probe: bigquery · odp · arxiv · postgres · llm |

---

## 11. Testing & QA

| Tool | Scope |
|---|---|
| **`vitest`** + `@testing-library/react` + `jsdom` | unit + contract + component tests (ESM-native, one config with TS) |
| Offline suite (no keys) | claim splitter, overlap math (§102/§103), quote-substring checker, JSON recovery, scoring fixtures, SSE-reducer patches, matrix-cell a11y |
| DB contract tests | RLS cross-tenant = 0 rows, status race = false, cascade clears all tables (DATABASE §12) |
| Fixture set | 10 golden drafts with known overlaps → scorecard regression gate |
| `@fastify/inject` | API route tests without binding a port |

---

## 12. DevOps & Environments

| Item | Choice |
|---|---|
| Containers | multi-stage image: `node:20` build (typecheck + `vite build`) → slim runtime serving Fastify + `web/dist` + `docker-compose.yml` (postgres+pgvector, optional redis) |
| CI | lint → typecheck → `npm test` → docker build → deploy staging |
| Environments | `local` (Docker, sandbox PayPal, NPL-only allowed) → `staging` (Trigger.dev dev env, PayPal sandbox) → `live` (PayPal live, marketplace listed) |
| **Free hosting** | API+UI on **Render free / Hugging Face Spaces free / any free 1-GB container**; background runs already live on **Trigger.dev free** (so API sleep never kills a run); **Cloudflare free** DNS+TLS if a domain is added; **GitHub Actions free** (2 000 min/mo) for CI |
| Secrets | `.env` locally; cloud secret manager in prod — **never** committed, never in DB |
| Scheduler | Trigger.dev schedules: retention sweep (nightly), billing reconciler (hourly), watch monitors (v2, cron) |

---

## 13. Full Environment Reference

```env
# ── LLM ─────────────────────────────────────
OPENAI_API_KEY=sk-...
MODEL=openai/gpt-4.1-mini
CHART_MODEL=openai/gpt-4.1-mini            # temp 0.1 stages 3-4
EMBED_MODEL=text-embedding-3-small
LLM_TEMPERATURE=0.1

# ── Patent data ─────────────────────────────
BIGQUERY_PROJECT_ID=my-gcp-project
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
BIGQUERY_MAX_BYTES=1073741824              # 1 GB job cap
USPTO_ODP_API_KEY=...
EPO_OPS_KEY=...                             # optional, global coverage
EPO_OPS_SECRET=...

# ── NPL / web ───────────────────────────────
ARXIV_ENABLED=true
SEMANTIC_SCHOLAR_KEY=                       # optional
TINYFISH_API_KEY=sk-tinyfish-...           # fallback: ~/.tinyfish/config.json

# ── Server / DB ─────────────────────────────
PORT=3008
DATABASE_URL=postgresql://patent:patent_local_password@localhost:5437/patent_agent
APP_ROLE=patent_app
TENANT_DEMO_ID=11111111-1111-1111-1111-111111111111

# ── Execution ───────────────────────────────
RUNNER=trigger                             # trigger | bullmq
TRIGGER_SECRET_KEY=tr_dev_sk_...
REDIS_URL=                                  # only if RUNNER=bullmq

# ── Billing / marketplace ───────────────────
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
PRICING_MODE=runtime
RUNTIME_RATE=0.04
MIN_RUN_FEE=0.10
MAX_RUN_FEE=1.50
TENANT_DAILY_CAP=20.00
MARKETPLACE_SECRET=...                      # X-Marketplace-Signature HMAC key

# ── Limits ──────────────────────────────────
MAX_CANDIDATES=50
MAX_CROSS_REFERENCED=10
MAX_CLAIMS=20
MAX_DRAFT_CHARS=20000
MAX_FETCH_CHARS=6000
TENANT_CONCURRENCY=2

# ── UX / observability ──────────────────────
UI_MODE=persona                             # persona | form
SHOW_TEAM_RAIL=true
LANGFUSE_PUBLIC_KEY=                        # optional
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LOG_LEVEL=info
```

---

## 14. Dependency Shortlist (package.json target)

```jsonc
{
  "dependencies": {
    "llamaindex": "…", "@llamaindex/openai": "…",
    "react": "…", "react-dom": "…", "react-router": "…",
    "@tanstack/react-query": "…", "zustand": "…", "motion": "…",
    "fastify": "…", "@fastify/multipart": "…", "@fastify/cors": "…",
    "@fastify/helmet": "…", "@fastify/rate-limit": "…", "@fastify/swagger": "…",
    "zod": "…", "pg": "…", "node-pg-migrate": "…",
    "@google-cloud/bigquery": "…", "fast-xml-parser": "…",
    "pdf-parse": "…", "mammoth": "…", "gray-matter": "…", "marked": "…",
    "@trigger.dev/sdk": "…", "bullmq": "…", "ioredis": "…",
    "@paypal/paypal-server-sdk": "…",
    "langfuse": "…", "pino": "…"
  },
  "devDependencies": {
    "vite": "…", "@vitejs/plugin-react": "…",
    "typescript": "…", "tsx": "…", "vitest": "…",
    "@testing-library/react": "…", "jsdom": "…",
    "eslint": "…", "prettier": "…", "@types/pg": "…", "@types/node": "…",
    "@types/react": "…", "@types/react-dom": "…"
  },
  "workspaces": ["web"],
  "scripts": {
    "dev": "concurrently \"tsx watch src/api/server.ts\" \"vite --config web/vite.config.ts\"",
    "build": "tsc --noEmit && vite build --config web/vite.config.ts",
    "start": "node dist/server.js",
    "test": "vitest run",
    "worker": "tsx src/jobs/worker.ts"
  },
  "engines": { "node": ">=20" }
}
```

Pin exact versions with `npm install <pkg>@latest` at scaffold time (Phase 0 of ARCHITECTURE §12) — versions intentionally elided here rather than fabricated.

---

## 15. Free-First Build (Budget Mode) — target $0/month

Design constraint: **no budget during development and early launch.** Every layer has a verified free path; paid upgrades are *triggered by measurable thresholds*, not anxiety.

### 15.1 The $0 bill of materials

| Layer | Free-first choice | Real limits (verified Oct 2026) | Upgrade only when… |
|---|---|---|---|
| **LLM (primary)** | **Groq** — `gpt-oss-120b` / `gpt-oss-20b` / Qwen3 | no credit card; ~30 req/min, ~8k tokens/min, ~1 000 req/day per model | you exceed ~30–50 runs/day or need stronger reasoning → switch one env var to paid |
| **LLM (secondary)** | **Google Gemini free tier** (Flash) | roughly 5–15 req/min, ~1 000–1 500 req/day (quotas shifted repeatedly in 2026 — re-check at build time) | same as above |
| **LLM (unlimited)** | **Ollama on the dev machine** (`qwen2.5:7b`, `llama-3.1-8b`, `gpt-oss-20b`) | zero limits, zero data leaves your laptop | quality gaps on legal reasoning |
| **Embeddings** | **transformers.js local** — `bge-small-en-v1.5` (384-d) | free forever, offline, **invention drafts never leave the machine** (privacy feature, not a compromise) | retrieval quality measured insufficient (golden-set eval) |
| **Patent data** | **USPTO ODP** (free MyUSPTO key, no card) + **EPO OPS** (free key) + **arXiv / Semantic Scholar** (keyless) + **TinyFish search** (free) | US + global coverage; ODP has rate limits we already honor | you need BigQuery's speed/coverage → attach GCP card (free tier: 1 TB queries/mo) |
| **Database** | Docker `pgvector` locally; **Neon free / Supabase free** for shared MVP | 0.5 GB hosted | ~10⁵ runs in, out of free storage |
| **Jobs** | **Trigger.dev cloud free** ($5/mo credit, 20 concurrent, no card) — or **self-hosted** (OSS) / **BullMQ + local Redis** | comfortably dozens of runs/day | volume beyond free credits |
| **Observability** | **Langfuse self-host** (OSS, free, unlimited core) or cloud Hobby free (50k obs/mo) + pino logs | plenty at MVP scale | team/eval volume grows |
| **Hosting** | **Render free / Hugging Face Spaces free** (API+UI); runs themselves live on Trigger.dev, so **API sleep never kills a job** | free services spin down when idle — cold start on first page load | paying users justify a paid instance |
| **CI / DNS / TLS** | GitHub Actions (2 000 min/mo), Cloudflare (free DNS + TLS) | ample | — |
| **Payments** | PayPal: **$0 fixed fees** — you pay only a per-transaction % *after* earning | marketplace cut applies anyway | never (revenue-share only) |

**Monthly total for dev + MVP launch: $0.** The only costs that ever appear: optional paid LLM calls (one env switch), optional GCP card for BigQuery, and hosting above free tiers — all *after* the agent earns.

### 15.2 Budget-mode environment

```env
FREE_MODE=true                      # skips BigQuery; primary sources = ODP + OPS + arXiv
LLM_CHAIN=groq,gemini,ollama,paid   # ordered fallback — rate limits degrade, never fail
GROQ_API_KEY=gsk_...                # free, no card
GEMINI_API_KEY=...                  # free tier
OLLAMA_BASE_URL=http://localhost:11434   # unlimited local dev
EMBED_PROVIDER=local                # transformers.js bge-small-en-v1.5 (384-d)
# OPENAI_API_KEY= (only added when you choose to pay)
```

### 15.3 Budget-mode adjustments already reflected in this spec

1. **Embedding dimensions** — free mode uses `vector(384)`; paid mode `vector(1536)`. DATABASE.md notes the column type choice; pick one at first boot and don't migrate mid-corpus (re-embed instead).
2. **BigQuery demoted to optional** — free mode's US claims come from ODP, global from OPS. The scorecard's **coverage line** (FEATURES F9) is mandatory precisely so free-mode partial coverage is always honest.
3. **Chart throughput** — charting fires ~100 small calls; at Groq's ~30 req/min the concurrency-5 queue finishes in ~4 min (inside the design's 4–6 min window). Free rate limits are *compatible* with the architecture, not a compromise.
4. **Rate-limit handling is first-class** — provider fallback chain + token buckets + 429 retries already specified (ARCHITECTURE §11) were designed with free tiers in mind.

### 15.4 What NOT to cheap out on

- **PayPal webhook signature verification & idempotency** — never "simplify" money code.
- **The legal disclaimer** — costs nothing; protects everything.
- **Postgres backups** — a free tier can vanish; nightly `pg_dump` to any object storage is pennies and is in §13 of DATABASE.md.
- **Verbatim-quote validation** — the product's trust rests on it; it's a string check, not a cost.
