# Research Agent 2 (Nova Research)

Dual-mode research agent on the OpenAI Responses API, served through the Catelog marketplace protocol (`catelog@^1.3.0`).

## Modes

- **Fast** — `gpt-6-luna` with OpenAI's built-in `web_search` tool. Returns a structured Markdown report (summary, findings, conclusion) with a **Citations** section last.
- **Deep** (~3 min) — paced progress is streamed over SSE (progress %, stage messages) while the real pipeline runs, and the result is held until 3 minutes have elapsed:
  1. **Search** — `gpt-6-luna` + `web_search` gathers raw notes and sources.
  2. **Verify** — `gpt-4.1-mini` checks every claim against the sources (verified / unsupported / questionable).
  3. **Format** — `gpt-6-luna` writes the final report: cover page → index → content → citations.

The deep progress events are cosmetic (the 3 min floor is intentional); the models, verification and report are real.

## Run

```bash
pnpm ui                                  # web UI + marketplace endpoints on :3001
pnpm start "your question" 1             # CLI, fast
pnpm start "your question" 2             # CLI, deep (~3 min)
```

Marketplace endpoints: `/health`, `/schema`, `/execute`. Env vars: see `.env.example`.

Code: `src/research.ts` (pipelines) · `src/server.ts` (catelog agent + web UI SSE) · `src/index.ts` (CLI).
