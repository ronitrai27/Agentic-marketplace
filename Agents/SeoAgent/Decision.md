# Architecture & Engineering Decision Record (ADR)

**Project:** Enterprise Technical SEO & GEO Intelligence Platform (`SeoAgent`)  
**Status:** Accepted & Baseline Established  
**Date:** 2026-10-22  
**Scope:** Core Foundation, Orchestration Harness, and Initial Typing Architecture

---

## Executive Summary

To build an enterprise-grade SEO and Generative Engine Optimization (GEO) platform capable of operating autonomously at high scale (thousands of URLs per tenant), the core cannot be treated as a simple hobby script. Every decision is driven by **durability, deterministic state progression, verifiable evidence integrity, and strict type safety**.

This document captures every architectural and tooling decision made for the core foundation.

---

## 1. Package Manager & Dependency Strategy

### Decision
- **Package Manager:** `pnpm` (Workspace-aligned)
- **Dependency Versions:** Installed the absolute latest stable versions of all core packages:
  - `@langchain/langgraph`: `^1.5.2`
  - `@langchain/core`: `^1.2.20`
  - `@temporalio/workflow`, `@temporalio/activity`, `@temporalio/client`, `@temporalio/worker`: `^1.24.0`
  - `zod`: `^4.6.7`
  - `dotenv`: `^18.0.8`
  - `typescript`: `^7.0.2`
  - `@types/node`: `^26.6.5`
  - `tsx`: `^4.23.15`

### Rationale & Trade-offs
- **Latest Upstream Features & Security:** LangGraph and Temporal SDKs receive critical stability fixes and v8 sandbox performance enhancements in their latest revisions. Installing latest ensures we are building on modern APIs rather than deprecated shims.
- **Strict Dependency Isolation:** `pnpm` uses a content-addressable hard-link store with non-flat `node_modules` by default, preventing phantom dependency leaks across workspace packages.

---

## 2. Orchestration Stack: Temporal.io + LangGraph.js

### Decision
- **Temporal.io** as the **Macro-Orchestrator** (Durable Execution & Workflow Engine)
- **LangGraph.js** as the **Micro-Orchestrator** (Cognitive State Graph & Agentic Loops)

### Rationale
- **The Problem with Naked LLM Loops:** Crawling and validating thousands of pages takes hours. Standard async loops fail on container restarts, memory spikes, or transient network timeouts.
- **Why Temporal.io:**
  - Provides event-sourced workflow determinism, automatic activity retry policies with exponential backoff, rate limiting, and heartbeats.
  - Can pause, resume, and checkpoint multi-step crawling workflows over days without losing state.
- **Why LangGraph.js:**
  - Manages cyclical reasoning: Crawl $\rightarrow$ Inspect $\rightarrow$ Hydration Diff $\rightarrow$ Validate $\rightarrow$ Enrich $\rightarrow$ Remediate.
  - Channels state modifications cleanly using reducers and annotations.
- **Separation of Concerns:** Temporal owns *durability and distributed execution*; LangGraph owns *reasoning topologies and state checkpoints*.

---

## 3. TypeScript Configuration: Enterprise Strictness

### Decision
Engineered `tsconfig.json` with strict compilation flags:
- `target: ES2022` & `module: NodeNext` / `moduleResolution: NodeNext`
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `isolatedModules: true`
- `declaration: true` & `declarationMap: true`
- `sourceMap: true`

### Rationale
- **`NodeNext` Module Resolution:** Ensures full ECMAScript Module (ESM) compliance required by modern Node runtimes and LangChain/LangGraph packages.
- **`noUncheckedIndexedAccess`:** In SEO crawling, map lookups for URLs, headers, and DOM selectors frequently yield `undefined`. Forcing indexed access to be typed as `T | undefined` prevents catastrophic runtime `TypeError: Cannot read properties of undefined` in production.
- **Declaration & Source Maps:** Guarantees proper declaration emission for downstream consumption or monorepo integration.

---

## 4. Fail-Fast Environment Validation via Zod

### Decision
Implemented `src/config/env.ts` with strict schema parsing at module load time.

### Rationale
- **Fail-Fast Principle:** An enterprise agent must never initialize and begin a 500-page crawl only to fail 40 minutes later due to a missing API key or an invalid Temporal host.
- **Type-Inferred Config:** Exporting `z.infer<typeof envSchema>` provides guaranteed compile-time autocompletion across the codebase for all configuration keys.

---

## 5. Evidence-Centric Core State Contracts

### Decision
Structured `src/core/types.ts` and `src/core/state.ts` around verifiable `EvidencePackage` objects and LangGraph `Annotation.Root`.

### Rationale
- **No Unsubstantiated Findings:** In traditional SEO tools, LLMs often hallucinate recommendations. The `SeoIssue` contract mandates an immutable `EvidencePackage` containing:
  - Exact URL and ISO timestamp
  - Content SHA hash of the observed payload
  - Raw HTML snippet vs. Rendered DOM snippet
  - Visual bounding box coordinates (selector, x, y, width, height)
  - Cryptographic / HAR network traces
- **Reducer State Channels:** In `SeoAgentStateAnnotation`, array channels (`crawlQueue`, `visitedUrls`, `issues`) use dedicated reducer functions (`[...current, ...update]` / `Set` deduplication) to guarantee deterministic state merging across parallel graph steps.

---

## 6. Directory Structure & Boundary Isolation

```
Agents/SeoAgent/
├── src/
│   ├── config/
│   │   └── env.ts          # Validated, type-safe environment configuration
│   ├── core/
│   │   ├── types.ts        # Foundational contracts (Evidence, Issues, CrawlTarget)
│   │   └── state.ts        # LangGraph state annotations & reducers
│   └── index.ts            # Public API exports & core bootstrap
├── .env.example            # Documented environment template
├── .gitignore              # Clean artifact exclusion
├── Decision.md             # Enterprise ADR record
├── package.json            # ESM package manifest with latest dependencies
├── pnpm-lock.yaml          # Deterministic dependency lockfile
└── tsconfig.json           # Production-grade NodeNext compiler configuration
```

---

## Update 2 — [2026-10-22 20:11:00 IST]

### 1. Official Temporal Developer Agent Skill Integration
- **Action:** Installed `temporalio/skill-temporal-developer` via `npx skills add` at both the **workspace root** (`/.agents/skills/temporal-developer`) and the **agent workspace** (`/Agents/SeoAgent/.agents/skills/temporal-developer`).
- **Rationale:** Equips coding subagents and developers with authoritative patterns for Temporal SDK determinism rules, non-blocking asynchronous timers, activity heartbeats, exponential retry policies, and workflow versioning without manual context reloading.

### 2. Temporal Cloud Production Target Configured
- **Action:** Upgraded connection targets from local development stub (`localhost:7233`) to official Temporal Cloud cluster:
  - **Address:** `quickstart-rox-seoagent-1212.odwdl.tmprl.cloud:7233`
  - **Namespace:** `quickstart-rox-seoagent-1212.odwdl`
  - **Authentication:** `TEMPORAL_API_KEY` with TLS / mTLS capability.
- **Rationale:** Connects the agent directly to enterprise-grade cloud execution infrastructure capable of distributed multi-worker orchestration with 99.99% workflow durability SLA.

### 3. Resilient Multi-Key Environment Mapping
- **Action:** Updated `src/config/env.ts` and `.env.example` with fallback compatibility:
  - Supports both `TEMPORAL_API_KEY` and legacy `TEMPORAL_KEY`.
  - Supports both `OPENAI_API_KEY` and `OPENAPI_KEY`.
- **Rationale:** Prevents runtime startup crashes caused by variable naming mismatches across CI/CD and developer machine configurations.

---

## Next Planned Steps (When Ready to Implement Agents)
1. **Temporal Cloud Client & Worker Bootstrap:** Build `src/temporal/client.ts` and `src/temporal/worker.ts` with secure TLS connection to Temporal Cloud.
2. **Pillar 1 Ingestion Activity:** Temporal Activity for Dual-Tier Ingestion (`undici` static pass + JEV browser gate).
3. **Pillar 2 Evidence Collector:** Headless Playwright DOM differ and screenshot bounding-box generator.
4. **LangGraph Graph Assembly:** Wiring node transitions and state checkpoints.

