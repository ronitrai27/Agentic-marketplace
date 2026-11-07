import { createHash } from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { tagById } from "@/lib/agent-tags";
import { ensureSearchSchema, searchPool } from "./db";
import { embedDocuments, toVector } from "./embed";
import { clearSearchCache } from "./query";

type IndexRow = { id: string; slug: string; name: string; description: string; tags: string[]; capabilities: string[] };

const normName = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Searchable words per tag: its label plus the keywords people use for it. */
const tagText = (tags: string[]) =>
  tags
    .map((id) => {
      const t = tagById(id);
      return t ? [t.label, ...t.keywords].join(" ") : id;
    })
    .join(" ");

/** Only a change in what is searched triggers a new embedding (ratings and run counts never do). */
const hashOf = (r: IndexRow) =>
  createHash("sha1").update(`${r.slug}\n${r.name}\n${r.description}\n${r.capabilities.join("|")}\n${[...r.tags].sort().join(",")}`).digest("hex");

const EVERY_MS = 30_000;
const BATCH = 64;
const LOCK = 727_002; // arbitrary key: one reconcile at a time across all server instances

let last = 0;
let inflight: Promise<void> | null = null;

/**
 * Brings the index in line with Convex: new and edited agents are embedded and upserted; agents that are gone,
 * archived or suspended are removed. Safe to call often (throttled, one run at a time, the same edit never
 * embedded twice). Convex is the only writer of truth, so nothing here can drift for more than a few seconds.
 */
export function reconcileIndex(convex: ConvexHttpClient, force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - last < EVERY_MS) return Promise.resolve();
  inflight = run(convex)
    .then(() => {
      last = Date.now();
    })
    .catch((e) => console.error("[search] reconcile failed:", e instanceof Error ? e.message : e))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** For the first search after a deploy: wait for the index when it is empty, otherwise refresh in the background. */
let known = false; // once the index has rows this process never needs to count again
export async function ensureIndexed(convex: ConvexHttpClient): Promise<void> {
  await ensureSearchSchema();
  if (!known) {
    const { rows } = await searchPool().query("select count(*)::int as n from agent_search");
    if (rows[0].n === 0) {
      await reconcileIndex(convex, true);
      return;
    }
    known = true;
  }
  void reconcileIndex(convex);
}

async function run(convex: ConvexHttpClient) {
  await ensureSearchSchema();
  const started = Date.now();
  const rows = (await convex.query(api.chefAgents.listForIndex, {})) as IndexRow[];
  const db = searchPool();
  const client = await db.connect();
  try {
    // A transaction-scoped lock, not a session one: it is released by commit/rollback even through a connection pooler
    // (a session lock can stay stuck on a pooled connection forever and silently stop every later reconcile).
    await client.query("begin");
    const got = await client.query("select pg_try_advisory_xact_lock($1) as ok", [LOCK]);
    if (!got.rows[0].ok) {
      await client.query("rollback");
      return; // another instance is already doing it
    }

    const have = new Map<string, string>(
      (await client.query("select agent_id, content_hash from agent_search")).rows.map((r) => [r.agent_id, r.content_hash]),
    );
    const live = new Set(rows.map((r) => r.id));
    const gone = [...have.keys()].filter((id) => !live.has(id));
    const changed = rows.filter((r) => have.get(r.id) !== hashOf(r));

    if (gone.length) await client.query("delete from agent_search where agent_id = any($1::text[])", [gone]);

    for (let i = 0; i < changed.length; i += BATCH) {
      const batch = changed.slice(i, i + BATCH);
      const vectors = await embedDocuments(batch.map((r) => `${r.description}. ${r.capabilities.join(". ")}. ${tagText(r.tags)}. ${r.name}`));
      for (let j = 0; j < batch.length; j++) {
        const r = batch[j];
        await client.query(
          `insert into agent_search (agent_id, slug, name, name_norm, description, tag_text, tags, content_hash, embedding, capabilities, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,$10, now())
           on conflict (agent_id) do update set
             slug=excluded.slug, name=excluded.name, name_norm=excluded.name_norm, description=excluded.description,
             tag_text=excluded.tag_text, tags=excluded.tags, content_hash=excluded.content_hash,
             embedding=excluded.embedding, capabilities=excluded.capabilities, updated_at=now()`,
          [r.id, r.slug, r.name, normName(r.name), r.description, tagText(r.tags), r.tags, hashOf(r), toVector(vectors[j]), r.capabilities.join(". ")],
        );
      }
    }
    if (gone.length || changed.length) {
      clearSearchCache();
      console.log(`[search] reconciled: +${changed.length} updated, -${gone.length} removed, ${rows.length} live, ${Date.now() - started}ms`);
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
