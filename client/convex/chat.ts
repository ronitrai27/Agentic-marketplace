import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";

const MAX_TEXT = 20_000;
const MAX_BATCH = 50;

const messageArg = v.object({
  messageId: v.string(),
  role: v.union(v.literal("user"), v.literal("assistant")),
  kind: v.union(v.literal("text"), v.literal("refusal")),
  text: v.string(),
  durationMs: v.optional(v.number()),
  createdAt: v.number(),
  ord: v.number(),
});

/**
 * Called by the chef service's background outbox, as the signed-in user. Creates the chat on first write and
 * stores each message once (keyed by messageId), so retries are safe.
 */
export const appendBatch = mutation({
  args: { chatId: v.string(), title: v.optional(v.string()), messages: v.array(messageArg) },
  handler: async (ctx, { chatId, title, messages }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in first." });
    if (messages.length > MAX_BATCH) throw new ConvexError({ code: "TOO_MANY", message: "Batch too large." });
    const userId = identity.subject;

    let chat = await ctx.db
      .query("chats")
      .withIndex("by_chatId", (q) => q.eq("chatId", chatId))
      .first();
    if (chat && chat.userId !== userId) throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found." });

    const now = Date.now();
    const last = messages.reduce((m, x) => Math.max(m, x.createdAt), 0) || now;
    if (!chat) {
      const id = await ctx.db.insert("chats", {
        chatId,
        userId,
        title: (title ?? "New chat").slice(0, 80),
        createdAt: now,
        lastMessageAt: last,
      });
      chat = (await ctx.db.get(id))!;
    } else {
      await ctx.db.patch(chat._id, { lastMessageAt: Math.max(chat.lastMessageAt, last) });
    }

    let stored = 0;
    for (const m of messages) {
      const dup = await ctx.db
        .query("chat_messages")
        .withIndex("by_chat_message", (q) => q.eq("chatId", chatId).eq("messageId", m.messageId))
        .first();
      if (dup) continue;
      await ctx.db.insert("chat_messages", { chatId, userId, ...m, text: m.text.slice(0, MAX_TEXT) });
      stored++;
    }
    return { stored };
  },
});

/** The chat's messages in order. Empty for someone else's chat. */
export const messages = query({
  args: { chatId: v.string() },
  handler: async (ctx, { chatId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("chat_messages")
      .withIndex("by_chat_order", (q) => q.eq("chatId", chatId))
      .order("asc")
      .take(500);
    return rows
      .filter((r) => r.userId === identity.subject)
      .map((r) => ({
        id: r.messageId,
        role: r.role,
        kind: r.kind,
        text: r.text,
        durationMs: r.durationMs,
        createdAt: r.createdAt,
      }));
  },
});

/** The user's recent chats, newest first. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("chats")
      .withIndex("by_user_last", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(30);
    return rows.map((c) => ({ chatId: c.chatId, title: c.title, lastMessageAt: c.lastMessageAt }));
  },
});
