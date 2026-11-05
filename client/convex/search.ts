import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { tagById } from "../src/lib/agent-tags";

const COLLECTION = "agents";

function config() {
  const host = process.env.TYPESENSE_HOST;
  const key = process.env.TYPESENSE_ADMIN_KEY;
  if (!host || !key) throw new Error("Set TYPESENSE_HOST and TYPESENSE_ADMIN_KEY in the Convex env.");
  return { base: `https://${host}`, key };
}

async function ts(path: string, init: RequestInit & { body?: string }) {
  const { base, key } = config();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "X-TYPESENSE-API-KEY": key, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Typesense ${res.status}: ${await res.text()}`);
  return res;
}

/** Creates the collection (with built-in embeddings) if it does not exist yet. */
export const ensureCollection = internalAction({
  args: {},
  handler: async () => {
    const { base, key } = config();
    const exists = await fetch(`${base}/collections/${COLLECTION}`, {
      headers: { "X-TYPESENSE-API-KEY": key },
    });
    if (exists.ok) return "exists";
    await ts("/collections", {
      method: "POST",
      body: JSON.stringify({
        name: COLLECTION,
        fields: [
          { name: "name", type: "string" },
          { name: "description", type: "string" },
          { name: "tags", type: "string[]", facet: true },
          { name: "tagText", type: "string" },
          { name: "models", type: "string[]", facet: true },
          { name: "status", type: "string", facet: true },
          { name: "ratingAvg", type: "float" },
          { name: "createdAt", type: "int64" },
          { name: "slug", type: "string", index: false },
          { name: "logoUrl", type: "string", optional: true, index: false },
          {
            name: "embedding",
            type: "float[]",
            embed: {
              from: ["name", "description", "tagText"],
              model_config: { model_name: "ts/all-MiniLM-L12-v2" },
            },
          },
        ],
      }),
    });
    return "created";
  },
});

export const getForSync = internalQuery({
  args: { agentId: v.id("agents") },
  handler: (ctx, { agentId }) => ctx.db.get(agentId),
});

export const listIds = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("agents").collect()).map((a) => a._id),
});

/** Pushes one agent into the search index. Paused/archived agents stay indexed but are filtered out of search. */
export const syncAgent = internalAction({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }): Promise<void> => {
    const a: Doc<"agents"> | null = await ctx.runQuery(internal.search.getForSync, { agentId });
    if (!a) return;
    // Searchable words per tag: its label plus the keywords people use for it
    const tagText = a.tags
      .map((id: string) => {
        const t = tagById(id);
        return t ? [t.label, ...t.keywords].join(" ") : id;
      })
      .join(" ");
    await ts(`/collections/${COLLECTION}/documents?action=upsert`, {
      method: "POST",
      body: JSON.stringify({
        id: a._id,
        slug: a.slug,
        name: a.name,
        description: a.description,
        logoUrl: a.logoUrl,
        tags: a.tags,
        tagText,
        models: a.models.map((m: { id: string }) => m.id),
        status: a.status,
        ratingAvg: a.ratingAvg ?? 0,
        createdAt: a.createdAt,
      }),
    });
  },
});

/** One-off / nightly: `npx convex run search:backfill`. */
export const backfill = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    await ctx.runAction(internal.search.ensureCollection, {});
    const ids: Id<"agents">[] = await ctx.runQuery(internal.search.listIds, {});
    for (const agentId of ids) await ctx.runAction(internal.search.syncAgent, { agentId });
    return ids.length;
  },
});
