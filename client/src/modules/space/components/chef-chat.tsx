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
import { ChefBlocks, ThinkingMatrix, type Block } from "./chef-blocks";
import { ChefMarkdown } from "./chef-markdown";
import { RunDoneActions, RunProposalCard, type HitlAnswer, type ProposalView } from "./chef-run-card";
import { api } from "../../../../convex/_generated/api";

export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  kind: "text" | "refusal" | "proposal" | "run_done";
  text: string;
  createdAt: number;
  /** kind "proposal": the run approval card (HITL). */
  proposal?: ProposalView;
  /** kind "run_done": the run that finished. */
  runId?: string;
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
  const [blocks, setBlocks] = useState<Record<string, Block[]>>({});
  const [busy, setBusy] = useState(false);

  // Clear: no chat selected means nothing left over from the last one
  useEffect(() => {
    if (chatId === null) {
      setLocal([]);
      setTraces({});
      setBlocks({});
    }
  }, [chatId]);

  const messages = useMemo(() => {
    const byId = new Map<string, ChatMsg>();
    for (const m of local) byId.set(m.id, m);
    for (const m of saved ?? []) byId.set(m.id, m); // the saved copy wins
    return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  }, [local, saved]);

  // An open approval card blocks new questions until it is answered (or runs out)
  const [now, setNow] = useState(() => Date.now());
  const openProposal = messages.find((m) => m.proposal?.status === "pending" && m.proposal.expiresAt > now)?.proposal ?? null;
  useEffect(() => {
    if (!openProposal) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, openProposal.expiresAt - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [openProposal]);

  /** The human's answer to an approval card: the route records it and resumes the chef. */
  const answer = useCallback(
    async (a: HitlAnswer): Promise<boolean> => {
      if (!chatId) return false;
      try {
        const res = await fetch(`/api/chef/${chatId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resume: a }),
        });
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          toast.error(err?.error ?? "Couldn't send your answer. Please try again.");
          return false;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let failed = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split(/\r?\n\r?\n/);
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const event = /^event: (.*)$/m.exec(frame)?.[1];
            const data = /^data: (.*)$/m.exec(frame)?.[1];
            if (event === "message" && data) {
              const msg = JSON.parse(data) as ChatMsg;
              setLocal((l) => [...l.filter((m) => m.id !== msg.id), msg]);
            }
            if (event === "error") failed = true;
          }
        }
        return !failed;
      } catch {
        toast.error("Connection lost. Please try again.");
        return false;
      }
    },
    [chatId],
  );

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
    /** Add a block, or update the one with the same kind and id. `merge` can build on the old one (reasoning text grows). */
    const putBlock = (next: Block, merge?: (old: Block) => Block) =>
      setBlocks((all) => {
        const list = all[id] ?? [];
        const i = list.findIndex((b) => b.kind === next.kind && b.id === next.id);
        return {
          ...all,
          [id]: i === -1 ? [...list, next] : list.map((b, j) => (j === i ? (merge ? merge(b) : next) : b)),
        };
      });
    const fail = (message: string) => {
      setTraces(({ [id]: _drop, ...rest }) => rest);
      setBlocks(({ [id]: _gone, ...rest }) => rest);
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
      if (res.status === 409) {
        // an approval card is still open: the question is not taken
        setLocal((l) => l.filter((m) => m.id !== id));
        setTraces(({ [id]: _drop, ...rest }) => rest);
        toast.warning("Confirm or deny the agent run first.", { description: "Your question was not sent." });
        return;
      }
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
          if (event === "reasoning") {
            const { id: rid, text: chunkText } = payload as { id: string; text: string };
            putBlock({ kind: "reasoning", id: rid, text: chunkText, done: false }, (old) =>
              old.kind === "reasoning" ? { ...old, text: old.text + chunkText } : old,
            );
          }
          if (event === "reasoning_end") {
            const { id: rid, durationMs } = payload as { id: string; durationMs: number };
            putBlock({ kind: "reasoning", id: rid, text: "", done: true, durationMs }, (old) =>
              old.kind === "reasoning" ? { ...old, done: true, durationMs } : old,
            );
          }
          if (event === "tool") {
            const p = payload as { id: string; step: number; name: string; status: "running" | "done" | "error"; args: unknown; output?: string };
            putBlock({ kind: "tool", id: p.id, step: p.step, name: p.name, args: p.args, status: p.status, output: p.output });
          }
          if (event === "proposal") {
            const p = payload as { agentNames: string[]; totalCredits: number; enough: boolean };
            toast.info(`Approval needed: run ${p.agentNames.join(" and ")}?`, {
              description: p.enough
                ? `${p.totalCredits} credits will be held. Confirm or deny in the chat.`
                : `Needs ${p.totalCredits} credits, more than your wallet has.`,
            });
          }
          if (event === "agents") {
            const p = payload as Omit<Extract<Block, { kind: "agents" }>, "kind">;
            putBlock({ kind: "agents", ...p });
          }
          if (event === "runs") {
            const p = payload as Omit<Extract<Block, { kind: "runs" }>, "kind">;
            putBlock({ kind: "runs", ...p });
          }
          if (event === "message")
            setLocal((l) => [
              ...l.filter((m) => m.id !== (payload as ChatMsg).id),
              payload as ChatMsg,
            ]);
          if (event === "token") {
            const { id: replyId, text: chunkText } = payload as {
              id: string;
              text: string;
            };
            setLocal((l) =>
              l.some((m) => m.id === replyId)
                ? l.map((m) =>
                    m.id === replyId ? { ...m, text: m.text + chunkText } : m,
                  )
                : [
                    ...l,
                    {
                      id: replyId,
                      role: "assistant",
                      kind: "text",
                      text: chunkText,
                      createdAt: Date.now(),
                    },
                  ],
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

  return { messages, traces, blocks, busy, send, answer, openProposal };
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
function StepTrace({
  steps,
  startedAt,
  pending,
}: {
  steps: Step[];
  startedAt: number;
  /** Reply not started yet: keep the live view even when every step is done. */
  pending: boolean;
}) {
  const stepRunning = steps.some((s) => s.status === "running");
  const running = stepRunning || pending;
  const elapsed = useElapsed(startedAt, running);
  if (running) {
    return (
      <Trace>
        {steps.map((s) => (
          <TraceLine
            key={s.id}
            status={s.status === "running" ? "running" : undefined}
          >
            <TraceIcon>
              {s.status === "running" ? <ThinkingMatrix /> : <Check />}
            </TraceIcon>
            <TraceTitle>
              {s.status === "running" ? `${s.label}…` : s.label}
            </TraceTitle>
            {s.status === "running" && (
              <TraceDescription>{fmtSecs(elapsed)}</TraceDescription>
            )}
          </TraceLine>
        ))}
        {!stepRunning && (
          <TraceLine status="running">
            <TraceIcon>
              <ThinkingMatrix />
            </TraceIcon>
            <TraceTitle>Thinking…</TraceTitle>
            <TraceDescription>{fmtSecs(elapsed)}</TraceDescription>
          </TraceLine>
        )}
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
      {m.durationMs !== undefined && (
        <span className="mr-1 tabular-nums">{fmtSecs(m.durationMs)}</span>
      )}
      <CopyButton text={m.text} />
      <button
        type="button"
        aria-label="Like"
        aria-pressed={vote === "up"}
        onClick={() => setVote(vote === "up" ? null : "up")}
        className={`${iconBtn} ${vote === "up" ? "text-foreground" : ""}`}
      >
        <ThumbsUp
          className={`size-3.5 ${vote === "up" ? "fill-current" : ""}`}
        />
      </button>
      <button
        type="button"
        aria-label="Dislike"
        aria-pressed={vote === "down"}
        onClick={() => setVote(vote === "down" ? null : "down")}
        className={`${iconBtn} ${vote === "down" ? "text-foreground" : ""}`}
      >
        <ThumbsDown
          className={`size-3.5 ${vote === "down" ? "fill-current" : ""}`}
        />
      </button>
    </MessageFooter>
  );
}

export function ChefMessages({
  chatId,
  messages,
  traces,
  blocks,
  busy,
  onSelectAgent,
  onAnswer,
}: {
  chatId: string | null;
  /** Approve or deny on a run approval card. */
  onAnswer: (a: HitlAnswer) => Promise<boolean>;
  messages: ChatMsg[];
  traces: Record<string, Step[]>;
  blocks: Record<string, Block[]>;
  busy: boolean;
  /** The user confirmed an agent in the picker: send this as their message. */
  onSelectAgent: (message: string) => void;
}) {
  const last = messages.at(-1);
  // checking / reasoning and nothing said back yet
  const waiting = busy && last?.role === "user";
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, traces, blocks, waiting]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-1.5! px-1 pb-4 -mt-4!">
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="flex flex-col gap-2!">
            <Message align="end">
              <MessageContent>
                <Bubble align="end" variant="muted">
                  <BubbleContent className="rounded-3xl px-4 py-2.5 text-[13px]">
                    {m.text}
                  </BubbleContent>
                </Bubble>
                <MessageFooter className="gap-1.5">
                  <CopyButton text={m.text} />
                  <span className="tabular-nums">{fmtTime(m.createdAt)}</span>
                </MessageFooter>
              </MessageContent>
            </Message>
            {traces[m.id] && (
              <StepTrace
                steps={traces[m.id]}
                startedAt={m.createdAt}
                pending={waiting && m.id === last?.id && !blocks[m.id]?.length}
              />
            )}
            {blocks[m.id]?.length ? (
              <ChefBlocks blocks={blocks[m.id]} onConfirm={onSelectAgent} />
            ) : null}
          </div>
        ) : m.kind === "proposal" ? (
          m.proposal && chatId ? (
            <div key={m.id} className="w-full max-w-xl">
              <RunProposalCard p={m.proposal} chatId={chatId} onAnswer={onAnswer} />
            </div>
          ) : null
        ) : (
          <Message key={m.id}>
            <MessageContent>
              <Bubble variant="ghost">
                <BubbleContent className="text-[12px] leading-relaxed">
                  <ChefMarkdown>{m.text}</ChefMarkdown>
                </BubbleContent>
              </Bubble>
              {m.kind === "run_done" && m.runId && <RunDoneActions runId={m.runId} />}
              {/* shown the moment the reply is final (it carries its time), not when the connection closes */}
              {m.kind !== "run_done" && !(busy && m.id === last?.id && m.durationMs === undefined) && (
                <ReplyFooter m={m} />
              )}
            </MessageContent>
          </Message>
        ),
      )}
      <div ref={end} />
    </div>
  );
}
