# Competitor Agent

Give it an idea. It verifies whether the idea is worth pursuing, finds the real competitors in the market, digs into **what each of them does and how they do it**, then hands you a verdict with the whitespace you could own.

Built with **Python + CrewAI** (four sequential agents), **FastAPI** on the backend, a plain **HTML / CSS / JS** frontend, and **PostgreSQL in Docker** for persistence. Web access runs on **TinyFish** (`search` + `fetch_content` over MCP) — the analyst reads each competitor's actual pages, not just snippets.

## How it works

Four stages run in order, each one a single-agent CrewAI crew. The result is checkpointed to Postgres after every stage, so the UI shows live progress and a late failure still keeps what was already learned.

| # | Stage | Agent | Job |
|---|-------|-------|-----|
| 1 | `validating` | **Idea Validator** | Restates the idea, names the category & buyer, checks demand with live search, scores novelty/feasibility, and invents the competitor search queries |
| 2 | `scouting` | **Competitor Scout** | Runs those queries (`alternatives to X`, `best <category> tools`…) and de-duplicates the results into a ranked shortlist |
| 3 | `analysing` | **Competitor Analyst** | Per rival: what they do, **how they do it**, pricing, audience, strengths, weaknesses, threat level — every claim tied to a source URL |
| 4 | `verdict` | **Strategy Verdict** | Head-to-head comparison: gaps, differentiators, risks, next two weeks, and a `go / pivot / niche / no-go` call |

```
public/                  # Frontend (vanilla HTML/CSS/JS)
app/
  main.py                # FastAPI: routes + static UI
  runner.py              # background worker, stage checkpoints
  db.py                  # Postgres access + in-memory fallback
  config.py              # .env loading
  models.py              # request/response schemas
crew/
  crew.py                # agents, tasks, prompts (CrewAI)
  tools.py               # CrewAI tools: web_search, fetch_webpage
  tinyfish.py            # TinyFish MCP client (search + fetch_content)
  schemas.py             # result JSON schemas
  parsing.py             # LLM-output → JSON recovery
  stages.py              # shared stage names/labels
database/001_init.sql    # schema (auto-run by Docker)
docker-compose.yml       # PostgreSQL 16
```

## Setup

### 1. Install dependencies

```bash
cd Agents/CompetitorAgent
python -m venv .venv
.venv\Scripts\activate        # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
copy .env.example .env        # macOS/Linux: cp .env.example .env
```

```
OPENAI_API_KEY=sk-...
MODEL=openai/gpt-4.1-mini     # any LiteLLM id: groq/…, anthropic/…, ollama/…
TINYFISH_API_KEY=sk-tinyfish-...   # web search + page fetch
PORT=3007
DATABASE_URL=postgresql://competitor:competitor_local_password@localhost:5436/competitor_agent
```

TinyFish talks MCP to `https://agent.tinyfish.ai/mcp` with an `X-API-Key` header. The key is resolved in this order:

1. `TINYFISH_API_KEY` in `.env`
2. the key the TinyFish CLI already stored, at `~/.tinyfish/config.json`

So if you have ever run `npx @tiny-fish/cli connect`, **no setup is needed** — leave `TINYFISH_API_KEY` empty. Otherwise get a key at <https://agent.tinyfish.ai>.

> No key at all? The run still works — the agent says search was unavailable and answers from model knowledge, and the UI shows a warning banner.

### 3. Start PostgreSQL (Docker)

```bash
docker compose up -d
```

`database/001_init.sql` is applied automatically on first boot.

> The API degrades gracefully: if Postgres is down, analyses still run and stay available in memory until restart — they just aren't persisted.

### 4. Run the server

```bash
uvicorn app.main:app --reload --port 3007
```

Open **http://localhost:3007**.

## API

| Method | Endpoint | Body / query | Purpose |
| ------ | -------- | ------------ | ------- |
| `POST` | `/api/analyze` | `{ idea, audience?, max_competitors? }` | Queue an analysis → `202 { id, status, stage }` |
| `GET`  | `/api/analyses/{id}` | — | Poll one analysis (status, stage, partial or final result) |
| `GET`  | `/api/analyses` | `?limit=20` | Recent history |
| `DELETE` | `/api/analyses/{id}` | — | Remove one analysis |
| `GET`  | `/api/health` | — | Model, search provider, database health |
| `GET`  | `/docs` | — | OpenAPI playground |

### Example

```bash
curl -X POST http://localhost:3007/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"idea":"An AI agent that turns a Shopify store's public product data into personalized cold-email outreach","audience":"Indian D2C founders","max_competitors":5}'

# then poll
curl http://localhost:3007/api/analyses/<id>
```

## Data model

- **analyses** — one row per idea: status, current stage, model, full `result` JSONB, timestamps
- **competitors** — the researched rivals, flattened out of the JSON so they stay queryable (`threat_level`, `strengths`, `sources`…)
- **search_queries** — audit trail of every search the crew ran, with provider, hit count and errors

## Limits & knobs

| Env | Default | Meaning |
| --- | ------- | ------- |
| `MAX_COMPETITORS` | `5` | Rivals deep-analysed (UI offers 3 / 5 / 8) |
| `MAX_SEARCH_RESULTS` | `6` | Results returned per search |
| `MAX_FETCH_CHARS` | `6000` | Page text kept per `fetch_webpage` call |
| `MAX_IDEA_CHARS` | `4000` | Idea length cap |
| `LLM_TEMPERATURE` | `0.2` | Crew temperature |
| `CREW_VERBOSE` | `false` | Print CrewAI step-by-step logs |

## Tests

```bash
pytest
```

Covers the LLM-output → JSON recovery (fences, preamble, trailing commas) and the result schemas — no network or API key needed.

## Tech stack

- **Agents:** CrewAI (agents, tasks, sequential process) with a custom `web_search` tool
- **Search:** TinyFish — `search` + `fetch_content` over MCP, keyed by `TINYFISH_API_KEY` (or the TinyFish CLI config)
- **LLM:** any LiteLLM-compatible model (`openai/`, `groq/`, `anthropic/`, `ollama/`…)
- **Backend:** FastAPI + Pydantic, background worker thread
- **Database:** PostgreSQL 16 via `psycopg`, provisioned by Docker Compose
- **Frontend:** Vanilla HTML / CSS / JS — no framework, no build step
