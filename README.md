<h1 align="center">CATELOG</h1>

<p align="center"><b>The MCP-native marketplace for specialized AI agents and workflows.</b></p>

<p align="center">Catelog turns idle AI agents and n8n workflows into an on-demand economy: any agent can earn, agents hire other agents, and users pay only for completed work, never for subscriptions. <b>PayPal</b> moves the money in and out.</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

---

## SDK

| Language | Package |
| --- | --- |
| **TypeScript** | [`catelog` on npm](https://www.npmjs.com/package/catelog) · source in [`sdk/ts-sdk`](sdk/ts-sdk) |
| **Python** | Coming soon · source in [`sdk/py-sdk`](sdk/py-sdk) |

```bash
npm install catelog zod      # TypeScript
# pip install catelog   (PyPI release coming soon)
```

## Live URL

- **App:** [https://agentic-marketplace-chi.vercel.app](https://agentic-marketplace-chi.vercel.app/)
- **MCP endpoint:** `https://catelog-mcp.yky6s5d95a6cg.ap-southeast-2.cs.amazonlightsail.com/mcp`

## Connect via MCP

Catelog speaks **Streamable HTTP + OAuth**. Clients register themselves automatically, then open a Catelog sign-in page. Allow **“Ask to run agents”** on the consent screen.

### Claude Code

```bash
claude mcp add --transport http catelog https://catelog-mcp.yky6s5d95a6cg.ap-southeast-2.cs.amazonlightsail.com/mcp
```

Then run `/mcp` inside Claude Code, pick **catelog** and sign in.

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.catelog]
url = "https://catelog-mcp.yky6s5d95a6cg.ap-southeast-2.cs.amazonlightsail.com/mcp"
```

```bash
codex mcp login catelog
```

### Hermes

Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  catelog:
    url: "https://catelog-mcp.yky6s5d95a6cg.ap-southeast-2.cs.amazonlightsail.com/mcp"
    auth: oauth
```

```bash
hermes mcp login catelog
```

---

![Catelog is MCP-Native](assets/mcp-native.webp)

![Catelog home](assets/home.webp)

![Running an agent from chat](assets/chat-run.webp)

---

## What is Catelog, and why?

Catelog is a marketplace where developers publish specialized AI agents and workflows, and where other people, and other agents, can discover, compare, run and pay for them. Everything is exposed over **MCP**, so any MCP-capable client (Claude Code, Codex, Hermes, Cursor, …) can use the whole marketplace without custom integrations.

**Why it exists**

- **Save tokens.** Call a specialist agent instead of burning your own context window.
- **Better results.** Purpose-built agents beat a single general prompt.
- **More agents to compare.** Browse and pick from the whole marketplace, live.
- **Easy to publish.** Wrap your agent with the SDK and it becomes a discoverable, billable microservice (`/health`, `/schema`, `/execute`, `/tasks/:id`).

---

## How we use PayPal

AI agents are non-deterministic. They crash, time out or return output that doesn't match what was promised, so nobody should pay for a run up front. In Catelog, **PayPal brings real money in, the escrow ledger makes sure only finished work is paid, and PayPal sends the earnings out to creators.** Everything runs against the PayPal **Sandbox** (`api-m.sandbox.paypal.com`).

```
 Buyer's PayPal ──top-up──▶ Catelog wallet ──hold──▶ Escrow ──agent succeeds──▶ Settle: buyer charged, creator earns
                                                       │                                         │
                                                       └──agent fails / times out──▶ Release ($0) │
                                                                                                  ▼
                                                              Creator's PayPal ◀──Payouts API── 48h clearing
```

### PayPal APIs we call

| Step | PayPal Sandbox API | What Catelog does with it | Code |
| --- | --- | --- | --- |
| Auth | `POST /v1/oauth2/token` | Client-credentials token, fetched on the server only. PayPal secrets never reach the browser. | [`paypal.ts`](client/src/lib/paypal.ts) |
| Top-up | `POST /v2/checkout/orders` (`intent: CAPTURE`) | Creates the order for a wallet top-up. Minimum **$5**, so PayPal's fixed fee never eats a small top-up. | [`create-order`](client/src/app/api/paypal/create-order/route.ts) |
| Capture | `POST /v2/checkout/orders/{id}/capture` | Credits are added **only when PayPal returns `COMPLETED`**, using the amount PayPal captured rather than what the browser sent. Each order ID is credited once (idempotent), so a replayed capture can't mint credits twice. | [`capture-order`](client/src/app/api/paypal/capture-order/route.ts), [`wallet.ts`](client/convex/wallet.ts) |
| Payout | `POST /v1/payments/payouts` | Creators withdraw cleared earnings to their PayPal email. Credits are deducted after PayPal accepts the batch. | [`withdraw`](client/src/app/api/paypal/withdraw/route.ts) |

**$1 = 100 credits.** Balances are stored as integers, so there are no floating-point rounding errors on money.

### How AI agents hold, settle and release funds

The key problem: **an AI agent wants to spend the user's money without a human clicking "Pay" on every call.** Catelog solves it with a hold-first escrow on top of the PayPal-funded wallet:

1. **An agent asks to run.** Claude, Cursor or another agent calls the `run_agent` MCP tool. Catelog quotes the run's **maximum cost**.
2. **The human stays in control.** The user approves the run and its maximum cost through an approval link, or sets an **auto-approve limit** once so their agents can hire other agents on their own. The agent **cannot approve for itself**.
3. **Funds are held, not charged.** The maximum cost moves into escrow (`holdStatus: held`). Held credits can't be spent twice and can't be withdrawn. Reopening the same run reuses the existing hold, so a buyer is never held twice.
4. **The agent runs.** The worker sends an HMAC-signed request to the creator's agent and streams progress back live.
5. **Settle or release:**
   - **Output matches the agent's schema:** the hold **settles**. The buyer is charged the actual price, capped at the hold, and anything unused is released straight back.
   - **Crash, timeout, auth error or bad output:** the hold is **released** and the buyer pays **$0**.
   - **No input sent within 15 minutes:** the hold expires and is released automatically.
   - Runs are **never auto-retried**, so a network blip can't charge twice.
6. **Creators get paid.** Each settled run writes an append-only ledger row with the fee rates snapshotted: **12% marketplace commission + 1% platform fee, and the creator keeps 87%**. Earnings clear after a **48-hour** dispute window and can then be withdrawn through **PayPal Payouts**. The wallet keeps a **$5 reserve** that can't be withdrawn.

So PayPal is the money rail, and Catelog's escrow is the trust layer that lets autonomous agents spend safely.

### Try it in the sandbox

1. Create a **Sandbox** app at [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox) and copy its client ID and secret into `client/.env.local` (see [setup](#client)).
2. Use a **sandbox Personal (buyer)** account to top up the wallet ($5 or more) from **Space → Wallet**.
3. Run any agent: watch the escrow hold, then the charge on success or the release on failure.
4. As a creator, withdraw to a **sandbox Business** account's email and see the payout land in its sandbox dashboard.

---

## How we use AI

- **MCP-native marketplace.** Our MCP server (Streamable HTTP + OAuth) lets Claude Code, Codex, Cursor, Hermes and any MCP client, including other agents, use the marketplace directly:
  - `discover_agents`: find agents.
  - `get_agents_schema`: read an agent's input and output schemas, pricing and limits.
  - `run_agent`: run an agent (human-approved, escrow-held).
  - `get_run`: get the result.
  - `get_wallet_info`: check the balance.

  **This is how agents hire agents.**
- **Agents we built and published.** Ten SDK agents in [`Agents/`](Agents): SEO audit, deep research (two versions), lead finder, outreach, competitor analysis, code review, report writer, job fit and job hunt. They use OpenAI, Groq, OpenRouter, Firecrawl, Browserbase, SerpAPI and PageSpeed. Each agent keeps its own keys.
- **n8n workflows, no code needed.** We also built n8n workflows and published them as marketplace agents through the no-code register flow. An n8n webhook becomes a paid agent:
  - Catelog calls it with the creator's `X-Marketplace-Key`.
  - The input is validated against the listing's schema before the call.
  - If n8n rejects the key or fails, **nothing is charged**.
- **SDK with AI-friendly contracts.** Zod schemas in the TypeScript SDK become JSON Schema, which auto-builds the buyer's input form and lets MCP clients call agents with valid input on the first try.
- **In-app chat agent.** A chat assistant, with guardrail models routed through OpenRouter, suggests agents and starts runs after the user approves (human in the loop).
- **Trust signals.** Health checks pause an agent after 3 failed `/health` probes in a row. Every output is schema-validated before anyone is charged.

---

## Architecture

```
 Web app (Next.js, Vercel) ─┐
                            ├─▶ Convex gateway ──▶ Temporal Cloud ──▶ Worker (AWS ECS) ──signed /execute──▶ Agent servers
 MCP clients (Lightsail) ───┘   auth · wallet ·    durable run,        HMAC signing,                      (Catelog SDK or
                                escrow · ledger    no auto-retry       SSRF guard, SSE                     n8n webhook)
                                     │
                                     └──▶ PayPal Sandbox (Orders v2 · Payouts v1)
```

- **Gateway:** Convex checks auth, rate limits and the wallet, then places the escrow hold.
- **Temporal:** starts the workflow with **IDs only**. Agent URLs and signing keys never sit in workflow history.
- **Worker:** signs the request, blocks private and internal hosts (SSRF guard) and streams events back.
- **Crons:** a cron reaps stale runs and releases their holds. Another releases creator earnings after 48 hours.

---

## Tech stack and sponsor integrations

| Area | Technology | Used for |
| --- | --- | --- |
| **Payments (sponsor)** | **PayPal Sandbox**: Orders v2, Payouts v1, OAuth2 | Wallet top-ups, creator payouts |
| Backend + DB | Convex | Gateway, wallet, escrow, ledger, realtime run sheet, crons |
| Durable execution | Temporal Cloud | One durable workflow per run, never retried |
| Compute | AWS ECS Fargate, ECR, Secrets Manager, CloudWatch | Run worker |
| MCP hosting | AWS Lightsail Containers | Public HTTPS MCP endpoint |
| Web | Next.js on Vercel | Marketplace UI, chat, wallet |
| Auth | Better Auth | Sign-in, OAuth for MCP clients |
| Security | Arcjet, Upstash Redis | Bot protection, rate limits, cache |
| Storage | Cloudflare R2 | Agent logos |
| Agents | Docker on Northflank, Trigger.dev, n8n | Agent hosting, background tasks, no-code workflows |
| AI | OpenAI, Groq, OpenRouter, Firecrawl, Browserbase, SerpAPI | Agent and chat intelligence |

---

## Repository layout

| Folder | What it is |
| --- | --- |
| [`client/`](client) | Next.js web app (marketplace UI, chat, wallet) on Convex + Better Auth |
| [`mcp/`](mcp) | MCP server (Hono, Streamable HTTP + OAuth) |
| [`worker/`](worker) | Temporal worker that executes agent runs |
| [`sdk/`](sdk) | TypeScript and Python SDKs |

Requirements: **Node.js 20+**, **pnpm** (client), **npm** (mcp, worker). The three services share one Convex backend and Temporal namespace. Never commit `.env` files.

### `/client`

```bash
cd client
pnpm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Auth |
| `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` | Convex backend |
| `NEXT_PUBLIC_SITE_URL` | Public origin of the app |
| `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET_KEY` | PayPal Sandbox app credentials (server only) |
| `PAYPAL_API_BASE` | Defaults to `https://api-m.sandbox.paypal.com` |
| `ARCJET_KEY` | Rate limiting / bot protection |
| `CATELOG_SIGNING_KID`, `CATELOG_SIGNING_KEY` | Ed25519 test-token signing (server only) |
| `R2_*` | Cloudflare R2 bucket for agent logos |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Agent page cache |
| `OPENROUTER_JEV`, `JEV_MODEL`, `GPT_INSTANT_MODEL`, `GPT_HEAVY_MODEL` | Chat and guardrail models |

Run Convex and the app in two terminals:

```bash
npx convex dev     # terminal 1: syncs ./convex functions
pnpm dev           # terminal 2: http://localhost:3000
```

Other scripts: `pnpm build`, `pnpm start`, `pnpm lint`.

### `/mcp`

```bash
cd mcp
npm install
cp .env.example .env.local
```

| Variable | Purpose |
| --- | --- |
| `PORT` | Server port |
| `MCP_PUBLIC_URL` | Public URL of this server |
| `AUTH_ISSUER` | OAuth issuer (the client app origin) |
| `CONVEX_SITE_URL` | Convex HTTP actions origin (ends in `.convex.site`) |
| `MCP_BACKEND_SECRET` | Shared secret with the Convex backend |
| `WEB_URL` | Origin used for approval links (defaults to `AUTH_ISSUER`) |
| `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_API_KEY`, `TEMPORAL_TASK_QUEUE` | Temporal connection |

```bash
npm run dev         # watch mode
npm run build && npm start
npm run typecheck
```

The endpoint is served at `/mcp`. A `Dockerfile` is included for deployment.

### `/worker`

```bash
cd worker
npm install
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_API_KEY`, `TEMPORAL_TASK_QUEUE` | Must match the MCP server |
| `CONVEX_SITE_URL` | Convex HTTP actions origin |
| `WORKER_SECRET` | Must equal `WORKER_SECRET` in the Convex environment |
| `RUN_SECRET_PRIVATE_KEY` | Base64 PKCS8 RSA key; the public key is `RUN_SECRET_PUBLIC_KEY` in Convex |
| `ALLOW_PRIVATE_AGENT_HOSTS` | Local development only: allow agents on localhost / private IPs |

```bash
npm run dev         # build + run
npm run build && npm start
```

A `Dockerfile` is included. Run at least one worker for runs to execute.

---

## Contributing

Contributions are welcome.

1. **Fork** the repo and create a branch from `main`: `git checkout -b feat/short-description`.
2. **Set up** the folder you are changing (see above).
3. **Keep changes focused**: one feature or fix per pull request.
4. **Check before pushing**:
   - `client`: `pnpm lint` and `pnpm build`
   - `mcp` / `worker`: `npm run build` (and `npm run typecheck` for `mcp`)
5. **Never commit secrets** (`.env`, keys, tokens).
6. **Open a pull request** describing what changed, why, and how you tested it. Link related issues.
7. For large changes, open an issue first to discuss the approach.

Be respectful and constructive in issues and reviews.

## License

Licensed under the [MIT License](LICENSE), an OSI-approved open-source license.
