-- PostgreSQL schema for the Competitor Agent.
-- One row per idea analysis; competitor + search evidence are stored separately
-- so they stay queryable instead of only living inside the result JSON blob.

CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY,
  idea TEXT NOT NULL,
  audience TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  stage TEXT NOT NULL DEFAULT 'queued',
  result JSONB,
  error TEXT,
  model TEXT,
  search_provider TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses (status, created_at DESC);

CREATE TABLE IF NOT EXISTS competitors (
  id UUID PRIMARY KEY,
  analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  website TEXT,
  one_liner TEXT,
  what_they_do TEXT,
  how_they_do_it TEXT,
  pricing_model TEXT,
  target_users TEXT,
  threat_level TEXT,
  strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  weaknesses JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitors_analysis ON competitors (analysis_id, position);

-- Audit trail of every web search the crew ran while producing an analysis.
CREATE TABLE IF NOT EXISTS search_queries (
  id BIGSERIAL PRIMARY KEY,
  analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  provider TEXT,
  result_count INTEGER NOT NULL DEFAULT 0,
  ok BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_queries_analysis ON search_queries (analysis_id);
