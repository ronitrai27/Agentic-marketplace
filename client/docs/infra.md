# Infra Overview

One line: **Vercel** (web) → **Convex** (DB + backend + gateway) → **Temporal Cloud** (durable runs) → **Worker** (Docker) → **Agent servers** (Docker, Catelog SDK).

## Services

| Service | Where it runs | What it does | Why we use it |
|---|---|---|---|
| **Web app** (`client/`, Next.js) | Vercel | UI, auth pages, agent pages, chef chat | Zero-config Next.js hosting, preview per push. Note: the Vercel build fails if a helper sits in the gitignored `lib/` folder (fixed in c33d6df). |
| **Convex** (`client/convex/`) | Convex Cloud | Database, HTTP actions (the gateway), wallet/escrow/ledger, crons, Better Auth | Realtime DB: the run sheet and wallet update live without extra code. One place for money logic with transactions. |
| **Convex crons** (`crons.ts`) | Convex | Clean rate-limit windows (5 min), reap stale runs (1 min), purge archived agents (24 h), release creator earnings after 48 h (1 h) | Housekeeping without a separate scheduler. |
| **Temporal Cloud** | Temporal Cloud | Runs `runAgentWorkflow` for every marketplace run | A run can last minutes and costs money, so it must survive crashes. Temporal gives durable state, heartbeats and timeouts. Runs are **never auto-retried** (`maximumAttempts: 1`) so a user is not charged twice. |
| **Worker** (`worker/`) | AWS ECS Fargate (Sydney) | Picks up Temporal tasks, signs the request, calls the agent, streams SSE events back to Convex | Keeps long-running work off Convex and Vercel (they have time limits). Includes SSRF checks and request signing. Needs `ca-certificates` for TLS to Temporal Cloud. |
| **MCP server** (`mcp/`) | AWS Lightsail Containers (Sydney), port 8080 | Lets MCP clients (Claude etc.) list and run agents, with OAuth and wallet approval links | Exposes the marketplace to AI clients. Talks to Convex through `MCP_BACKEND_SECRET`. |
| **Agents** (`Agents/*`) | Docker (Northflank, per the Dockerfiles) | Each agent is its own service built with the `catelog` SDK: `/health`, `/schema`, `/execute` | Agents are independent: creators can host anywhere. JobFitAgent has to be on Docker, not Vercel: the Claude Agent SDK binary is ~280MB, over Vercel's 250MB function limit. |
| **SeoAgent / researchAgent** | Docker + their own Temporal worker | Long crawls and deep research as Temporal workflows | Multi-minute jobs need durability and heartbeats. |
| **LeadFinder** | Trigger.dev | Lead-finding task (max 10 min) | Trigger.dev gives durable background tasks without running our own worker. |
| **Upstash Redis + Arcjet** | SaaS | Rate limiting and bot/abuse protection on the web app | Serverless-friendly, works on Vercel with no server to run. |
| **PayPal** | SaaS | Wallet top-ups | Standard checkout; credits are then spent inside Convex. |
| **Agent tools** (OpenAI, Groq, OpenRouter, Browserbase, SerpAPI, Firecrawl, PageSpeed) | SaaS | Used inside agents only | Each agent keeps its own keys in its own env. |

## AWS (region `ap-southeast-2`, Sydney)

The org's service control policy (SCP) only allows this region: ECR calls in `us-east-1` were denied. Everything below is in Sydney. All of it points at the **dev** Convex deployment (`friendly-finch-453`).

| AWS service | Resource | What we use it for | Why |
|---|---|---|---|
| **ECR** | repo `catelog-worker` (tag `dev`, scan on push) | Stores the worker's Docker image | Fargate pulls from it. Same region, no pull cost. |
| **ECS on Fargate** | cluster `catelog`, service `catelog-worker`, 1 task, 0.5 vCPU / 1 GB | Runs the Temporal worker 24/7 | The worker only makes outbound calls (Temporal, Convex, agents), so it needs no server, load balancer or open port. ECS restarts it if it crashes. |
| **IAM** | role `catelog-worker-exec` | Lets ECS pull the image, write logs and read one secret | Least privilege: AWS managed `AmazonECSTaskExecutionRolePolicy` plus an inline policy that can read only the `catelog/worker` secret. |
| **Secrets Manager** | secret `catelog/worker` (7 keys) | Holds `TEMPORAL_*`, `CONVEX_SITE_URL`, `WORKER_SECRET`, `RUN_SECRET_PRIVATE_KEY` | Secrets never sit in the image or in the task definition. ECS injects them as env vars at start. |
| **CloudWatch Logs** | log group `/ecs/catelog-worker`, 14-day retention | Worker logs | Built in for Fargate. Retention caps cost. |
| **VPC / EC2 networking** | default VPC, 3 public subnets, default security group | Where the task runs, with a public IP | A public IP avoids a NAT gateway (about $30+/month). The security group has no inbound rules. |
| **Lightsail Containers** | service `catelog-mcp`, `nano` size, scale 1 | Runs the MCP server behind a free HTTPS URL | Simplest way to get a public HTTPS endpoint with a fixed low price. The MCP server must be reachable by Claude, Cursor and other clients. |

### Run commands

Redeploy the worker (after a code change):
```bash
cd worker && docker build -t <acct>.dkr.ecr.ap-southeast-2.amazonaws.com/catelog-worker:dev .
# push to ECR, then:
aws ecs update-service --cluster catelog --service catelog-worker --force-new-deployment --region ap-southeast-2
```
Redeploy the MCP server:
```bash
cd mcp && docker build -t catelog-mcp:latest .
aws lightsail push-container-image --service-name catelog-mcp --label mcp --image catelog-mcp:latest --region ap-southeast-2
# then create a deployment that uses the new image, keeping the same env vars and public endpoint
```
Worker logs: `aws logs tail /ecs/catelog-worker --follow --region ap-southeast-2`

### Gotchas we hit
- **`NativeCertsNotFound`**: the slim Node image has no CA bundle, so TLS to Temporal Cloud failed. The worker Dockerfile now installs `ca-certificates`.
- **Windows Docker push**: `docker login` can fail with "error storing credentials". Use a temporary `DOCKER_CONFIG` folder with the auth written in directly.
- **MCP permissions**: the MCP server requires every scope (`wallet:read runs:execute`) so clients ask for both. Old tokens with only `wallet:read` are rejected and the client reconnects.
- **Cost**: roughly $15–20/month for the Fargate task plus the Lightsail `nano` plan.

### Not done yet (before going public)
- `MCP_BACKEND_SECRET` sits in plain text in the Lightsail deployment env. Lightsail has no secret store, so rotate it if it leaks or move the MCP to ECS with Secrets Manager.
- One worker task means no redundancy. Set the service to 2 tasks for production.
- Everything uses dev Convex. Production needs its own Convex deployment, secrets and worker.

## Run flow (why it is built this way)
1. User confirms → Convex checks wallet and **holds** credits (escrow).
2. Convex starts a Temporal workflow with **ids only**; the agent URL and signing key are looked up inside the worker and never stored in workflow history.
3. Worker signs the call, streams events into Convex, and the UI shows them live.
4. Output matches the schema → charge. Any error or schema violation → release the hold, charge nothing.
5. If a worker dies, the `reap-stale-runs` cron closes the run.

## Where to see logs

| Need | Look here |
|---|---|
| Web app / API routes (Next.js) | Vercel dashboard → project → **Logs** (runtime) and **Deployments** (build logs). CLI: `vercel logs <url>` |
| Backend, wallet, gateway, crons | Convex dashboard → **Logs** (live) and **Functions** (per-function runs, cron history). CLI: `npx convex logs` |
| Run history, why a run is stuck | Temporal Cloud UI → Namespace → **Workflows** → open the run → Event History |
| Worker | CloudWatch log group `/ecs/catelog-worker` (AWS console → CloudWatch → Logs, region Sydney). CLI: `aws logs tail /ecs/catelog-worker --follow --region ap-southeast-2`. Healthy line: `catelog worker polling catelog-agent-runs` |
| MCP server | Lightsail console → container service `catelog-mcp` → **Logs**. CLI: `aws lightsail get-container-log --service-name catelog-mcp --container-name mcp --region ap-southeast-2` |
| Agent containers | The host's service **Logs** tab (Northflank for agents). Locally: `docker logs <container>` |
| Agent health | `GET /health` on the agent URL (also what the Docker `HEALTHCHECK` calls every 30 s) |
| Agent run telemetry | Catelog SDK logs/metrics (`log.info`, `metric.count`); in dev they print to the agent's console |
| LeadFinder | Trigger.dev dashboard → **Runs** |

## Notes
- Worker runs on ECS Fargate and the MCP server on Lightsail Containers, both in `ap-southeast-2` (see the AWS section above).
- Secrets that must match across services: `WORKER_SECRET` (Convex ↔ worker), `MCP_BACKEND_SECRET` (Convex ↔ MCP), `RUN_SECRET_PRIVATE_KEY` (worker) ↔ `RUN_SECRET_PUBLIC_KEY` (Convex).
- Security: `Docs/Browserbase.md` contains a live-looking Browserbase API key committed to git. Rotate it and remove the key from the file.
