import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

/** The user's profile image from the auth component (the JWT identity does not always carry it). */
async function userImage(ctx: unknown, userId: string): Promise<string | undefined> {
  const u = await (ctx as any)
    .runQuery(components.betterAuth.adapter.findOne, { model: "user", where: [{ field: "_id", value: userId }] })
    .catch(() => null);
  return (u?.image as string | null | undefined) || undefined;
}

const MAX_COMMENT = 1000;
/** How many of the buyer's latest runs we look through to find one of this agent. */
const RUN_LOOKBACK = 200;

type Ctx = Pick<QueryCtx, "db">;

async function agentBySlug(ctx: Ctx, slug: string) {
  return ctx.db
    .query("agents")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
}

/** True when the user has a finished run (succeeded or failed) of this agent. */
async function hasRun(ctx: Ctx, userId: string, agentId: Id<"agents">) {
  const rows = await ctx.db
    .query("runs")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .order("desc")
    .take(RUN_LOOKBACK);
  return rows.some((r) => r.agentId === agentId && (r.status === "succeeded" || r.status === "failed"));
}

/** Moves the agent's average and count when a review is added, replaced or removed, then re-syncs search. */
async function applyRating(
  ctx: MutationCtx,
  agent: Doc<"agents">,
  change: { add?: number; remove?: number },
) {
  const count = agent.ratingCount ?? 0;
  const sum = (agent.ratingAvg ?? 0) * count;
  const newCount = Math.max(0, count + (change.add !== undefined ? 1 : 0) - (change.remove !== undefined ? 1 : 0));
  const newSum = sum + (change.add ?? 0) - (change.remove ?? 0);
  const ratingAvg = newCount > 0 ? Math.round((newSum / newCount) * 100) / 100 : 0;
  await ctx.db.patch(agent._id, { ratingAvg, ratingCount: newCount, updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.search.syncAgent, { agentId: agent._id });
}

/** Whether the signed-in user may review this agent, and their existing review if any. */
export const status = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { signedIn: false, canReview: false, isOwner: false, mine: null };
    const agent = await agentBySlug(ctx, slug);
    if (!agent) return { signedIn: true, canReview: false, isOwner: false, mine: null };
    const isOwner = agent.ownerId === identity.subject;
    const canReview = isOwner || (await hasRun(ctx, identity.subject, agent._id));
    const mine = await ctx.db
      .query("agent_reviews")
      .withIndex("by_agent_user", (q) => q.eq("agentId", agent._id).eq("userId", identity.subject))
      .first();
    return {
      signedIn: true,
      canReview,
      isOwner,
      mine: mine ? { id: mine._id as string, rating: mine.rating, comment: mine.comment } : null,
    };
  },
});

/** Newest-first reviews, paged so an agent with hundreds stays cheap. */
export const list = query({
  args: { slug: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { slug, paginationOpts }) => {
    const identity = await ctx.auth.getUserIdentity();
    const agent = await agentBySlug(ctx, slug);
    if (!agent) return { page: [], isDone: true, continueCursor: "" };
    const res = await ctx.db
      .query("agent_reviews")
      .withIndex("by_agent_created", (q) => q.eq("agentId", agent._id))
      .order("desc")
      .paginate(paginationOpts);
    // reviews written before avatars were captured get the user's current image
    const page = await Promise.all(
      res.page.map(async (r) => ({
        id: r._id,
        userName: r.userName,
        userAvatar: r.userAvatar ?? (await userImage(ctx, r.userId)) ?? null,
        rating: r.rating,
        comment: r.comment,
        likes: r.likes ?? 0,
        createdAt: r.createdAt,
        isOwner: r.userId === agent.ownerId,
        isMine: identity?.subject === r.userId,
      })),
    );
    return { ...res, page };
  },
});

/** Creates the caller's review. One review per user per agent: a new one replaces the previous. */
export const create = mutation({
  args: { slug: v.string(), rating: v.number(), comment: v.string() },
  handler: async (ctx, { slug, rating, comment }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to leave a review." });
    if (!Number.isInteger(rating * 2) || rating < 1 || rating > 5)
      throw new ConvexError({ code: "BAD_RATING", message: "Pick a rating from 1 to 5 stars (halves allowed)." });
    const text = comment.trim();
    if (text.length < 1 || text.length > MAX_COMMENT)
      throw new ConvexError({ code: "BAD_COMMENT", message: `Write 1 to ${MAX_COMMENT} characters.` });

    const agent = await agentBySlug(ctx, slug);
    if (!agent || agent.status === "archived" || agent.status === "suspended")
      throw new ConvexError({ code: "NOT_FOUND", message: "Agent not found." });

    const userId = identity.subject;
    const isOwner = agent.ownerId === userId;
    if (!isOwner && !(await hasRun(ctx, userId, agent._id)))
      throw new ConvexError({ code: "NOT_ALLOWED", message: "Run this agent first to review it." });

    const now = Date.now();
    const userName = identity.name || identity.email?.split("@")[0] || "User";
    const userAvatar = identity.pictureUrl || (await userImage(ctx, userId)) || undefined;
    const existing = await ctx.db
      .query("agent_reviews")
      .withIndex("by_agent_user", (q) => q.eq("agentId", agent._id).eq("userId", userId))
      .first();

    // a new review replaces the caller's previous one, so each user counts once in the average
    if (existing) await ctx.db.delete(existing._id);
    {
      await ctx.db.insert("agent_reviews", {
        agentId: agent._id,
        userId,
        userName,
        userAvatar,
        rating,
        comment: text,
        likes: 0,
        createdAt: now,
      });
      await applyRating(ctx, agent, { add: rating, remove: existing?.rating });
    }
    return { slug };
  },
});

/** Deletes the caller's own review only. */
export const remove = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in." });
    const agent = await agentBySlug(ctx, slug);
    if (!agent) throw new ConvexError({ code: "NOT_FOUND", message: "Agent not found." });
    const mine = await ctx.db
      .query("agent_reviews")
      .withIndex("by_agent_user", (q) => q.eq("agentId", agent._id).eq("userId", identity.subject))
      .first();
    if (!mine) throw new ConvexError({ code: "NOT_FOUND", message: "You have no review to delete." });
    await ctx.db.delete(mine._id);
    await applyRating(ctx, agent, { remove: mine.rating });
    return { slug };
  },
});

/** Raises or lowers a review's like counter. Only the counter is kept, so the client remembers what it liked. */
export const like = mutation({
  args: { reviewId: v.id("agent_reviews"), delta: v.union(v.literal(1), v.literal(-1)) },
  handler: async (ctx, { reviewId, delta }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Please sign in to like reviews." });
    const r = await ctx.db.get(reviewId);
    if (!r) return;
    await ctx.db.patch(reviewId, { likes: Math.max(0, (r.likes ?? 0) + delta) });
  },
});
