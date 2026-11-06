"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { Check, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { Spinner } from "@/components/ui/spinner";
import { DotmSquare1 } from "@/components/ui/dotm-square-1";
import { api } from "../../../../convex/_generated/api";

export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "refusal";
  text: string;
  createdAt: number;
  /** Milliseconds the chef took, saved with the reply. */
  durationMs?: number;
};
type Step = { id: string; label: string; status: "running" | "done" };

const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Chat state for one conversation. The list comes from Convex (so a refresh keeps everything); the message just
 * sent and the live trace are held locally until Convex has them, and merge by message id.
 */
export function useChefChat(chatId: string | null) {
  const saved = useQuery(api.chat.messages, chatId ? { chatId } : "skip");
  const [local, setLocal] = useState<ChatMsg[]>([]);
  const [traces, setTraces] = useState<Record<string, Step[]>>({});
  const [busy, setBusy] = useState(false);

  // Clear: no chat selected means nothing left over from the last one
  useEffect(() => {
    if (chatId === null) {
      setLocal([]);
      setTraces({});
    }
  }, [chatId]);

  const messages = useMemo(() => {
    const byId = new Map<string, ChatMsg>();
    for (const m of local) byId.set(m.id, m);
    for (const m of saved ?? []) byId.set(m.id, m); // the saved copy wins
    return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  }, [local, saved]);

  const send = useCallback(async function run(
    targetChatId: string,
    text: string,
    retryId?: string,
  ): Promise<void> {
    const id = retryId ?? crypto.randomUUID();
    // a retry reuses the id, so the message is neither duplicated here nor in Convex
    setLocal((l) =>
      l.some((m) => m.id === id)
        ? l
        : [
            ...l,
            { id, role: "user", kind: "text", text, createdAt: Date.now() },
          ],
    );
    setTraces((t) => ({
      ...t,
      [id]: [{ id: "check", label: "Checking query", status: "running" }],
    }));
    setBusy(true);

    const setStep = (step: Step) =>
      setTraces((t) => {
        const steps = t[id] ?? [];
        const i = steps.findIndex((s) => s.id === step.id);
        return {
          ...t,
          [id]:
            i === -1
              ? [...steps, step]
              : steps.map((s, j) => (j === i ? step : s)),
        };
      });
    const fail = (message: string) => {
      setTraces(({ [id]: _drop, ...rest }) => rest);
      toast.error(message, {
        action: {
          label: "Retry",
          onClick: () => void run(targetChatId, text, id),
        },
      });
    };

    try {
      const res = await fetch(`/api/chef/${targetChatId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id, text }),
      });
      if (!res.ok || !res.body) {
        fail(
          res.status === 401
            ? "Please sign in again."
            : "Couldn't reach the chef. Please try again.",
        );
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split(/\r?\n\r?\n/);
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const event = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (!event || !data) continue;
          const payload = JSON.parse(data);
          if (event === "trace") setStep(payload as Step);
          if (event === "message")
            setLocal((l) => [...l.filter((m) => m.id !== (payload as ChatMsg).id), payload as ChatMsg]);
          if (event === "token") {
            const { id: replyId, text: chunkText } = payload as { id: string; text: string };
            setLocal((l) =>
              l.some((m) => m.id === replyId)
                ? l.map((m) => (m.id === replyId ? { ...m, text: m.text + chunkText } : m))
                : [...l, { id: replyId, role: "assistant", kind: "text", text: chunkText, createdAt: Date.now() }],
            );
          }
          if (event === "error")
            fail(
              (payload as { message?: string }).message ??
                "Something went wrong.",
            );
        }
      }
    } catch {
      fail("Connection lost. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { messages, traces, busy, send };
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy message"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Milliseconds since `start`, ticking while `active`. */
function useElapsed(start: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [active]);
  return Math.max(0, now - start);
}

/** Live steps while the chef works (with a running clock), folded into "Processed in N steps" when done. */
function StepTrace({ steps, startedAt }: { steps: Step[]; startedAt: number }) {
  const running = steps.some((s) => s.status === "running");
  const elapsed = useElapsed(startedAt, running);
  if (running) {
    return (
      <Trace>
        {steps.map((s) => (
          <TraceLine key={s.id} status={s.status === "running" ? "running" : undefined}>
            <TraceIcon>{s.status === "running" ? <Spinner /> : <Check />}</TraceIcon>
            <TraceTitle>{s.status === "running" ? `${s.label}…` : s.label}</TraceTitle>
            {s.status === "running" && <TraceDescription>{fmtSecs(elapsed)}</TraceDescription>}
          </TraceLine>
        ))}
      </Trace>
    );
  }
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <Check />
            </TraceIcon>
            <TraceTitle>
              Processed in {steps.length} step{steps.length === 1 ? "" : "s"}
            </TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            {steps.map((s) => (
              <TraceLine key={s.id}>
                <TraceIcon>
                  <Check />
                </TraceIcon>
                <TraceTitle>{s.label}</TraceTitle>
              </TraceLine>
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

const iconBtn =
  "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

/** Under a finished reply: time taken, copy, like and dislike (the votes are a UI demo, not saved). */
function ReplyFooter({ m }: { m: ChatMsg }) {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  return (
    <MessageFooter className="mt-1 gap-1">
      {m.durationMs !== undefined && <span className="mr-1 tabular-nums">{fmtSecs(m.durationMs)}</span>}
      <CopyButton text={m.text} />
      <button
        type="button"
        aria-label="Like"
        aria-pressed={vote === "up"}
        onClick={() => setVote(vote === "up" ? null : "up")}
        className={`${iconBtn} ${vote === "up" ? "text-foreground" : ""}`}
      >
        <ThumbsUp className={`size-3.5 ${vote === "up" ? "fill-current" : ""}`} />
      </button>
      <button
        type="button"
        aria-label="Dislike"
        aria-pressed={vote === "down"}
        onClick={() => setVote(vote === "down" ? null : "down")}
        className={`${iconBtn} ${vote === "down" ? "text-foreground" : ""}`}
      >
        <ThumbsDown className={`size-3.5 ${vote === "down" ? "fill-current" : ""}`} />
      </button>
    </MessageFooter>
  );
}

export function ChefMessages({
  messages,
  traces,
  busy,
}: {
  messages: ChatMsg[];
  traces: Record<string, Step[]>;
  busy: boolean;
}) {
  const last = messages.at(-1);
  // checking / reasoning and nothing said back yet
  const waiting = busy && last?.role === "user";
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, traces, waiting]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-1 pb-4 -mt-4!">
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="flex flex-col gap-3">
            <Message align="end">
              <MessageContent>
                <Bubble align="end" variant="muted">
                  <BubbleContent className="rounded-3xl px-4 py-2.5 text-[13px]">{m.text}</BubbleContent>
                </Bubble>
                <MessageFooter className="gap-1.5">
                  <CopyButton text={m.text} />
                  <span className="tabular-nums">{fmtTime(m.createdAt)}</span>
                </MessageFooter>
              </MessageContent>
            </Message>
            {waiting && m.id === last?.id && (
              <div aria-label="Chef is thinking" className="px-1">
                <DotmSquare1 size={20} dotSize={3} speed={1.2} bloom />
              </div>
            )}
            {traces[m.id] && <StepTrace steps={traces[m.id]} startedAt={m.createdAt} />}
          </div>
        ) : (
          <Message key={m.id}>
            <MessageContent>
              <Bubble variant="ghost">
                <BubbleContent className="text-[15px] leading-relaxed">{m.text}</BubbleContent>
              </Bubble>
              {/* hidden while the reply is still streaming in */}
              {!(busy && m.id === last?.id) && <ReplyFooter m={m} />}
            </MessageContent>
          </Message>
        ),
      )}
      <div ref={end} />
    </div>
  );
}
