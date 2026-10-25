# AI Patent & Prior-Art Research Agent — Feature Specification

Detailed, build-ready description of **every feature**: what it does, how it works, what the user sees, and how it fails gracefully.
Companion documents: [`README.md`](./README.md) (overview) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) (system spec).

---

## 0. Feature Map at a Glance

| Tier | # | Feature |
|---|---|---|
| **Core v1** | F1 | Multi-format draft ingestion |
| | F2 | Automatic claim decomposition |
| | F3 | Hybrid prior-art retrieval (4 sources) |
| | F4 | Family de-duplication & candidate ranking |
| | F5 | Claim-chart generation (element × reference) |
| | F6 | Novelty Scorecard (score, verdict, red flags, rewrites) |
| | F7 | Live progress UI (SSE) |
| | F8 | Analysis history & re-open |
| | F9 | Graceful degradation (partial sources) |
| | F10 | Health & marketplace ping-test endpoint |
| **Experience v1** | F22 | Conversational intake interview (Ari persona) |
| | F23 | Live workbench — chat + visible desk with incremental rendering |
| | F24 | Claim workshop — mid-run edits + incremental "what-if" re-checks |
| | F25 | Evidence inspector + grounded follow-up chat |
| | F26 | Team Rail — visible agent-to-agent message stream |
| | F27 | Mission-Control live orchestration graph + replay scrubber |
| **Hardening v1.1** | F11 | Auth & marketplace signature |
| | F12 | Per-run cost telemetry & billing record (metered task-hours) |
| | F13 | Durable execution & retries |
| | F14 | Observability (Langfuse traces) |
| | F15 | Caching layers |
| | F16 | Rate limiting & tenant fairness |
| **Later v2+** | F17 | FTO / infringement mode |
| | F18 | Legal-status & expiry view |
| | F19 | CPC watch monitors |
| | F20 | Attorney-ready exports |
| | F21 | Multi-jurisdiction analysis |

---

# Core Features (v1)

## F1 — Multi-format Draft Ingestion

**What it does:** Accepts the invention draft in whatever form the founder already has it — no re-typing, no template.

**Supported inputs:**

| Format | Parser | Notes |
|---|---|---|
| Plain text | native | pasted into the textarea |
| Markdown | `marked` | headings used to locate "Claims" / "Architecture" sections |
| PDF | `pdf-parse` | text-layer PDFs; scanned PDFs detected via text-density < 50 chars/page → clear error ("image-only PDF, please paste text or attach DOCX") |
| DOCX | `mammoth` | paragraphs + basic structure preserved |
| LaTeX | `gray-matter` + custom splitter | `claims` env/section, `\item` enumerations, IEEEtran-style claim blocks |

**How it works:**
1. File uploaded (`multipart`) or raw text (`JSON`). Hard cap `MAX_DRAFT_CHARS` (default 20 000) → 413 with a clear message if exceeded.
2. Parser normalizes to a single Markdown-ish document with `source_map` (page/line pointers kept so scorecard quotes can point back into the user's own draft).
3. SHA-256 **draft hash** computed → used for result caching (F15) and idempotent re-submits.
4. Language check: non-English drafts → warning banner ("claims extraction works best on English drafts").

**Edge cases handled:** encrypted PDFs → reject with reason; 0-byte files → 400; mixed encoding → UTF-8 forced; huge DOCX (>10 MB) → reject before parse.

**User sees:** upload dropzone or paste box → filename + page/word count + extracted-section preview before the run starts.

---

## F2 — Automatic Claim Decomposition

**What it does:** Turns the draft into the unit of analysis patent lawyers actually use — **claims**, split into **elements** — even if the founder never wrote formal claims.

**How it works (stage ①, Draft Interpreter):**
1. **Claim detection** — if formal claims exist (`What is claimed is:`, numbered items, `\item`), use them verbatim. If not, the agent *drafts provisional claims* from the architecture description (clearly labeled `provisional: true` in output).
2. **Classification** — each claim tagged `independent` or `dependent` (depends on another claim → weights applied in F6).
3. **Element splitting** — each claim decomposed into elements: structural components, method steps, and the limitations connecting them. Example:
   - Claim: *"A scheduler assigning quantized model shards to edge nodes, with a cloud fallback when memory < threshold."*
   - Elements: (a) a scheduler, (b) assigning quantized model shards, (c) to edge nodes, (d) with a cloud fallback, (e) when memory < threshold.
4. **Component & approach extraction** — parallel summary of key components and technical approach, used to generate retrieval queries.
5. **Validation pass** — schema-enforced structured output; if the model returns malformed JSON, one recovery retry, then fail the stage with a readable error (never a silent wrong parse).

**Output:** `{ claims: [{ id, type, provisional, text, elements: [{ text, weight }] }], components[], approach, source_map }` — checkpointed to `analyses.result`.

**User sees:** an editable claim list before retrieval continues — users can delete a junk claim or fix a mis-split element (re-runs from stage ① cheaply since parsing is cached).

---

## F3 — Hybrid Prior-Art Retrieval (4 Sources)

**What it does:** Finds the candidate references the draft must be measured against — patents **and** research papers — using three complementary search strategies so it doesn't miss art that uses different words.

**Strategies (all three run, results merged):**
1. **Classification search (CPC/IPC)** — the Draft Interpreter predicts 1–3 CPC classes (e.g. `G06N 3/08` for neural-net inference). Examiners search by class first; this catches prior art with zero keyword overlap.
2. **Keyword search** — 2 synonym-expanded queries per claim (the Query Formulator generates variants: "edge node" ↔ "terminal device" ↔ "client device").
3. **Embedding search** — claim text embedded (`text-embedding-3-small`) and matched against cached passage embeddings (pgvector) for semantic near-misses.

**Sources fanned out in parallel:**

| Source | Role | Returns |
|---|---|---|
| **Google Patents Public Data (BigQuery)** | primary — worldwide bibliographic + US full text & claims | publication number, title, abstract, claims, CPC, dates |
| **USPTO Open Data Portal** | authoritative US claim text (enrichment by publication number) | official claims, brief summary, detail description |
| **arXiv** | non-patent literature (NPL) | paper id, title, abstract, PDF link |
| **TinyFish MCP** | supplemental web context (tech blogs, standards docs) | pages, labeled `kind: "web"` (weaker art, clearly marked) |

**Cost/safety guards:** every BigQuery query pinned (CPC + date window or exact publication numbers) with `maximum_bytes_billed` = 1 GB; arXiv ≥ 3 s spacing; ODP ≤ 2 concurrent.

**Degradation (see F9):** a missing key disables that source only; the run continues and coverage is flagged.

**User sees:** a source-breakdown chip row — "BigQuery ✓ 312 scanned · ODP ✓ · arXiv ✓ 3 hits · TinyFish — no key".

---

## F4 — Family De-duplication & Candidate Ranking

**What it does:** Prevents the chart stage from wasting budget on the same invention filed five times (US grant + EP + WO + continuation…), and puts the most dangerous references on top.

**How it works:**
1. **Normalize** publication numbers across offices (`US11234567B2` ↔ `US 11,234,567 B2` ↔ Google family id).
2. **Family collapse** — group by patent family; keep the fullest-text representative (prefer granted US with full claims; fall back to WO publication).
3. **Rank blend** (0–1): `0.5·embedding_cosine + 0.2·keyword_hits + 0.15·CPC_match + 0.1·recency + 0.05·citation_count`.
4. Cut to `MAX_CANDIDATES` (50); top `MAX_CROSS_REFERENCED` (10) go to deep charting, the rest are listed as "also relevant" in the scorecard.

**User sees:** ranked candidate table with publication number, office, year, title, rank score — expandable pre-chart.

---

## F5 — Claim-Chart Generation (Element × Reference)

**What it does:** The heart of the product — the machine-built **claim chart** that a patent professional would otherwise take days to assemble.

**How it works (stage ③):**
1. For each (independent-claim element × top reference): one LLM call (temp **0.1**) receives *only* the element text + the reference's claim/description text (≤ 6 000 chars) and returns:
   ```json
   { "match": "disclosed|partial|not_found", "quote": "…exact passage…", "locator": "¶0031 / col 4 ll. 12–20" }
   ```
2. Runs as a **bounded parallel map** (concurrency 5) — 10 references × ~10 elements ≈ 100 small calls, ~60–90 s.
3. **Literal-quoting requirement:** the quote must be a verbatim substring of the provided reference text (checked in code) — hallucinated quotes invalidate that cell and retry once. This is what makes the chart trustworthy.
4. **Refinement rule:** if *every* reference scores < 0.3 against all independent claims → **one** re-retrieval pass with broader CPC + looser synonyms, then proceed regardless (never loops).
5. Persisted to `claim_matches` as the run lands — partial charts are viewable immediately.

**User sees:** per-claim matrix — rows = elements, columns = top references; cells colored 🟥 disclosed / 🟨 partial / ⬜ not found; click a cell → quote + locator + link to the source.

---

## F6 — Novelty Scorecard

**What it does:** Compresses the whole analysis into one decision-grade artifact.

**Contents:**

| Field | Meaning |
|---|---|
| `novelty_score` 0–100 | `100 − 100·max_risk` (see ARCHITECTURE §8); independent claims weighted over dependent |
| `verdict` | `clear` · `obviousness` (§103) · `anticipation` (§102) · `partial-overlap` |
| `closest_reference` | the single most dangerous reference + *which* claim element it hits |
| per-claim `overlap_pct` | from the F5 matrix (`Σ weighted matches / Σ weights`) |
| `red_flags[]` | plain-English danger sentences, e.g. "Claim 1 is one element from full anticipation by US11234567B2" |
| `rewrite_suggestions[]` | concrete limitation to add to each risky claim, referencing the gap the chart found |
| `sources[]` | every citation with URL — patents.google.com / data.uspto.gov / arxiv.org |

**Scoring rules (normative):** §102 = one reference discloses every element of a claim (worst) · §103 = 2–3 references combine to ≥ 0.9 · otherwise clear. Temperature 0.1 → near-deterministic; results cacheable by draft hash.

**User sees:** headline score gauge, verdict badge, closest-reference callout, per-claim overlap bars, red-flag list, rewrite suggestions, and the always-visible legal disclaimer.

---

## F7 — Live Progress UI (SSE)

**What it does:** A 4–6 minute run never feels stuck.

- SSE stream on `/api/analyses/:id/stream` pushes `stage`, `progress`, and `partial_result` events.
- UI shows four stage bars (Ingest → Retrieve → Chart → Score) with live counts: "312 candidates scanned", "charting claim 2/4 × 10 references".
- Scorecard renders **incrementally**: candidate table during retrieval, matrix cells as chart calls return, final score at the end.
- Page refresh safe — SSE reconnects and state rehydrates from the DB row.
- No SSE support → polling fallback every 2 s (same endpoint, `Accept: application/json`).

---

## F8 — Analysis History & Re-open

- `GET /api/analyses?limit=20` → recent runs with score, verdict badge, draft name, timestamps.
- Re-open a finished run instantly (scorecard is stored JSONB — no recompute).
- **Delete** cascades to references + claim_matches.
- Duplicate draft hash → offered "you analyzed this 2 days ago — open it instead?" (saves a full re-run cost).

---

## F9 — Graceful Degradation (Partial Sources)

Every dependency failure is a **partial run, never a crash**:

| Missing / down | Behavior |
|---|---|
| No BigQuery creds | Patent coverage switches to ODP-only (US); banner: "reduced coverage" |
| No ODP key | BigQuery continues; official-claim quotes fall back to BigQuery text (labeled) |
| No arXiv access | NPL section skipped; scorecard notes "papers not searched" |
| No TinyFish key | Web context skipped (matches CompetitorAgent behavior) |
| LLM provider down | Stage retries ×2 with backoff, then `status: failed` with stage + reason; earlier checkpoints kept |
| Postgres down | In-memory fallback (analysis completes, not persisted) — same rule as CompetitorAgent |

The final scorecard always states its **coverage line**: "Searched: US grants (Google), US claims (ODP), arXiv papers. Not searched: EPO/WO (no OPS key)."

---

## F10 — Health & Marketplace Ping-Test Endpoint

`GET /health` → `{ status: "ready", uptime_s, deps: { bigquery, odp, arxiv, postgres, llm } }`, each `ok | degraded | missing_key | down`.
Matches the marketplace ping-test contract (3 s timeout). `POST /execute { dryRun: true }` initializes the runner + validates env **without** spending LLM/BigQuery credits — the third step of the marketplace verification flow.

---

# Experience Features (v1)

## F22 — Conversational Intake Interview (Ari persona)
Instead of a static form, the session opens with **Ari, the analyst persona**, asking 3–5 short questions in chat (what the invention does, software vs. hardware, the closest pre-existing thing, priority-relevant dates). Answers feed the Query Formulator (better synonyms + CPC guesses) and capture priority dates. Dragging a file into the workbench skips the interview. A `UI_MODE=persona|form` toggle gives API/batch buyers the plain form. Narration lines are **pre-authored templates bound to real workflow events** (SSE `ari_line`) — the persona can never claim something the system isn't doing.

## F23 — Live Workbench (split view, incremental rendering)
Left pane: chat with Ari + typing indicator that names the actual act ("reading US11234567B2…", never a bare bouncing dot). Right pane "The Desk": three tabs — **Claims** (editable), **Candidates** (reference cards flip in, office color-coded), **Chart** (matrix cells fill cell-by-cell with a 150 ms color snap + count-up percentages). Driven by SSE `partial_result` JSON patches; page refresh reattaches and rehydrates from the DB row. Mobile: chat full-screen, desk as swipe-up sheet. `prefers-reduced-motion` respected; matrix cells carry screen-reader labels.

## F24 — Claim Workshop (mid-run collaboration)
Claims are a shared workbench, not frozen input: hover any element to ✎ edit / ✂ split / ➕ add a limitation. Edits create a **sub-run** (stage ③ only, top-3 references, ~15 s) stored under the same analysis with a `revision` counter — never a full re-run. Ari proactively offers "what-if" chips when the chart exposes a gap ("Claim 1 overlaps 71% — test adding 'with a cloud-gateway fallback'?"). This turns the report-then-panic cycle into **novelty engineering**: users redesign claims around prior art inside the product. Retention hook: re-checks are inherently repeatable.

## F25 — Evidence Inspector + Grounded Follow-up Chat
Any colored cell / red flag / citation opens a right-side inspector: the reference's real text with the quoted passage highlighted, office metadata (dates, assignee, legal status), a patents.google.com/arXiv deep link, and Ari's one-line commentary. After the run, chat stays available as **grounded Q&A restricted to that analysis's stored passages** (pgvector over the run's own references) — it answers "show the closest arXiv papers / explain like I'm a designer", and **refuses with a link** when the answer isn't in the evidence set. No freewheeling hallucinated patents, ever.

## F26 — Team Rail (visible agent-to-agent communication)
The orchestration team — **Scout** (retrieval), **Clerk** (de-dup/rank), **Cartographer** (charting), **Examiner** (verdict) — sends structured messages to each other, streamed in a collapsible rail as readable professional dialogue ("Cartographer → Scout: element 5 uncovered — requesting one bounded re-scan"). Rules: entries are generated from the same SSE events driving the pipeline (`agent_msg {from,to,template_id,payload}`) so they can never depict something that didn't happen; quoted matches are tappable → Evidence Inspector; clicking a message highlights its counterpart on The Desk; honest friction (retries, throttles, the bounded refinement pass) appears as real messages.

## F27 — Mission-Control View (live DAG + replay)
Full-screen orchestration graph: agent nodes with avatar + status ring (idle/working/speaking/done), message channels as edges with a **light pulse traveling the edge exactly when an `agent_msg` fires**, working nodes showing live counters ("Scout · 312 scanned"), Postgres checkpoints glowing on save. Click any node → drawer with that agent's raw inputs/outputs (byte-level transparency for API buyers). Doubles as the timeline scrubber when re-opening a finished run. Renders purely from `agent_msg` + stage events — zero extra backend work beyond emitting the events the pipeline already has.

---

# Production Hardening (v1.1)

## F11 — Auth & Marketplace Signature
- `Authorization: Bearer <API_KEY>` for direct sellers; per-key hashing in DB.
- `X-Marketplace-Signature`: HMAC-SHA256 of `timestamp + body` with the seller secret; 5-minute timestamp window; constant-time compare → passes the marketplace handshake step.

## F12 — Per-Run Cost Telemetry & Billing Record
Each analysis records `cost: { llm_tokens_in/out, bigquery_bytes, connector_calls, billable_seconds }` **and** `billing: { mode, rate, minutes, price, currency, paypal_auth_id }`. The cost record feeds the marketplace **cost-plus/metered pricing** model and an admin "profit per run" view; the billing record is what the marketplace captures via PayPal (authorize max up front → capture exact metered price on success → void on failure). Billable seconds = execution time from stage-1 start, **excluding queue wait** and platform-fault retries. Byte counts read from BigQuery job stats; tokens from the LLM response usage fields.

## F13 — Durable Execution & Retries
Pipeline runs as a **Trigger.dev v3** task (managed; 15-min ceiling) or **BullMQ + Redis** (self-hosted fallback). Retry policy: ×2 attempts, exponential backoff, idempotent by analysis id (stage checkpoints prevent duplicate spend). A crash at stage 3 resumes from the stage-3 checkpoint — stage 1–2 results are already in Postgres.

**Marketplace ownership guarantee:** once a buyer rents the agent and starts a task, the job belongs to the **marketplace backend**, not the browser session. `/execute` registers it in the durable engine keyed by the marketplace-owned `run_id`; resubmitting the same `run_id` is idempotent (returns the existing job, never a duplicate). The browser can disconnect immediately after the `202` — the run completes server-side, the SSE stream reattaches when the buyer returns, and progress/results are always rehydrated from the DB row. Concurrent rentals of the same published agent execute as fully independent jobs with separate budgets, checkpoints, and tenant-scoped results.

## F14 — Observability (Langfuse)
- Trace per analysis; span per stage and per connector call.
- Dashboards: tokens/run, $/run, stage latency p50/p95, connector error rates.
- Dataset evals: golden set of 10 known-overlapping drafts → regression-test scoring accuracy on model/prompt changes.
- No-op when keys absent (dev stays zero-config).

## F15 — Caching Layers
| Cache | Key | TTL |
|---|---|---|
| Publication lookup | publication number | 30 d (patent text is immutable) |
| Embeddings | content hash | forever |
| Full analysis | draft hash | 30 d (F8 re-open offer) |
| BigQuery job results | normalized SQL hash | 24 h |

## F16 — Rate Limiting & Tenant Fairness
Token buckets per connector (BigQuery 10 queries/min, ODP 2 concurrent + 429 `Retry-After` honoring, arXiv 1 per 3 s, OPS 4 req/s). Global per-tenant concurrency = 2 runs (configurable). 429s surface as "queued behind limit", not errors.

---

# Later (v2+)

## F17 — FTO / Infringement Mode
Direction flipped: input = *your granted patent* + a target product description → chart maps product features onto **your** claims, flags which claims read on the product. Same F5 engine, reversed roles.

## F18 — Legal-Status & Expiry View
Pulls legal events (grant, maintenance-fee lapse, expiry) via ODP/OPS → flags expired closest references as "free to practice" and pending ones as "risk if granted".

## F19 — CPC Watch Monitors
TinyFish Monitor on a chosen CPC class or competitor assignee → weekly digest of new filings in the space. One-click "analyze new filing against my portfolio".

## F20 — Attorney-Ready Exports
- `.docx` claim chart (industry-standard two-column format).
- PDF scorecard with disclaimer footer.
- JSON export for API buyers.

## F21 — Multi-Jurisdiction Analysis
EPO OPS + WIPO PATENTSCOPE as primary for users filing outside the US; verdict phrased in EPO inventive-step terms (Article 56) alongside US §102/§103.

---

## Cross-Cutting Guarantees (apply to every feature)

1. **Every finding is cited** — no unsourced claim ever reaches the scorecard.
2. **Quotes are verbatim** — enforced by substring check against fetched reference text.
3. **Bounded everything** — candidates, references, characters, retries, refinement passes (table in ARCHITECTURE §11).
4. **Degradation over failure** — partial coverage is reported, never hidden.
5. **Reproducible** — temp 0.1 + stored inputs → re-opening a run always shows what was actually found.
6. **Disclaimer always on screen** — research aid, not legal advice.
