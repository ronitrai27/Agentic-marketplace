import pg from "pg";

/**
 * Search index in the same Postgres the chef checkpoints into: pgvector for meaning, pg_trgm for typos and
 * partial names, tsvector for words. Convex stays the source of truth: the index only decides WHICH agents
 * match, and every result is re-read from Convex before anyone sees it (see agent-search.ts).
 */
const g = globalThis as unknown as { __searchPool?: pg.Pool; __searchReady?: Promise<void> };

export function searchPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("SEARCH_NOT_CONFIGURED");
  // one pool per server process, kept across dev hot reloads
  // connectionTimeoutMillis: an unreachable database fails after 6s instead of hanging for a minute
  g.__searchPool ??= new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 6_000 });
  return g.__searchPool;
}

/** Word index: what the agent does (description, capabilities, tags) outweighs its name. */
const FTS_EXPR = `
  setweight(to_tsvector('english', description), 'B') ||
  setweight(to_tsvector('english', capabilities), 'B') ||
  setweight(to_tsvector('english', tag_text), 'B') ||
  setweight(to_tsvector('english', name), 'C')`;

/** text-embedding-3-small */
export const EMBED_DIMS = 1536;

/** Creates the extensions, table and indexes once per process (idempotent). */
export function ensureSearchSchema(): Promise<void> {
  g.__searchReady ??= (async () => {
    const db = searchPool();
    await db.query("create extension if not exists vector");
    await db.query("create extension if not exists pg_trgm");
    await db.query(`
      create table if not exists agent_search (
        agent_id     text primary key,
        slug         text not null,
        name         text not null,
        name_norm    text not null,
        description  text not null,
        tag_text     text not null default '',
        capabilities text not null default '',
        tags         text[] not null default '{}',
        content_hash text not null,
        embedding    vector(${EMBED_DIMS}),
        fts          tsvector generated always as (${FTS_EXPR}) stored,
        updated_at   timestamptz not null default now()
      )`);
    // a table made before capabilities were indexed: add the column and rebuild the word index with it
    const has = await db.query(
      "select 1 from information_schema.columns where table_name = 'agent_search' and column_name = 'capabilities'",
    );
    if (has.rowCount === 0) {
      await db.query("drop index if exists agent_search_fts");
      await db.query("alter table agent_search drop column fts");
      await db.query("alter table agent_search add column capabilities text not null default ''");
      await db.query(`alter table agent_search add column fts tsvector generated always as (${FTS_EXPR}) stored`);
      await db.query("update agent_search set content_hash = ''"); // the next reconcile re-embeds with capabilities
    }
    // The chef's task search embeds description + capabilities + tag labels (no name) in its own column, so the
    // search bar's `embedding` stays exactly as it is. A table without it re-embeds every agent on the next reconcile.
    const hasTask = await db.query(
      "select 1 from information_schema.columns where table_name = 'agent_search' and column_name = 'task_embedding'",
    );
    if (hasTask.rowCount === 0) {
      await db.query(`alter table agent_search add column if not exists task_embedding vector(${EMBED_DIMS})`);
      await db.query("update agent_search set content_hash = ''");
    }
    await db.query("create index if not exists agent_search_task_vec on agent_search using hnsw (task_embedding vector_cosine_ops)");
    await db.query("create index if not exists agent_search_fts on agent_search using gin (fts)");
    await db.query("create index if not exists agent_search_name_trgm on agent_search using gin (name_norm gin_trgm_ops)");
    await db.query("create index if not exists agent_search_tags on agent_search using gin (tags)");
    await db.query("create index if not exists agent_search_vec on agent_search using hnsw (embedding vector_cosine_ops)");
  })().catch((e) => {
    g.__searchReady = undefined; // try again on the next request
    throw e;
  });
  return g.__searchReady;
}
