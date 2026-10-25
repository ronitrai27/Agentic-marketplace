# AI Patent & Prior-Art Research Agent

Give it a draft — a new product architecture, an algorithm description, or a technical paper draft — and it tells you how patentable it actually is. The agent parses your draft into claims, hunts through **existing patent filings and research papers**, charts each claim against the closest references, and hands you a **Patent Novelty Scorecard** with claim-level overlap breakdowns — work that normally takes a patent search firm weeks.

Built with **TypeScript + LlamaIndex.TS** (a four-step agent workflow), **Fastify** on the backend, a **React + Vite** frontend, and **PostgreSQL (with pgvector)** in Docker for checkpoints and embeddings. Patent data comes from the **Google Patents Public Dataset (BigQuery)** and the **USPTO Open Data Portal**; non-patent literature comes from **arXiv**; supplemental web context runs on **TinyFish** (`search` + `fetch_content` over MCP).

> ⚠️ **This is a research aid, not legal advice.** A novelty scorecard from this agent does not replace a registered patent attorney or a formal freedom-to-operate (FTO) opinion. See [Legal disclaimer](#legal-disclaimer).

> 📐 **Building this?** The full production spec — exact BigQuery SQL, USPTO ODP auth, scoring algorithm, Postgres schema, API contract, cost guardrails, and a phased build plan — lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md). Every feature, expanded with behavior, edge cases, and UI details, lives in [`FEATURES.md`](./FEATURES.md). The complete PostgreSQL schema is in [`DATABASE.md`](./DATABASE.md), the full tech stack (packages, env, alternatives rejected) is in [`STACK.md`](./STACK.md).

## What problem it solves

When a startup or company prepares to patent a new algorithm, feature, or system design, someone has to search through **thousands of existing patent PDFs and research papers** to verify novelty and spot overlaps. Manual prior-art search takes weeks and still misses references. This agent compresses that loop to minutes:

- **Ingests** your architecture doc / technical paper draft.
- **Cross-references** hundreds of existing patent filings and research papers (full-text claims, not just titles/abstracts).
- **Identifies overlap percentages** per claim and highlights the specific claims, paragraphs, and figures that might violate or overlap existing patents.
- **Scores** overall patentability risk and points at the closest single reference.

## The experience: an analyst firm that works beside you, not a form

The UI is the differentiator. Instead of *upload → spinner → PDF*, you get a live working session with **"Ari, your patent research analyst"** and their visible team of specialist sub-agents:

- **A real intake interview** — Ari asks the questions a patent analyst asks (closest existing thing? public demo dates? hardware or software-only?) instead of a static form.
- **A visible desk** — split-screen: Ari narrates on the left while the right pane shows candidates flipping in and the claim chart filling cell-by-cell, live.
- **The Team Rail — agents talking to agents, in the open** — Scout (retrieval), Clerk (de-dup), Cartographer (claim charting), and Examiner (verdict) send each other structured messages you can *read* as they work — every message backed by a real pipeline event, every quoted match one tap from the evidence.
- **Mission-Control view** — a full-screen live orchestration graph: agent nodes pulse as they work, light travels the edges when messages pass, click any agent to inspect its raw inputs/outputs.
- **A claim workshop** — test "what if I add this limitation?" mid-run; only the affected chart cells re-check (~15 s), so you *design around* prior art inside the product, not after reading a report.
- **Evidence one click away** — every colored cell or rail quote opens the reference's actual text with the matching passage highlighted.
- **The verdict is a walkthrough** — Ari explains the scorecard like a person on a call, then stays available for grounded follow-up questions over your analysis.

Design language: **Blackglass Workbench** — dark-first, hairline depth, glass overlays, mono for all legal text, spring motion, office color-coding (US 🟦 WO 🟪 EP 🟩 arXiv 🟧).

Full spec: [`UIUX.md`](./UIUX.md).

## How it works

Four stages run in order, each one a step in a LlamaIndex.TS `Workflow`. The result is checkpointed to Postgres after every stage, so the UI shows live progress and a late failure still keeps what was already learned.

| # | Stage | Agent | Job |
|---|-------|-------|-----|
| 1 | `ingesting` | **Draft Interpreter** | Parses the draft (PDF / MD / DOCX / LaTeX), splits it into independent and dependent claims plus key components, and extracts the technical approach in the agent's own words |
| 2 | `retrieving` | **Prior-Art Scout** | Hybrid search — CPC/IPC classification + keyword + embedding similarity — across Google Patents (BigQuery), USPTO ODP, and arXiv; de-duplicates and ranks a candidate shortlist |
| 3 | `cross-referencing` | **Claim Chart Analyst** | For each top reference: maps every claim element to the exact passages (and figures, where textually described) that disclose it — the machine version of a lawyer's claim chart |
| 4 | `scoring` | **Novelty Examiner** | Builds the Novelty Scorecard: anticipation risk (§102) vs. obviousness risk (§103), per-claim overlap %, red-flag claims, closest reference, and rewrite suggestions — every claim tied to a source |

### How overlap is computed

Patent novelty is decided **per claim element**, not per document. A reference doesn't have to look "similar" to hurt — it has to disclose each element of at least one claim. The agent mirrors real patentability analysis:

1. **Element splitting** — the Draft Interpreter decomposes each claim into its elements (structural components, steps, and the limitations that tie them together).
2. **Element matching** — the Claim Chart Analyst checks each element against a reference's full text and marks it *disclosed* / *partially disclosed* / *not disclosed*, with the matching passage quoted.
3. **Overlap score** — `overlap = Σ(element weights) matched / Σ(element weights) total`, with independent claims weighted higher than dependent claims.
4. **Anticipation vs. obviousness** — if **one** reference discloses every element of a claim, that's flagged as an **anticipation risk (§102)** — the most serious finding. If no single reference does but a **combination** of two or three does, it's flagged as an **obviousness risk (§103)**, with the suggested combination named.
5. **Classification recall** — candidates are also drawn by CPC/IPC class, because keyword search alone routinely misses prior art that uses different terminology for the same idea.

## Output: Patent Novelty Scorecard

```jsonc
{
  "id": "an_9f3c…",
  "status": "complete",
  "stage": "scored",
  "novelty_score": 62,                 // 0–100, higher = more novel
  "verdict": "partial-overlap",
  "closest_reference": {
    "publication_number": "US11234567B2",
    "title": "Distributed inference scheduling for edge devices",
    "source": "google_patents_bigquery",
    "url": "https://patents.google.com/patent/US11234567B2",
    "anticipates": "claim 1 (partial — element 3 disclosed)"
  },
  "claims": [
    {
      "id": "claim 1",
      "type": "independent",
      "overlap_pct": 71,
      "risk": "obviousness",
      "elements": [
        { "text": "a scheduler assigning model shards to edge nodes",
          "match": "partial", "reference": "US11234567B2 ¶0031",
          "quote": "…task shards are assigned to nodes based on available memory…" },
        { "text": "a fallback path via the cloud gateway",
          "match": "not_found" }
      ]
    }
  ],
  "top_references": [
    { "publication_number": "US11234567B2", "matched_elements": "8/11", "office": "US", "year": 2022 },
    { "publication_number": "WO2021/123456", "matched_elements": "6/11", "office": "WO", "year": 2021 },
    { "id": "arXiv:2301.04567",            "matched_elements": "4/11", "kind": "NPL",  "year": 2023 }
  ],
  "red_flags": [
    "Claim 1 is one element away from being fully anticipated by US11234567B2.",
    "Claims 3–5 differ only by parameter ranges already taught by WO2021/123456."
  ],
  "rewrite_suggestions": [
    "Claim 1: add the cloud-gateway fallback limitation to restore distance from the closest reference."
  ],
  "sources": [ /* every finding above links to a publication URL or arXiv id */ ]
}
```

The UI renders the scorecard with a per-claim overlap bar chart, the element-by-element chart for any claim, and clickable citations for every match.

## Architecture

```
web/                        # Frontend: React 19 + Vite + TS (submit draft, workbench, scorecard)
  src/
    components/             # AriChat, Desk, TeamRail, MissionControl, EvidenceInspector…
    hooks/                  # useSSE (EventSource + rehydrate), useAnalysisStore
    pages/                  # Intake / Workbench / Verdict (react-router)
    styles/tokens.css       # Blackglass design tokens
src/
  workflow/
    index.ts                # LlamaIndex.TS Workflow wiring (4 steps, sequential)
    ingestStep.ts           # Draft Interpreter
    retrieveStep.ts         # Prior-Art Scout
    chartStep.ts            # Claim Chart Analyst
    scoreStep.ts            # Novelty Examiner
  connectors/
    googlePatents.ts        # BigQuery: patents-public-data (bibliographic + US full text + claims)
    usptoOdp.ts             # USPTO Open Data Portal API (claims, brief summary, detail description)
    arxiv.ts                # arXiv Atom API (non-patent literature)
    tinyfish.ts             # TinyFish MCP client (search + fetch_content) for supplemental context
  parse/
    documents.ts            # PDF / MD / DOCX / LaTeX → structured draft (claims + components)
  store/
    db.ts                   # Postgres access (analyses, references, claim_matches) + pgvector
  api/
    server.ts               # Fastify routes + serves web/dist (production UI)
db/001_init.sql             # schema (auto-run by Docker)
docker-compose.yml          # PostgreSQL 16 + pgvector
```

## Data sources (and their caveats)

| Source | Access | Use in the agent | Watch out for |
|--------|--------|------------------|---------------|
| **Google Patents** | Web UI only | Citation links in the scorecard | ⚠️ **No official public API** (as of Oct 2026). Patent pages expose `schema.org` metadata, but scraping it is fragile and against the site's terms — the agent does **not** scrape it |
| **Google Patents Public Data (BigQuery)** | Free dataset, GCP billing account required | Worldwide bibliographic data + **US full text incl. claims** — the primary retrieval source | Queries scan enormous tables; always pin with `publication_number IN (…)` or date/CPC filters, or costs spike. Set a BigQuery budget alert |
| **USPTO Open Data Portal (ODP)** | Free, API key required | US granted + pre-grant claims, brief summaries, detail descriptions (`g_claims_*`, `pg_claims_*`, `*_detail_desc_text_*`) | ⚠️ PatentsView migrated to ODP on **March 20, 2026** — legacy `search.patentsview.org` API keys are **no longer compatible**; get an ODP key from the ODP "Getting Started" page |
| **EPO Open Patent Services (OPS)** | Free, registered key | Global coverage (EP, WO, JP, …) beyond US filings | Rate/volume quotas (~4 GB/day); XML responses |
| **arXiv API** | Free, no key | Non-patent literature (NPL): papers that may qualify as prior art | ~3 s between requests; respect the rate limit |
| **Semantic Scholar / Crossref** | Free, no key (basic) | Academic citation chasing around arXiv hits | Abstracts only in some cases; full text varies |
| **CPC / IPC classifications** | Free via USPTO/EPO | Recall booster — finds prior art with different vocabulary | Needs normalization to the modern CPC scheme |
| **TinyFish MCP** | `TINYFISH_API_KEY` or CLI config | Supplemental web context (company tech blogs, standards docs) | Without a key the run still works; the UI shows a warning banner |

## Setup

### 1. Install dependencies

```bash
cd Agents/AiPatentAgent
npm install          # Node 20+ — npm workspaces install API + web/ (React) together
```

### 2. Configure environment

```bash
copy .env.example .env        # macOS/Linux: cp .env.example .env
```

```
OPENAI_API_KEY=sk-...
MODEL=openai/gpt-4.1-mini        # any LlamaIndex.TS-compatible model
EMBED_MODEL=text-embedding-3-small

# Patent data
BIGQUERY_PROJECT_ID=my-gcp-project
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json   # BigQuery read-only service account
USPTO_ODP_API_KEY=...

# Optional
TINYFISH_API_KEY=sk-tinyfish-...   # supplemental web search; resolved like CompetitorAgent (env → ~/.tinyfish/config.json)
PORT=3008
DATABASE_URL=postgresql://patent:patent_local_password@localhost:5437/patent_agent
```

> **No BigQuery / ODP key?** The agent degrades gracefully: it still runs on arXiv + Semantic Scholar (NPL only) and says clearly in the scorecard that patent coverage was partial.

> 💸 **Budget mode — build and launch for $0/month:** free `LLM_CHAIN=groq,gemini,ollama` (no credit cards), **local embeddings** (transformers.js, drafts never leave your machine), free patent sources only (**USPTO ODP + EPO OPS + arXiv — no BigQuery**), Trigger.dev free + Neon/Supabase free + Render/HF Spaces free. Full free-tier table with verified limits and upgrade triggers: [`STACK.md` §15](./STACK.md).

### 3. Start PostgreSQL (Docker)

```bash
docker compose up -d
```

`db/001_init.sql` (with the `pgvector` extension) is applied automatically on first boot.

> If Postgres is down, analyses still run and stay in memory until restart — they just aren't persisted or embedded.

### 4. Run the app

```bash
npm run dev          # dev: API (tsx watch) on :3008 + Vite dev server on :5173 (proxies /api → :3008)
```

Open **http://localhost:5173**.

The durable task runner runs **inline** by default (`RUNNER=inline`) — the Postgres queue is the source of truth, so a run survives a browser disconnect or server restart. To decouple the API from execution (e.g. deploy the API as a serverless/ephemeral process), run the worker separately:

```bash
# terminal 1 — API only (no inline runner)
RUNNER=external npm run dev:api
# terminal 2 — the queue consumer
npm run worker
```

Runs stuck for >15 min (crash/restart) are automatically re-queued on boot (`reconcileStuck`); stage checkpoints are idempotent.

```bash
npm run build        # production: typecheck + vite build → web/dist, served by Fastify
npm start            # single server, UI + API on http://localhost:3008
npm test             # offline test suite (overlap math, parsing, LLM JSON recovery) — no network needed
```

## API

| Method | Endpoint | Body / query | Purpose |
| ------ | -------- | ------------ | ------- |
| `POST` | `/api/analyses` | multipart draft file, or `{ text, jurisdiction?, max_references? }` | Queue an analysis → `202 { id, status, stage }` |
| `GET`  | `/api/analyses/{id}` | — | Poll one analysis (status, stage, partial or final scorecard) |
| `GET`  | `/api/analyses` | `?limit=20` | Recent history |
| `DELETE` | `/api/analyses/{id}` | — | Remove one analysis |
| `GET`  | `/api/health` | — | Model, BigQuery, ODP, arXiv, database health |
| `GET`  | `/docs` | — | OpenAPI playground |

### Example

```bash
curl -X POST http://localhost:3008/api/analyses \
  -H "Content-Type: application/json" \
  -d '{"text":"A scheduler assigns quantized model shards to edge devices, with a cloud-gateway fallback when local memory drops below threshold...","jurisdiction":"US","max_references":10}'

# then poll
curl http://localhost:3008/api/analyses/<id>
```

## Data model

- **analyses** — one row per draft: status, current stage, model, novelty score, full `result` JSONB, timestamps
- **references** — the prior-art candidates, flattened out of the JSON so they stay queryable (`publication_number`, `office`, `kind`, `cpc`, `matched_elements`)
- **claim_matches** — element-level chart rows (`claim_id`, `element_text`, `match`, `reference_id`, `quote`, `location`)

## Limits & knobs

| Env | Default | Meaning |
| --- | ------- | ------- |
| `MAX_CANDIDATES` | `50` | Candidates pulled in the retrieval stage |
| `MAX_CROSS_REFERENCED` | `10` | References deep-charted in stage 3 (UI offers 5 / 10 / 20) |
| `MAX_CLAIMS` | `20` | Claim cap per draft |
| `MAX_FETCH_CHARS` | `6000` | Text kept per reference for charting |
| `MAX_DRAFT_CHARS` | `20000` | Draft length cap (text mode) |
| `LLM_TEMPERATURE` | `0.1` | Low temperature — charting must be literal, not creative |
| `WORKFLOW_VERBOSE` | `false` | Print LlamaIndex.TS step-by-step logs |

## Tests

```bash
npm test
```

Covers claim-element splitting, overlap math (anticipation vs. obviousness scoring), and the result schemas — no network or API key needed.

## Tech stack

- **Workflow:** LlamaIndex.TS — sequential `Workflow` with typed step handlers, LLM + retriever abstractions
- **Patent data:** Google Patents Public Dataset (BigQuery), USPTO Open Data Portal API, EPO OPS
- **Literature:** arXiv Atom API, Semantic Scholar
- **Web context:** TinyFish — `search` + `fetch_content` over MCP, keyed by `TINYFISH_API_KEY` (or the TinyFish CLI config)
- **Vector index / persistence:** PostgreSQL 16 + pgvector via `pg`
- **Backend:** Fastify + Zod, background worker with stage checkpoints
- **Frontend:** **React 19 + Vite + TypeScript** — components for the workbench (AriChat, Desk, TeamRail, MissionControl, EvidenceInspector), EventSource SSE hook, Motion for springs/flips/snaps, Blackglass CSS tokens

## Marketplace integration: ownership, concurrency & pricing

Everything below is how the agent behaves **once it is rented through the Agentic Marketplace** (see [`Docs/marketplace.md`](../../Docs/marketplace.md)). Three guarantees are non-negotiable.

### 1. The task belongs to the marketplace backend, not the browser session

A run is a **server-side durable job**. The browser is only a *view* onto it — closing the tab, losing Wi-Fi, or shutting the laptop changes nothing.

```
Buyer clicks "Run analysis"
   │
   ▼
Marketplace Gateway ── PayPal AUTHORIZE (locks max budget, e.g. $1.50)
   │
   ▼  POST /execute { run_id, tenant_id, payload, budget }
Agent Server ── registers job in durable engine (Trigger.dev v3 / BullMQ + Redis)
   │              202 → { run_id } immediately (< 300 ms)
   ▼
Durable Runner executes the 4-stage workflow
   ├── stage checkpoints → Postgres after every stage
   ├── browser may disconnect at ANY point — run continues
   └── retry on crash: resumes from last stage checkpoint (no double spend)
   │
   ▼  webhook: POST marketplace /v1/runs/:id/completed
Marketplace ── PayPal CAPTURE exact metered amount (or VOID on failure → buyer pays $0)
   │
   ▼
Buyer re-opens the run from history any time — scorecard is stored, never recomputed
```

Rules that make this true:
- **Run id is owned by the marketplace**, passed into `/execute`; the agent never keys a run to a session, cookie, or socket.
- **SSE (`/stream`) is decoration** — it attaches/detaches freely; truth lives in the `analyses` row.
- **Checkpoints are the recovery mechanism** — a crash at stage 3 of 4 loses at most one stage of work, never the whole run or the spend of stages 1–2.
- **Idempotency** — resubmitting the same `run_id` returns the existing job instead of starting a duplicate (protects the buyer's budget).
- **15-minute task ceiling** per run; anything longer hits the `MAX_RUN_FEE` cap and stops cleanly with partial results (see §3).

### 2. Concurrent rentals — one published agent, N independent buyers

Three buyers can rent the same agent simultaneously and **share nothing**:

| Isolated per tenant | Mechanism |
|---|---|
| Job execution | each run is its own durable job with its own id; the runner executes them as independent tasks (Trigger.dev runs / BullMQ jobs) |
| Budget & payment | PayPal authorization captured per run_id — one buyer's failure never touches another's money |
| Concurrency limits | per-tenant token bucket (default `TENANT_CONCURRENCY=2`); exceeding it **queues**, never rejects and never blocks other tenants |
| Results | every row in `analyses` / `references_` / `claim_matches` carries `tenant_id`; queries are always tenant-scoped; delete cascades within the tenant only |
| Rate limits | per-connector limits are global (provider QPS), but per-tenant limits prevent one tenant from starving others |
| Caches | read caches (publication text, embeddings) are keyed by content — safe to share because they're immutable — but **result caches are tenant-scoped** so two buyers don't see each other's drafts or scorecards |

Walkthrough — the 3-buyer scenario:

1. Dev publishes **one** agent, `pricing = runtime`, `rate = $0.04/min`.
2. Buyers A, B, C each press Run at ~the same time → three PayPal authorizations, three `run_id`s, three durable jobs.
3. A's 1-claim draft finishes in 2 min (capped at floor $0.10); B's standard run takes 5 min ($0.20); C's deep 15-claim run takes 14 min ($0.56, capped at max).
4. All three watch their own SSE streams independently; none can see the other's data; A can re-open next week while B is mid-run.
5. If C's run crashes at stage 3, only C's job retries — A and B are untouched.

### 3. Pricing — solving the "5 leads vs 500 leads" problem

**The problem, stated precisely:** a flat per-run fee (e.g. dev sets $0.20/run) is broken when workload varies 100×. For this agent: a 1-claim draft checked against 5 references costs pennies of LLM time; a 20-claim architecture checked against 50 references costs dollars. Fixed price → either the dev loses money on heavy runs or buyers overpay for light ones.

**The resolution: metered task-hour pricing with hard caps.**

```
price = RUNTIME_RATE × billable_minutes        (floor: MIN_RUN_FEE, cap: MAX_RUN_FEE)
```

- **Billable meter = execution minutes** measured by the durable runner — wall-clock from stage-1 start to scorecard, **excluding queue wait** and retries caused by platform faults.
- **Why minutes (task-hours) is the right meter:** measured cost (LLM tokens during charting + BigQuery bytes) correlates tightly with wall-clock, because charting is 80%+ of both the time and the money. F12 telemetry records both, so the correlation is *provable*, not assumed — and the dev can audit it.
- **PayPal mechanics fit perfectly:** authorize the `MAX_RUN_FEE` up front, capture the exact metered amount on success, void on failure. Buyer pays only for compute that actually ran.

**Pricing configuration the developer publishes with the agent:**

| Knob | Example | Meaning |
|---|---|---|
| `PRICING_MODE` | `runtime` \| `tier` | metered task-hours, or fixed tiers |
| `RUNTIME_RATE` | `0.04` | $ per billable minute |
| `MIN_RUN_FEE` | `0.10` | floor for tiny runs |
| `MAX_RUN_FEE` | `1.50` | cap; also the PayPal authorization amount |
| `TENANT_CONCURRENCY` | `2` | parallel runs per buyer |

**Worked examples** (rate $0.04/min, floor $0.10, cap $1.50):

| Scenario | Workload | Duration | Buyer pays | Dev's LLM+data cost | Dev margin |
|---|---|---|---|---|---|
| Quick check | 1 claim, 5 refs | 1.5 min | **$0.10** (floor) | ~$0.03 | ~$0.07 |
| Standard | 5 claims, 10 refs | 5 min | **$0.20** | ~$0.09 | ~$0.11 |
| Deep due-diligence | 20 claims, 20 refs | 14 min | **$0.56** | ~$0.42 | ~$0.14 |
| Runaway guard | anything | hits cap | **$1.50** + stops with partial results | capped | capped |

**Cap & stop rule (protects both sides):** when the meter approaches `MAX_RUN_FEE`, the run finishes the current stage, checkpoints, and stops with a **partial scorecard** + "Top up $X to continue to full analysis" — never an unbounded bill for the buyer, never an unbounded loss for the dev.

**Why not outcome-based pricing ("$ per verified lead" style)?** For this agent the output *size* is not the value driver — the *evidence* is. Charging per overlap found would pay the most for the runs that tell the buyer their idea is NOT novel (bad incentive), and per-lead metrics don't map to patent work at all. **Effort-metered (task-hours) is honest:** the buyer pays for compute, and the scorecard's value is identical whether it finds 0 or 40 overlaps.

**Simple-buyer alternative (`PRICING_MODE=tier`):** buyers who hate meters pick a preset:

| Tier | Price | Caps (server-enforced via env) |
|---|---|---|
| Lite | $0.10 | ≤ 4 claims, 5 references charted |
| Standard | $0.25 | ≤ 10 claims, 10 references |
| Deep | $0.60 | ≤ 20 claims, 20 references |

Oversized drafts hitting a tier cap are rejected at submit time with an upsell to the next tier — never a surprise bill.

**Marketplace economics:** with the example numbers a typical run earns the dev ~$0.11–$0.14 net of model/data cost before the marketplace cut — and every cent is backed by the per-run `cost` telemetry (F12), which the marketplace uses to display real profit-per-run to the developer and to validate the price at listing time (the ping-test dry run also exercises the meter for free).

### 4. PayPal billing — how the task-hour meter becomes money

PayPal is the money layer for the entire lifecycle: **escrow** (Authorize & Capture), **wallet** (Checkout + Vault), and **payouts** to the developer. The metered model maps onto PayPal cleanly because **PayPal allows capturing less than the authorized amount** — authorize the worst case, capture the measured case, and the unused remainder auto-releases.

**Run lifecycle (runtime mode):**

| Step | PayPal API call | Amount | When |
|---|---|---|---|
| 1. **Authorize (escrow)** | `POST /v2/checkout/orders` with `intent: AUTHORIZE` → buyer approves (or Vault agreement covers it) | `MAX_RUN_FEE` (e.g. $1.50) | before the durable job is accepted — no auth, no run |
| 2. **Hold** | — | funds *authorized*, buyer not yet charged | during the 4–6 min execution |
| 3a. **Capture exact** | `POST /v2/payments/authorizations/{id}/capture` | metered price (e.g. $0.20) | scorecard complete; webhook `PAYMENT.CAPTURE.COMPLETED` settles the billing row |
| 3b. **Partial capture (cap hit)** | capture ≤ authorized amount | up to `MAX_RUN_FEE`; remainder auto-released | cap & stop rule fired — partial scorecard delivered |
| 3c. **Void (failure)** | `POST /v2/payments/authorizations/{id}/void` | **$0 — buyer pays nothing** | run failed before producing results |
| 4. **Payout to dev** | `POST /v1/payments/payouts` | price − marketplace cut | earnings withdraw ("Withdraw to PayPal") or auto-batch daily |

**Rules & edge cases:**
- **Idempotency everywhere:** PayPal `PayPal-Request-Id` = `{run_id}` (+ step suffix) — a retried capture or replayed webhook can never double-charge. The billing row is the local source of truth; PayPal is reconciled against it.
- **Billing state machine:** `pending → authorized → captured | partial_captured | voided | expired` — stored in `analyses.billing`, advanced only by verified webhooks. A nightly reconciler voids orphaned authorizations (PayPal auths expire in ~29 days) for crashed/abandoned runs.
- **Cap-hit continuation:** a capped run captures its amount; "Top up to continue" starts a **new** authorize→capture pair for the remainder — two clean line items, each idempotent, never one unbounded charge.
- **Autonomous agent buyers** (Claude / Cursor / cron agents — no human to click 2FA per run): **PayPal Vault / pre-approved billing agreements** authorize the agent to draw per-run, bounded by the agreement scope **and** `MAX_RUN_FEE` **and** a per-tenant daily cap (`TENANT_DAILY_CAP`, default $20).
- **Wallet mode (optional):** buyers pre-fund a balance via Standard Checkout Smart Buttons; runs charge the balance at capture time instead of holding an authorization — same meter, fewer approval clicks.
- **Webhooks consumed** (all signature-verified, idempotent by event id): `PAYMENT.CAPTURE.COMPLETED` (settle billing row) · `PAYMENT.AUTHORIZATION.VOIDED` (release) · `CHECKOUT.ORDER.APPROVED` (wallet top-up credit) · `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` (dev payout confirmation).
- **Tier mode** (`PRICING_MODE=tier`): authorize optional; single **capture of the fixed tier price on success only** — keeping the same "failure = $0" guarantee.
- **Sandbox-first:** every flow is reproducible with fake buyers in the PayPal sandbox; the listing ping-test `dryRun` exercises the meter without touching PayPal at all.

**PayPal environment:**

```
PAYPAL_MODE=sandbox            # switch to live before marketplace listing
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
PRICING_MODE=runtime
RUNTIME_RATE=0.04
MIN_RUN_FEE=0.10
MAX_RUN_FEE=1.50
TENANT_DAILY_CAP=20.00
PAYPAL_PAYOUT_EMAIL=dev@example.com   # set once at agent listing
```


## Legal disclaimer

This agent is a **research and triage tool**. Its novelty scores, overlap percentages, and claim charts are algorithmic approximations, not patentability or freedom-to-operate opinions. They do not constitute legal advice, do not create an attorney–client relationship, and may miss relevant prior art. **Always have a registered patent attorney review any invention before filing or before making business decisions based on this output.**
