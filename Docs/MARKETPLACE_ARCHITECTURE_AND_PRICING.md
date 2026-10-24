# Marketplace Architecture & Economic Invariants

**Document Version:** `1.1.0`  
**Status:** Canonical Marketplace Architectural Decision Record (ADR)  
**Target:** Catelog Agent Marketplace Gateway, SDKs, and Runtime Infrastructure

---

## 1. Architectural Problem 1: Durable Execution Decoupled from the Browser Session

### The Vulnerability of Ephemeral Client Connections
In traditional SaaS or web apps, long-running agent workflows (crawling 500 pages, auditing user checkout flows, deep research) are frequently initiated via an HTTP request from a buyer's browser. If the task execution is tied to that browser HTTP session or SSE connection:
- A buyer closing their laptop, switching Wi-Fi networks, putting their phone to sleep, or refreshing the tab causes a TCP socket reset (`ECONNRESET` / broken pipe).
- Without durable state separation, the agent process either crashes or is terminated by `AbortSignal`, leaving money locked in escrow, half-completed database records, and angry buyers who paid but received no output.

### The Canonical Marketplace Solution: Asynchronous Durable Orchestration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ BUYER BROWSER (Transient Observer)                                          │
│  - Clicks "Rent & Run"                                                      │
│  - Subscribes to SSE stream: GET /tasks/{run_id}/stream                     │
│  - Disconnects freely at any time; reconnects later to view persisted run   │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ 1. POST /rent-and-run
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ MARKETPLACE GATEWAY & ESCROW AUTHORITY                                       │
│  - Pre-validates buyer arguments against registered `input_schema`          │
│  - Authorizes PayPal / wallet credit hold (Escrow reservation)              │
│  - Generates immutable `run_id` (UUIDv4) and registers durable task         │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ 2. Enqueue Workflow
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ DURABLE EXECUTION ENGINE (Temporal.io / Convex Scheduled Durable Tasks)     │
│  - Workflow owns the task lifecycle (State: PENDING -> RUNNING -> COMPLETED)│
│  - Emits heartbeats every 15s; persists event stream & intermediate deltas  │
│  - Handles automatic activity retries with exponential backoff on network   │
│  - Checkpoints artifacts (screenshots, logs, replays) in durable blob store │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ 3. Authenticated Execution
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ CREATOR AGENT RUNNER / BYOS WORKER                                          │
│  - Receives POST /execute with HMAC-SHA256 signature                        │
│  - Executes decoupled task loop in isolated sandbox                         │
│  - Emits telemetry and terminal event (run.succeeded / run.failed)          │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Core Invariants:
1. **The Task Belongs to the Backend, Never the Client**:
   When a buyer triggers a run, the Marketplace Gateway immediately accepts the job, issues a `202 Accepted` with a durable `run_id`, and passes execution control to a durable orchestrator (Temporal.io or persistent task state machine).
2. **Re-attachable Observers**:
   The buyer's browser can disconnect, crash, or stay offline for days. When the buyer logs back in, they query `GET /tasks/:id` to retrieve the current state, live progress percentage, or the finalized report with downloadable artifacts.
3. **Deterministic Settlement**:
   Escrow capture or refund is decided strictly by the durable orchestrator based on the arrival and schema validation of `run.succeeded` or `run.failed`.

---

## 2. Architectural Problem 2: Concurrent Rentals & Multi-Tenant Isolation

### The Challenge
Suppose a developer publishes a single high-value agent (e.g. `WebsiteUxTester` or `LeadFinder`). At 14:00:00 UTC, three independent buyers (Buyer A, Buyer B, and Buyer C) rent and trigger the agent concurrently.

How does the marketplace prevent race conditions, memory collisions, credential leakage, and noisy-neighbor starvation?

### Multi-Tenant Isolation Guarantees

#### 1. Zero Shared Mutable State (Stateless Execution Contexts)
Every execution request received by the agent is stamped with a unique `X-Marketplace-Run-Id` and `metadata.buyer_id`. Agent code must instantiate an ephemeral execution context:
```python
# Each run receives an isolated context — zero global mutable state
async def execute_task(run_id: str, input_data: dict, metadata: dict):
    context = AgentExecutionContext(
        run_id=run_id,
        buyer_id=metadata.get("buyer_id"),
        isolated_dir=Path(f"/tmp/runs/{run_id}")
    )
    return await runner.run_async(context)
```

#### 2. Ephemeral Cloud Browser Sandboxes (Browserbase Session Partitioning)
For browser-based agents (Playwright / Stagehand / Browserbase):
- Buyer A's run spawns **Browserbase Session A** (`session_01`).
- Buyer B's run spawns **Browserbase Session B** (`session_02`).
- Buyer C's run spawns **Browserbase Session C** (`session_03`).
Each browser session runs in an isolated cloud container with its own fresh incognito cookies, local storage, IP context, and memory heap. Cookies, logins, and test user identities are strictly isolated and destroyed when the session terminates.

#### 3. Concurrency Limits & Fair Queueing at the Gateway
To prevent one buyer from monopolizing a creator's BYOS server or overwhelming cloud browser limits:
- The agent manifest declares `capabilities.max_concurrency` (e.g., `10`).
- The Marketplace Gateway tracks active runs per agent and implements a fair round-robin FIFO queue.
- If Buyer A dispatches 20 batch runs while Buyer B dispatches 1, Buyer B's run is interleaved to guarantee sub-second dispatch latency.

#### 4. Cryptographic Replay Protection per Tenant
Each concurrent request requires an independent nonce and HMAC signature. Replaying Buyer A's signature for Buyer B is cryptographically rejected by the SDK's sliding cache.

---

## 3. Architectural Problem 3: The Pricing Dilemma ("5 Leads vs 500 Leads" / Flat Fee Flaw)

### The Problem
If a developer configures a flat **$0.20 per run**:
- **Case 1: "Find 5 leads"**
  - Consumes: 1 search query + 2 page scrapes + 1,200 LLM tokens = **$0.01 compute cost**.
  - Developer margin: $0.20 - $0.01 = **+$0.19 profit** (95% margin).
- **Case 2: "Find 500 leads"**
  - Consumes: 50 search queries + 500 website scrapes + 15 minutes of cloud browser time + 180,000 LLM tokens = **$2.50 compute cost**.
  - Developer margin: $0.20 - $2.50 = **-$2.30 loss!**
A single large buyer run wipes out the developer's entire profit for the week.

### The Canonical Solution: 3 Modern Pricing Models for Agentic Marketplaces

The Marketplace Protocol Specification (MAPS) supports three pricing models to permanently solve this issue:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ MODEL 1: UNIT-METERED / OVERAGE PRICING (Recommended for Quantitative Tasks)│
│                                                                             │
│   Formula: Total Fee = Base Execution Fee + (Unit Rate × Requested Units)   │
│                                                                             │
│   Example: $0.10 base run fee + $0.005 per verified lead / journey          │
│   - Find 5 leads:   $0.10 + (5 × $0.005)   = $0.125                         │
│   - Find 500 leads: $0.10 + (500 × $0.005) = $2.60                          │
│                                                                             │
│   Escrow Action: Pre-authorizes total formula amount before dispatch.       │
│   If agent only delivers 420 leads, Gateway captures $2.20 and voids $0.40. │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ MODEL 2: TIERED SIZING PACKAGES (Recommended for UX / Website Audits)       │
│                                                                             │
│   Developer defines explicit workload tiers in manifest:                    │
│   - Small  (1 flow, 3 pages, up to 3 mins):    $0.25                        │
│   - Medium (3 flows, 10 pages, up to 8 mins):  $1.50                        │
│   - Large  (All menus, full checkout, 30 mins):$5.00                        │
│                                                                             │
│   Input schema enforces tier enum; Gateway locks exact escrow amount.       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ MODEL 3: TWO-PART TARIFF (Creator Margin + Telemetry-Verified Pass-Through) │
│                                                                             │
│   Formula: Total Fee = Creator Platform Margin + Actual Telemetry Compute   │
│                                                                             │
│   - Creator Margin: Fixed $0.20 per run                                     │
│   - Compute Pass-Through: Billed at cost via `telemetry.cost_usd`           │
│     (tokens + Browserbase session minutes + API calls)                      │
│   - Gateway sets a hard Escrow Ceiling (e.g. Max $3.00), holds $3.20, and   │
│     settles exact telemetry upon `run.succeeded`.                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Marketplace Implementation Decision
1. For **Website UX & Conversion Tester**, we adopt **Tiered Workload Packages (Model 2)** combined with **Unit-Based Journey Overages (Model 1)**:
   - Base Quick Audit (Landing page + Navigation + 1 Form): $0.50
   - Full Conversion Audit (Landing page + Menus + Signup + Checkout flow + Live Replays): $2.50
   - Deep Multi-Journey Stress Test (Up to 10 user paths): $5.00
2. The agent declares its `pricing_model` in its `/schema` manifest so the marketplace frontend renders dynamic pricing calculators for the buyer before they click rent!
