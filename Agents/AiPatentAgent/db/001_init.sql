-- =====================================================================
-- AI Patent & Prior-Art Research Agent — initial schema
-- PostgreSQL 16 + pgvector. Auto-run by Docker on first boot.
-- Roles: patent_migrator (owner) · patent_app (API, RLS) · patent_ops (worker, BYPASSRLS)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector (superuser, before SET ROLE)

DO $$ BEGIN CREATE ROLE patent_migrator LOGIN PASSWORD 'patent_migrator_pw';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE patent_app LOGIN PASSWORD 'patent_app_pw';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE patent_ops LOGIN PASSWORD 'patent_ops_pw' BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT CONNECT ON DATABASE patent_agent TO patent_app, patent_ops;
GRANT USAGE ON SCHEMA public TO patent_app, patent_ops;
GRANT CREATE, USAGE ON SCHEMA public TO patent_migrator;   -- PG15+: public schema no longer grants CREATE to all

SET ROLE patent_migrator;

-- ── Enums ────────────────────────────────────────────────────────────
CREATE TYPE analysis_status AS ENUM
  ('queued','ingesting','retrieving','charting','scoring','complete','failed');
CREATE TYPE claim_type      AS ENUM ('independent','dependent');
CREATE TYPE reference_kind  AS ENUM ('patent','npl','web');
CREATE TYPE match_type      AS ENUM ('disclosed','partial','not_found');
CREATE TYPE verdict_type    AS ENUM ('clear','lack_of_inventive_step','lack_of_novelty','partial_overlap');
CREATE TYPE billing_mode    AS ENUM ('runtime','tier');
CREATE TYPE billing_state   AS ENUM
  ('pending','authorized','captured','partial_captured','voided','expired');
CREATE TYPE agent_role      AS ENUM ('ari','scout','clerk','cartographer','examiner');

-- ── Tenants & auth ───────────────────────────────────────────────────
CREATE TABLE tenants (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL DEFAULT 'default',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

-- ── Published agent listing (one dev → N buyers) ─────────────────────
CREATE TABLE agent_listings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT NOT NULL UNIQUE,
  developer         TEXT NOT NULL,
  pricing_mode      billing_mode NOT NULL DEFAULT 'runtime',
  runtime_rate      NUMERIC(8,4),
  min_run_fee       NUMERIC(8,2) DEFAULT 0.10,
  max_run_fee       NUMERIC(8,2) DEFAULT 1.50,
  tenant_daily_cap  NUMERIC(8,2) DEFAULT 20.00,
  tiers             JSONB,
  paypal_payout_email TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Analyses (one row per run) ───────────────────────────────────────
CREATE TABLE analyses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  listing_id     UUID REFERENCES agent_listings(id),
  run_id         TEXT UNIQUE,
  revision       INT NOT NULL DEFAULT 1,
  parent_id      UUID REFERENCES analyses(id) ON DELETE CASCADE,
  status         analysis_status NOT NULL DEFAULT 'queued',
  stage          TEXT,
  input_kind     TEXT,
  input_name     TEXT,
  draft_hash     TEXT NOT NULL,
  draft_chars    INT,
  draft_text     TEXT,                        -- run-lifetime only: purged when status=complete|failed (confidentiality, DATABASE §4)
  novelty_score  INT CHECK (novelty_score BETWEEN 0 AND 100),
  verdict        verdict_type,
  result         JSONB,
  error          JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ
);
CREATE INDEX idx_analyses_tenant     ON analyses (tenant_id, created_at DESC);
CREATE INDEX idx_analyses_status     ON analyses (status) WHERE status NOT IN ('complete','failed');
CREATE INDEX idx_analyses_result_gin ON analyses USING gin (result jsonb_path_ops);
CREATE INDEX idx_analyses_parent     ON analyses (parent_id);

-- ── Claims & elements ────────────────────────────────────────────────
CREATE TABLE claims (
  id           BIGSERIAL PRIMARY KEY,
  analysis_id  UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  claim_no     INT NOT NULL,
  type         claim_type NOT NULL,
  provisional  BOOLEAN NOT NULL DEFAULT false,
  text         TEXT NOT NULL,
  source_map   JSONB,
  UNIQUE (analysis_id, claim_no)
);

CREATE TABLE claim_elements (
  id          BIGSERIAL PRIMARY KEY,
  claim_id    BIGINT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  element_no  INT NOT NULL,
  text        TEXT NOT NULL,
  weight      NUMERIC(3,2) NOT NULL DEFAULT 1.00,
  UNIQUE (claim_id, element_no)
);

-- ── References (prior-art candidates) ────────────────────────────────
CREATE TABLE references_ (
  id                 BIGSERIAL PRIMARY KEY,
  analysis_id        UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  publication_number TEXT,
  family_id          TEXT,
  kind               reference_kind NOT NULL,
  office             TEXT,
  title              TEXT,
  assignee           TEXT,
  cpc                TEXT,
  priority_date      DATE,
  publication_date   DATE,
  url                TEXT NOT NULL,
  rank_score         NUMERIC(5,3),
  rank_breakdown     JSONB,
  selected           BOOLEAN NOT NULL DEFAULT false,
  snippet            TEXT,                          -- ≤6k chars text actually sent to the chart step
  source             TEXT                           -- connector provenance (arxiv, uspto-odp, epo-ops, bigquery, tinyfish) — F9
);
CREATE INDEX idx_refs_analysis ON references_ (analysis_id, rank_score DESC);
CREATE UNIQUE INDEX uq_refs_pubnum ON references_ (analysis_id, publication_number);

-- ── Claim chart (element × reference) ────────────────────────────────
CREATE TABLE claim_matches (
  id           BIGSERIAL PRIMARY KEY,
  analysis_id  UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  claim_id     BIGINT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  element_id   BIGINT NOT NULL REFERENCES claim_elements(id) ON DELETE CASCADE,
  reference_id BIGINT NOT NULL REFERENCES references_(id) ON DELETE CASCADE,
  match        match_type NOT NULL,
  quote        TEXT,
  locator      TEXT,
  commentary   TEXT,
  UNIQUE (element_id, reference_id)
);
CREATE INDEX idx_matches_analysis ON claim_matches (analysis_id, match);

-- ── Team Rail (persisted agent-to-agent messages) ────────────────────
CREATE TABLE agent_messages (
  id           BIGSERIAL PRIMARY KEY,
  analysis_id  UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  seq          INT NOT NULL,
  from_agent   agent_role NOT NULL,
  to_agent     agent_role NOT NULL,
  template_id  TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, seq)
);

-- ── Embeddings ───────────────────────────────────────────────────────
CREATE TABLE embeddings (
  id           BIGSERIAL PRIMARY KEY,
  scope        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  ref_key      TEXT,
  content      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding    vector(384) NOT NULL,   -- budget mode (bge-small / hash 384-d); paid: 1536
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (content_hash, kind)
);
CREATE INDEX idx_emb_scope  ON embeddings (scope, kind);
CREATE INDEX idx_emb_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── Caches (immutable facts only) ────────────────────────────────────
CREATE TABLE publication_cache (
  publication_number TEXT PRIMARY KEY,
  payload            JSONB NOT NULL,
  source             TEXT NOT NULL,
  fetched_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days'
);

CREATE TABLE draft_cache (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  draft_hash  TEXT NOT NULL,
  analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '30 days',
  PRIMARY KEY (tenant_id, draft_hash)
);

-- ── Billing & telemetry ──────────────────────────────────────────────
CREATE TABLE billing_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id      UUID NOT NULL UNIQUE REFERENCES analyses(id) ON DELETE CASCADE,
  run_id           TEXT NOT NULL,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mode             billing_mode NOT NULL,
  rate             NUMERIC(8,4),
  tier_name        TEXT,
  billable_seconds INT NOT NULL DEFAULT 0,
  price            NUMERIC(8,2),
  currency         TEXT NOT NULL DEFAULT 'USD',
  state            billing_state NOT NULL DEFAULT 'pending',
  paypal_auth_id   TEXT,
  paypal_capture_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_billing_state ON billing_records (state) WHERE state IN ('pending','authorized');

CREATE TABLE run_costs (
  analysis_id     UUID PRIMARY KEY REFERENCES analyses(id) ON DELETE CASCADE,
  llm_tokens_in   INT NOT NULL DEFAULT 0,
  llm_tokens_out  INT NOT NULL DEFAULT 0,
  bigquery_bytes  BIGINT NOT NULL DEFAULT 0,
  connector_calls JSONB NOT NULL DEFAULT '{}',
  est_cost_usd    NUMERIC(8,4) NOT NULL DEFAULT 0,
  measured_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE paypal_webhook_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- ── v2: CPC watch monitors ───────────────────────────────────────────
CREATE TABLE watch_monitors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cpc_class     TEXT,
  assignee      TEXT,
  keywords      TEXT[],
  schedule_cron TEXT NOT NULL DEFAULT '0 9 * * 1',
  last_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Views (developer economics) ──────────────────────────────────────
CREATE VIEW v_run_economics AS
SELECT a.id, a.tenant_id, a.created_at, a.novelty_score, a.verdict,
       b.price, b.billable_seconds, b.state AS billing_state,
       c.est_cost_usd, b.price - c.est_cost_usd AS margin_usd
FROM analyses a
LEFT JOIN billing_records b ON b.analysis_id = a.id
LEFT JOIN run_costs      c ON c.analysis_id = a.id
WHERE a.status = 'complete';

CREATE VIEW v_tenant_usage AS
SELECT tenant_id,
       count(*)               AS runs_30d,
       sum(billable_seconds)  AS seconds_30d,
       sum(price)             AS spend_30d,
       max(created_at)        AS last_run_at
FROM billing_records
WHERE created_at > now() - INTERVAL '30 days'
GROUP BY tenant_id;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_billing_touch BEFORE UPDATE ON billing_records
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── RLS (patent_app is tenant-scoped; patent_ops bypasses) ───────────
CREATE FUNCTION app_tenant() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION analysis_tenant(a_id uuid) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT tenant_id FROM analyses WHERE id = a_id $$;

ALTER TABLE tenants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys        ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_cache     ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE watch_monitors  ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims          ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_elements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE references_     ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_matches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_costs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_listings  ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_tenants ON tenants USING (id = app_tenant());
CREATE POLICY p_api_keys ON api_keys USING (tenant_id = app_tenant());
CREATE POLICY p_listings ON agent_listings USING (true);
CREATE POLICY p_analyses ON analyses
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE POLICY p_draft_cache ON draft_cache USING (tenant_id = app_tenant());
CREATE POLICY p_billing ON billing_records USING (tenant_id = app_tenant());
CREATE POLICY p_monitors ON watch_monitors USING (tenant_id = app_tenant());
CREATE POLICY p_claims ON claims USING (analysis_tenant(analysis_id) = app_tenant());
CREATE POLICY p_elements ON claim_elements USING
  (analysis_tenant((SELECT analysis_id FROM claims WHERE id = claim_id)) = app_tenant());
CREATE POLICY p_refs ON references_ USING (analysis_tenant(analysis_id) = app_tenant());
CREATE POLICY p_matches ON claim_matches USING (analysis_tenant(analysis_id) = app_tenant());
CREATE POLICY p_messages ON agent_messages USING (analysis_tenant(analysis_id) = app_tenant());
CREATE POLICY p_costs ON run_costs USING (analysis_tenant(analysis_id) = app_tenant());

-- publication_cache / embeddings / paypal_webhook_events: shared by design (no RLS)

-- ── Grants ───────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO patent_app, patent_ops;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO patent_app, patent_ops;
GRANT SELECT ON v_run_economics, v_tenant_usage TO patent_app, patent_ops;

RESET ROLE;

-- ── Seed (dev) ───────────────────────────────────────────────────────
INSERT INTO tenants (id, name)
VALUES ('11111111-1111-1111-1111-111111111111', 'demo-buyer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_listings (slug, developer, pricing_mode, runtime_rate,
                            min_run_fee, max_run_fee, tenant_daily_cap, tiers, paypal_payout_email)
VALUES ('ai-patent-agent', 'demo-dev', 'runtime', 0.04, 0.10, 1.50, 20.00,
        '[{"name":"Lite","price":0.10,"caps":{"claims":4,"refs":5}},
          {"name":"Standard","price":0.25,"caps":{"claims":10,"refs":10}},
          {"name":"Deep","price":0.60,"caps":{"claims":20,"refs":20}}]',
        'dev@example.com')
ON CONFLICT (slug) DO NOTHING;
