# Universal Outreach Agent

This directory contains the first working implementation of the marketplace's
`universal-outreach-agent`.

## Layout

- `services/agent-api`: FastAPI service with Pydantic contracts, policy gates,
  provider adapter interfaces, one-hour sessions, and durable workspace state.
- `apps/web`: React + Vite configuration and run-monitoring UI.
- `apps/trigger`: Trigger.dev task definitions and an authenticated API client.
- `contracts`: versioned JSON Schema snapshots for marketplace integration.

The implementation is deliberately safe by default:

- `DRY_RUN=true` unless explicitly changed.
- Approval is required by default.
- Live dispatch fails closed until a verified provider adapter is configured.
- Live dispatch is rejected when credentials or provider capability checks are
  missing.
- Internal execution endpoints require `Authorization: Bearer
  <INTERNAL_API_TOKEN>`.
- The browser uses `/api/v1/outreach/preview`, which only permits dry runs;
  browser code never receives the internal token.
- The browser's live-send flow uses `/api/v1/outreach/send`, requires an
  explicit approval flag, and must be protected by marketplace authentication
  before production deployment.
- Sarvam Chat Completion generates the subject and body only from the supplied
  objective and recipient context.
- Gmail sends only after `approval_granted=true` when approval is required.
- Email outreach supports up to five attachments per recipient, with a maximum
  of 10 MB per file. The UI accepts PDF, Word, Excel, text, PNG, and JPEG
  files. Dry runs never contact Gmail; approved live sends add the files to
  the Gmail MIME message.
- Bulk Excel send: upload a `.xlsx` workbook whose first row contains `name`
  and `email` columns (an optional `context` column is used for
  personalization). The API parses the file, enforces a hard limit of 50
  recipient rows per upload, skips invalid rows with a reported reason, and
  returns a per-recipient delivery directory so the UI can show exactly who
  was contacted.

## Run the API

```powershell
cd services\agent-api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

## Run PostgreSQL with Docker

The local development database is provided by `docker-compose.yml`. This
project maps PostgreSQL to host port `5434` because port `5432` may be used by
another local project.

```powershell
cd C:\Users\DELL\Desktop\Ai Marketplace\Agentic-marketplace\Agents\OutreachAgent
docker compose up -d postgres
docker compose ps
```

The API uses PostgreSQL when `PERSISTENCE_BACKEND=postgres` and
`DATABASE_URL` point to this container. The first startup applies
`database\001_initial.sql` and `database\002_runtime_store.sql`. Data is
persisted in the Docker volume `outreachagent_outreach_postgres_data`.

To inspect runtime records:

```powershell
docker exec outreach-postgres psql -U outreach -d agent_marketplace
```

The API process must be restarted after switching from the SQLite store so it
loads the PostgreSQL environment variables.

## Run the web app

```powershell
cd apps\web
pnpm install
pnpm dev
```

Set `VITE_API_BASE_URL=http://localhost:8010` when the API is not served from
the same origin.

The API loads `.env` from the OutreachAgent directory at startup. Restart
the API after changing any secret; running processes do not reload environment
variables automatically.

## Configure internal API authentication

Generate a token locally and place it in the API and Trigger.dev environments:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

```env
INTERNAL_API_TOKEN=<the-generated-value>
```

The Trigger.dev task client sends the same value as a Bearer token. Do not
create a public token-generation endpoint and do not expose this value to the
React app. The API returns `401` for an invalid token and `503` if the API is
started without its required token configuration.

## API checks

```powershell
cd services\agent-api
python -m pytest
```

## Bulk Excel send

- `POST /api/v1/outreach/bulk/parse` — multipart upload of a `.xlsx`
  workbook; returns the parsed recipient directory, the row-1 column mapping,
  skipped rows with reasons, counts, and (when templates are supplied) the
  personalized subject/body rendered for each row. Rejects files with more
  than 50 recipient rows or without a recognizable email column.
- `POST /api/v1/outreach/bulk` — parses the workbook and executes the run
  with the same dry-run, approval, and Gmail connection gates as the
  single-recipient endpoints; returns a per-recipient delivery directory with
  the email each person received.

Column headers are matched flexibly: `Email`, `E-Mail Address`, and `mail`
all resolve to the email column; `Author Name`, `Full Name`, and `Contact`
resolve to the name column (a name is derived from the email address when no
name column exists). Any other header (`Company`, `Campaign City`, ...) stays
available as a `{{token}}`.

Optional `subject_template` / `body_template` form fields turn the run into a
templated send: `{{tokens}}` (row values plus `objective`, `sender_name`,
`sender_signature`, `first_name`) are substituted per recipient, empty values
are removed cleanly, and the exact rendered text is what gets sent. Without a
body template the existing Sarvam drafting flow is used.

With `ai_draft=true` (and no body template), Sarvam writes a unique
personalized email for every row from the objective, tone, language, and that
row's parsed fields. Drafts are cached on a hash of all inputs, so the parse
preview and the run return the exact same text — what the user reviewed is
what gets sent. Row-level drafting failures are reported as warnings and fall
back to the standard send-time drafting.

## Configure live email

Copy `.env.example` into the service environment and set:

- `SARVAM_API_KEY` and optional `SARVAM_LLM_MODEL` for email drafting. The
  tested email-drafting default is `glm5.3-flash` through Sarvam V2.
- Google OAuth client credentials for the Gmail connection flow.

The live request must set `dry_run=false`. If `require_approval=true`, it must
also set `approval_granted=true` from a real approval decision. The API does
not treat a generated draft as delivered: Brevo first returns `submitted`, and
the provider webhook must later reconcile delivery or bounce state.

Gmail consent, OAuth scopes, consent/suppression checks, and production rate
limits must be configured before sending real outreach.

For per-user sending, the UI also collects a sender name, verified sender
email, and optional signature. The sender identity is never taken from the
recipient fields. Browser live sending requires a selected `connection_id`; the
API verifies that it belongs to the tenant and that the request sender matches
the connected identity.

## Connect a user's email account

The API exposes an OAuth connection-start and callback route for Gmail. The
user authorizes Gmail in its own consent screen; the API does not accept the
user's password or API key.

Development uses `outreach.local.db` (override with `OUTREACH_STORE_PATH`) for
sessions, Gmail connections, agent drafts/published state, run logs, and audit
events. Gmail access and refresh tokens are encrypted with
`OUTREACH_TOKEN_ENCRYPTION_KEY` (a Fernet key); set this explicitly in deployed
environments. Sessions use an HttpOnly cookie and expire one hour after
creation. The PostgreSQL migration in `database/001_initial.sql` is the
production schema target; deploy it and replace the local store with the
marketplace database repository before enabling multiple application workers.
