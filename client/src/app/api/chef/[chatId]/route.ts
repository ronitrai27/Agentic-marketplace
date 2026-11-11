import { after } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { HumanMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { PendingProposal } from "@/chef/state";
import { z } from "zod";
import { chefAuth, chefRateLimit } from "@/chef/gate";
import { getChefGraph } from "@/chef/graph";
import { REFUSAL_TEXT } from "@/chef/guard/node";
import { ChatOutbox } from "@/chef/outbox";
import { chefRequest, createGuardGate } from "@/chef/tools/context";

export const maxDuration = 300;

const TextBody = z.object({
  messageId: z.string().uuid(),
  text: z.string().trim().min(1).max(4000),
});
/** The human's answer to a run approval card (HITL). Approved runs were already held by the browser. */
const ResumeBody = z.object({
  resume: z.object({
    proposalId: z.string().uuid(),
    decision: z.enum(["approved", "denied", "expired", "failed"]),
    runIds: z.array(z.string().min(1).max(64)).max(2).default([]),
    reason: z.string().trim().max(300).optional(),
  }),
});
const Body = z.union([TextBody, ResumeBody]);

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export async function POST(req: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const { chatId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!z.string().uuid().safeParse(chatId).success || !parsed.success) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const isResume = "resume" in parsed.data;
  const messageId = "resume" in parsed.data ? crypto.randomUUID() : parsed.data.messageId;
  const text = "resume" in parsed.data ? "" : parsed.data.text;

  // build/open the graph while the session token is being fetched: neither waits for the other
  const graphPromise = getChefGraph();
  graphPromise.catch(() => {}); // a failure is reported inside the stream below
  const gate = await chefAuth();
  const tAuth = ms();
  if (!gate.ok) return gate.response;
  const { token, userId } = gate;
  // 5 new questions per minute per user; answering an approval card is not a question
  if (!isResume) {
    const limited = await chefRateLimit(userId);
    if (limited) return limited;
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(token);
  const outbox = new ChatOutbox(convex, chatId, text.slice(0, 60) || "New chat");
  const threadConfig = { configurable: { thread_id: `${userId}:${chatId}` } };

  // HITL: a run approval this thread is paused on, if any
  let graph: Awaited<ReturnType<typeof getChefGraph>>;
  try {
    graph = await graphPromise;
  } catch (e) {
    console.error("[chef] graph unavailable:", e);
    return Response.json({ error: "Chef is unavailable" }, { status: 503 });
  }
  const snap = await graph.getState(threadConfig);
  const pending =
    (snap.values as { proposal?: PendingProposal | null })?.proposal &&
    snap.tasks?.some((t) => (t.interrupts?.length ?? 0) > 0)
      ? ((snap.values as { proposal: PendingProposal }).proposal)
      : null;

  /** The answer the graph resumes with, settled in Convex first (approval re-checked against its expiry). */
  let resume: { proposalId: string; decision: "approved" | "denied" | "expired" | "failed"; runIds: string[]; reason?: string } | null = null;
  if ("resume" in parsed.data) {
    const r = parsed.data.resume;
    if (!pending || pending.proposalId !== r.proposalId) return Response.json({ error: "Nothing is waiting for approval" }, { status: 409 });
    try {
      const { status } = await convex.mutation(api.chatRuns.decide, {
        proposalId: r.proposalId,
        // Convex has no "failed" state: a failed start closes the card as denied, nothing held
        decision: r.decision === "failed" ? "denied" : r.decision,
        runIds: r.runIds as Id<"runs">[],
      });
      resume = {
        proposalId: r.proposalId,
        decision: r.decision === "failed" && status === "denied" ? "failed" : status,
        runIds: status === "approved" ? r.runIds : [],
        ...(r.decision === "failed" && status === "denied" ? { reason: r.reason ?? "the run could not be started" } : {}),
      };
      // approved too late: give the holds the browser just made straight back
      if (r.decision === "approved" && status !== "approved") {
        await Promise.all(r.runIds.map((id) => convex.mutation(api.runs.cancelAwaiting, { runId: id as Id<"runs"> }).catch(() => {})));
      }
    } catch (e) {
      console.error("[chef] decide failed:", e);
      return Response.json({ error: e instanceof Error ? e.message : "Could not record the decision" }, { status: 400 });
    }
  } else if (pending) {
    // A new question while an approval is open: refused, unless the approval has already expired
    if (Date.now() <= pending.expiresAt) {
      return Response.json({ error: "Approve or deny the agent run first.", code: "PENDING_APPROVAL" }, { status: 409 });
    }
    await convex.mutation(api.chatRuns.decide, { proposalId: pending.proposalId, decision: "expired" }).catch(() => {});
  }
  const staleProposal = !isResume && pending ? pending : null;

  // 1. Save the user's message in the background. Nothing below waits for it.
  if (!isResume) outbox.push({ messageId, role: "user", kind: "text", text, createdAt: Date.now() });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(sse(event, data)));
      // tools read the user's Convex client and what they typed from here, never from the model
      chefRequest.enterWith({
        convex,
        chatId,
        lastUserText: text,
        gate: createGuardGate(),
        // tools may warn the user while they wait (e.g. a slow database); a closed stream is ignored
        notify: (event, data) => {
          try {
            send(event, data);
          } catch {
            /* stream already closed */
          }
        },
      });
      /** The fixed reply the hitl node wrote, out to the browser and to Convex. */
      const sendHitl = (update: { messages?: Array<{ type?: string; content?: unknown }> }) => {
        const reply = update.messages?.filter((m) => m.type === "ai").at(-1)?.content;
        if (typeof reply !== "string" || !reply) return;
        const id = crypto.randomUUID();
        const at = Date.now();
        send("message", { id, role: "assistant", kind: "text", text: reply, createdAt: at });
        outbox.push({ messageId: id, role: "assistant", kind: "text", text: reply, createdAt: at });
      };
      try {
        if (resume) {
          // 2'. HITL answer: resume the paused graph; only the hitl node runs
          const run = await graph.stream(new Command({ resume }), { ...threadConfig, streamMode: "updates", durability: "async" });
          for await (const update of run) {
            const u = update as Record<string, any>;
            if (u.hitl) sendHitl(u.hitl);
          }
          send("done", {});
          return;
        }
        if (staleProposal) {
          // the open approval ran out: close it in the thread before this new question
          const run = await graph.stream(
            new Command({ resume: { proposalId: staleProposal.proposalId, decision: "expired", runIds: [] } }),
            { ...threadConfig, streamMode: "updates", durability: "async" },
          );
          for await (const update of run) {
            const u = update as Record<string, any>;
            if (u.hitl) sendHitl(u.hitl);
          }
        }

        // 2. The guard starts at once; the browser sees "Checking query" before any network work is done.
        send("trace", { id: "check", label: "Checking query", status: "running" });

        const tGraph = ms();
        let tGuard = 0;
        let tFirstToken = 0;
        const replyId = crypto.randomUUID();
        // The instant model starts together with the guard. Its tokens are held until the verdict is in:
        // dropped if the turn is refused or is a task, released if it is chit-chat.
        let path: "pending" | "instant" | "dropped" = "pending";
        let held = "";
        let refused = false;

        const run = await graph.stream(
          { messages: [new HumanMessage({ content: text, id: messageId })], chatId, userId },
          // threads are namespaced by user, so a guessed chat id can never reach someone else's state
          { ...threadConfig, streamMode: ["updates", "messages", "custom"], durability: "async" },
        );

        for await (const chunk of run) {
          const [mode, data] = chunk as [string, any];

          if (mode === "custom") {
            // live events from the heavy model: reasoning, tool runs, the agent picker, answer tokens
            const { t, ...rest } = data as { t: string } & Record<string, unknown>;
            if (t === "token") send("token", { id: replyId, text: rest.text });
            else send(t, rest);
            continue;
          }

          if (mode === "messages") {
            const [msg, meta] = data;
            if (meta?.langgraph_node !== "instant" || msg?.type !== "ai") continue;
            const t = typeof msg.content === "string" ? msg.content : "";
            if (!t) continue;
            if (!tFirstToken) tFirstToken = ms();
            if (path === "instant") send("token", { id: replyId, text: t });
            else if (path === "pending") held += t;
            continue;
          }

          const update = data as Record<string, any>;
          if (update.guard) {
            tGuard = ms();
            send("trace", { id: "check", label: "Checking query", status: "done" });
            if (update.guard.blocked) {
              // Refused: the fixed reply goes to the browser and to Convex immediately; the held draft is discarded.
              path = "dropped";
              refused = true;
              held = "";
              const refusalId = crypto.randomUUID();
              const refusalMs = ms();
              send("message", { id: refusalId, role: "assistant", kind: "refusal", text: REFUSAL_TEXT, durationMs: refusalMs, createdAt: Date.now() });
              outbox.push({ messageId: refusalId, role: "assistant", kind: "refusal", text: REFUSAL_TEXT, durationMs: refusalMs, createdAt: Date.now() });
            } else if (update.guard.modelKind === "instant") {
              path = "instant";
              if (held) send("token", { id: replyId, text: held });
              held = "";
            } else {
              path = "dropped";
              held = "";
              send("trace", { id: "intent", label: "Understanding intent", status: "running" });
            }
          }

          if (update.heavy) {
            const msgs = update.heavy.messages as Array<{ type?: string; content?: unknown; tool_calls?: unknown[] }> | undefined;
            const last = msgs?.filter((m) => m.type === "ai" && !(m.tool_calls?.length)).at(-1);
            const reply = typeof last?.content === "string" ? last.content : "";
            if (reply) {
              const replyMs = ms();
              send("message", { id: replyId, role: "assistant", kind: "text", text: reply, durationMs: replyMs, createdAt: Date.now() });
              outbox.push({ messageId: replyId, role: "assistant", kind: "text", text: reply, durationMs: replyMs, createdAt: Date.now() });
            }
          }

          if (update.finalize) {
            if (path === "instant") {
              const reply = update.finalize.messages?.[0]?.content;
              if (typeof reply === "string" && reply) {
                const replyMs = ms();
                send("message", { id: replyId, role: "assistant", kind: "text", text: reply, durationMs: replyMs, createdAt: Date.now() });
                outbox.push({ messageId: replyId, role: "assistant", kind: "text", text: reply, durationMs: replyMs, createdAt: Date.now() });
              }
            } else if (!refused) {
              send("trace", { id: "intent", label: "Understanding intent", status: "done" });
            }
          }
        }
        send("done", {});
        console.log(`[chef:latency] chat=${chatId} auth=${tAuth}ms graphReady=${tGraph - tAuth}ms guardDone@${tGuard}ms firstToken@${tFirstToken}ms streamEnd@${ms()}ms`);
      } catch (e) {
        console.error("[chef] turn failed:", e);
        send("error", { message: "Something went wrong. Please try again." });
      } finally {
        controller.close();
      }
    },
  });

  // Flush whatever is still queued after the response has gone out.
  after(() => outbox.idle());

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
