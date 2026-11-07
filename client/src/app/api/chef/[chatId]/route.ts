import { after } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { getToken } from "@/lib/auth-server";
import { getChefGraph } from "@/chef/graph";
import { REFUSAL_TEXT } from "@/chef/guard/node";
import { ChatOutbox } from "@/chef/outbox";
import { chefRequest } from "@/chef/tools/context";

export const maxDuration = 300;

const Body = z.object({
  messageId: z.string().uuid(),
  text: z.string().trim().min(1).max(4000),
});

/** The user id from the session token. It only namespaces the thread; Convex still verifies the token on every write. */
function subjectOf(jwt: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export async function POST(req: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const { chatId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!z.string().uuid().safeParse(chatId).success || !parsed.success) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const { messageId, text } = parsed.data;

  const token = await getToken();
  const tAuth = ms();
  const userId = token ? subjectOf(token) : null;
  if (!token || !userId) return Response.json({ error: "Sign in first" }, { status: 401 });

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(token);
  const outbox = new ChatOutbox(convex, chatId, text.slice(0, 60));

  // 1. Save the user's message in the background. Nothing below waits for it.
  outbox.push({ messageId, role: "user", kind: "text", text, createdAt: Date.now() });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(sse(event, data)));
      // tools read the user's Convex client and what they typed from here, never from the model
      chefRequest.enterWith({ convex, lastUserText: text });
      try {
        // 2. The guard starts at once; the browser sees "Checking query" before any network work is done.
        send("trace", { id: "check", label: "Checking query", status: "running" });

        const graph = await getChefGraph();
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
          { configurable: { thread_id: `${userId}:${chatId}` }, streamMode: ["updates", "messages", "custom"], durability: "async" },
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
