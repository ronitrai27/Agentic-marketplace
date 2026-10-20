-- CodeReviewAgent initial schema
-- Runs automatically on first boot of the Docker Postgres container.

CREATE TABLE IF NOT EXISTS reviews (
    id           SERIAL PRIMARY KEY,
    mode         TEXT NOT NULL CHECK (mode IN ('paste', 'upload', 'repo')),
    language     TEXT,
    context      TEXT,
    repo_url     TEXT,
    file_count   INTEGER NOT NULL DEFAULT 0,
    overall_score INTEGER NOT NULL DEFAULT 0,
    verdict      TEXT NOT NULL,
    summary      TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_files (
    id        SERIAL PRIMARY KEY,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    filename  TEXT NOT NULL,
    language  TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    content   TEXT
);

CREATE TABLE IF NOT EXISTS review_issues (
    id      SERIAL PRIMARY KEY,
    review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    severity TEXT NOT NULL,
    category TEXT NOT NULL,
    file    TEXT,
    line    INTEGER,
    title   TEXT NOT NULL,
    description TEXT NOT NULL,
    suggestion TEXT,
    code_snippet TEXT
);

CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_files_review ON review_files (review_id);
CREATE INDEX IF NOT EXISTS idx_review_issues_review ON review_issues (review_id);
