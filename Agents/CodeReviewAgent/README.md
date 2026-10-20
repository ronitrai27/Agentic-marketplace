# Code Review Agent

AI-powered code reviewer. Paste a snippet or upload a handful of files and get back a structured review: mistakes, security vulnerabilities, performance problems, maintainability debt, plus a score, verdict and prioritised risks.

Built with **Node + Express + TypeScript** on the backend (OpenAI SDK with structured outputs), a plain **HTML / CSS / JS** frontend, and **PostgreSQL in Docker** for persistence.

## Features

- **Paste mode** — paste a single snippet, optionally declare the language / filename / context.
- **Upload mode** — upload **1–10 files** (drag & drop or browse) for a cross-file review.
- **Structured output** — every review returns:
  - 0–100 score + verdict (`approve` / `request-changes` / `reject`)
  - Issues sorted by severity (`critical → info`) with file, line, snippet and a concrete suggested fix
  - Production risks with impact & likelihood
  - Strengths and ranked recommendations
- **History** — every review is persisted to PostgreSQL and re-openable from the history bar.
- **Graceful degradation** — the API keeps working (and answers reviews) even if the database is offline.

## Project structure

```
CodeReviewAgent/
├── public/                  # Frontend (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── src/
│   ├── agent/               # OpenAI reviewer
│   │   ├── prompts.ts       # System + user prompt builders
│   │   ├── reviewer.ts      # OpenAI SDK call w/ JSON-schema structured output
│   │   └── types.ts         # Review domain types
│   ├── config/env.ts        # Env loading & validation
│   ├── db/
│   │   ├── pool.ts          # pg Pool + health check
│   │   └── repository.ts    # Save / list / fetch reviews
│   ├── routes/review.routes.ts
│   └── server.ts            # Express app entry
├── database/001_init.sql    # Schema (auto-run by Docker)
├── docker-compose.yml       # PostgreSQL 16
├── .env.example
└── package.json
```

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set your real key:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
PORT=3006
DATABASE_URL=postgres://review:review_local_password@localhost:5435/code_review_agent
```

### 3. Start PostgreSQL (Docker)

```bash
pnpm db:up           # docker compose up -d postgres
```

The schema in `database/001_init.sql` is applied automatically on first boot.

> The app runs fine without the database — reviews still work, they just aren't saved to history.

### 4. Run the server

```bash
pnpm dev             # tsx watch (auto-reload)
# or
pnpm start           # tsx src/server.ts
```

Open **http://localhost:3006**.

## API

| Method | Endpoint             | Body                                          | Purpose                          |
| ------ | -------------------- | --------------------------------------------- | -------------------------------- |
| `POST` | `/api/review/paste`  | `{ code, language?, filename?, context? }`    | Review a pasted snippet          |
| `POST` | `/api/review/files`  | `multipart/form-data` — `files[]`, `context?` | Review 1–10 uploaded files       |
| `GET`  | `/api/reviews`       | —                                             | Recent review history            |
| `GET`  | `/api/reviews/:id`   | —                                             | One saved review + its issues    |
| `GET`  | `/api/health`        | —                                             | Backend + database health        |

### Example

```bash
curl -X POST http://localhost:3006/api/review/paste \
  -H "Content-Type: application/json" \
  -d '{"code":"const db = require(\"sqlite\"); db.run(\"SELECT * FROM t WHERE id=\" + id);","language":"javascript"}'
```

## Limits

- Max **10 files** per upload (`MAX_FILES`)
- Max **200 KB** per file (`MAX_FILE_BYTES`)
- Max **60 000 characters** of pasted code (`MAX_CODE_CHARS`)

All configurable via `.env`.

## Tech stack

- **Backend:** Express, TypeScript (ESM, NodeNext), Zod validation, Multer uploads
- **AI:** OpenAI SDK (`openai`) with `json_schema` structured outputs
- **Database:** PostgreSQL 16 via `pg`, provisioned by Docker Compose
- **Frontend:** Vanilla HTML / CSS / JS — no framework, no build step
