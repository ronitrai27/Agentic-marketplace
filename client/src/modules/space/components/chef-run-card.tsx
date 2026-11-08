"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { toast } from "sonner";
import { Ban, Check, CircleAlert, Clock, ExternalLink, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { AgentLogo } from "./agent-logo";
import { openRun } from "./runs/run-store";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type ProposalView = {
  proposalId: string;
  agents: { slug: string; name: string; logoUrl: string | null; holdCredits: number; tiered: boolean }[];
  totalCredits: number;
  status: "pending" | "approved" | "denied" | "expired";
  runIds: string[];
  expiresAt: number;
};

export type HitlAnswer = { proposalId: string; decision: "approved" | "denied" | "expired"; runIds: string[] };

const credits = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")} credits`;
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function useNow(active: boolean, every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

const errMessage = (e: unknown, fallback: string) =>
  (e instanceof ConvexError ? (e.data as { message?: string } | null)?.message : undefined) ?? fallback;

// ─── HITL approval card ───────────────────────────────────────────────────────

/**
 * The chef's run proposal. Nothing is held until Confirm: then the wallet and each agent's server are checked, the
 * credits held (highest tier for tiered pricing), the graph resumed and the run sheet opened. Rebuilt from Convex
 * after a refresh, including the live runs it started.
 */
export function RunProposalCard({
  p,
  chatId,
  onAnswer,
}: {
  p: ProposalView;
  chatId: string;
  onAnswer: (a: HitlAnswer) => Promise<boolean>;
}) {
  const wallet = useQuery(api.wallet.getWallet, p.status === "pending" ? {} : "skip");
  const checkAgent = useAction(api.health.checkAgent);
  const hold = useMutation(api.runs.hold);
  const cancelHold = useMutation(api.runs.cancelAwaiting);
  const [busy, setBusy] = useState<string | null>(null);

  const now = useNow(p.status === "pending");
  const expired = p.status === "expired" || (p.status === "pending" && now > p.expiresAt);
  const pending = p.status === "pending" && !expired;
  const available = wallet ? Math.max(0, Math.round((wallet.credits - wallet.escrow) * 100) / 100) : null;
  const short = pending && available !== null && available < p.totalCredits;

  async function approve() {
    const t = toast.loading("Checking your wallet…");
    try {
      setBusy("Checking wallet");
      if (short) throw new Error(`Not enough credits. You need ${credits(p.totalCredits)} and have ${credits(available ?? 0)} available.`);

      for (const a of p.agents) {
        setBusy(`Pinging ${a.name}`);
        toast.loading(`Pinging ${a.name}'s server…`, { id: t });
        const health = await checkAgent({ slug: a.slug });
        if (!health.ok) throw new Error(health.code === "AGENT_PAUSED" ? `${a.name} is paused: its server did not respond.` : `${a.name}: ${health.message}`);
      }

      setBusy("Holding credits");
      toast.loading(`Holding ${credits(p.totalCredits)}…`, { id: t });
      const runIds: string[] = [];
      try {
        for (const a of p.agents) runIds.push((await hold({ slug: a.slug, chatId })).runId);
      } catch (e) {
        // all or nothing: a pair where one hold failed gives the other back
        await Promise.all(runIds.map((id) => cancelHold({ runId: id as Id<"runs"> }).catch(() => {})));
        throw new Error(errMessage(e, "Could not hold the credits. Nothing was charged."));
      }

      setBusy("Starting");
      const ok = await onAnswer({ proposalId: p.proposalId, decision: "approved", runIds });
      if (!ok) {
        await Promise.all(runIds.map((id) => cancelHold({ runId: id as Id<"runs"> }).catch(() => {})));
        throw new Error("The approval could not be saved. Nothing was charged.");
      }
      toast.success(`Approved: ${credits(p.totalCredits)} held`, { id: t });
      const first = p.agents[0];
      toast(`Opening ${first.name} in the side sheet`, { description: "Give it its input and press Run." });
      openRun(runIds[0]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.", { id: t });
    } finally {
      setBusy(null);
    }
  }

  async function deny() {
    setBusy("Denying");
    const ok = await onAnswer({ proposalId: p.proposalId, decision: expired ? "expired" : "denied", runIds: [] });
    setBusy(null);
    if (ok) toast("Run denied. Nothing was held.");
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="w-full"
    >
      <Item variant="outline" className="flex-col items-stretch gap-3 bg-background p-3">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          {pending ? "Approve this run?" : p.status === "approved" ? "Run approved" : expired ? "Approval expired" : "Run denied"}
          {pending && (
            <span className="ml-auto inline-flex items-center gap-1 tabular-nums">
              <Clock className="size-3" /> {clock(p.expiresAt - now)}
            </span>
          )}
        </div>

        {p.status === "approved" ? (
          <ItemGroup className="gap-2">
            {p.runIds.map((id) => (
              <RunLiveRow key={id} runId={id} />
            ))}
          </ItemGroup>
        ) : (
          <ItemGroup className="gap-2">
            {p.agents.map((a) => (
              <Item key={a.slug} variant="muted" size="sm">
                <ItemMedia>
                  <AgentLogo name={a.name} logoUrl={a.logoUrl} className="size-9 text-sm" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{a.name}</ItemTitle>
                  <ItemDescription>
                    Holds {credits(a.holdCredits)}
                    {a.tiered ? " (highest tier; you pay only for the tier you pick)" : ""}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        )}

        {pending && (
          <ItemFooter className="flex-wrap gap-2">
            <div className="min-w-0 flex-1 text-xs">
              <p className="tabular-nums">
                Total hold <span className="font-semibold">{credits(p.totalCredits)}</span>
                {available !== null && <span className="text-muted-foreground"> · wallet {credits(available)} available</span>}
              </p>
              {short && (
                <p className="mt-0.5 text-red-600">
                  Not enough credits: you need {credits(p.totalCredits)} and have {credits(available ?? 0)}.{" "}
                  <Link href="/space/wallet" className="underline underline-offset-2">
                    Top up
                  </Link>
                </p>
              )}
              {busy && (
                <p className="mt-0.5 inline-flex items-center gap-1.5 text-muted-foreground">
                  <Spinner className="size-3" /> {busy}…
                </p>
              )}
            </div>
            <ItemActions>
              <Button variant="outline" size="sm" disabled={!!busy} onClick={deny}>
                <Ban className="size-3.5" /> Deny
              </Button>
              <Button size="sm" disabled={!!busy || short || available === null} onClick={approve}>
                <Check className="size-3.5" /> Confirm
              </Button>
            </ItemActions>
          </ItemFooter>
        )}
        {p.status === "pending" && expired && (
          <ItemFooter>
            <span className="text-xs text-muted-foreground">Expired after 10 minutes. Nothing was held.</span>
            <Button variant="outline" size="sm" disabled={!!busy} onClick={deny}>
              Dismiss
            </Button>
          </ItemFooter>
        )}
      </Item>
    </motion.div>
  );
}

// ─── live run row ─────────────────────────────────────────────────────────────

const STATUS: Record<string, string> = {
  awaiting_input: "Waiting for your input",
  queued: "Queued",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};
const ACTIVE = new Set(["awaiting_input", "queued", "running"]);

/** One line for the newest event: what the agent is doing right now. */
function eventLine(type: string, dataJson: string): string {
  let d: any = {};
  try {
    d = JSON.parse(dataJson) ?? {};
  } catch {
    /* plain text */
  }
  const s = (x: unknown) => String(x ?? "").replace(/\s+/g, " ").trim();
  switch (type) {
    case "task.progress":
      return `${typeof d.percent === "number" ? `${Math.round(d.percent)}%` : "Working"}${d.message ? ` · ${s(d.message)}` : ""}`;
    case "task.activity":
      return `Using ${s(d.activity_type ?? "a tool")}`;
    case "task.status":
      return `Status: ${s(d.status)}`;
    case "task.delta":
      return `Writing: ${s(d.content).slice(-120)}`;
    case "health":
      return d.ok ? "Agent server healthy" : "Agent server did not answer its health check";
    case "schema.check":
      return d.valid ? "Output matches the agent's schema" : `Output broke the schema: ${s(d.problem)}`;
    case "task.completed":
      return "Agent finished";
    case "task.failed":
      return s(d.error?.message ?? "Agent failed");
    case "run.note":
      return s(d.message);
    default:
      return type;
  }
}

/** A run started from the chat: logo, status, progress bar, timer and the newest event (each one replaces the last). */
export function RunLiveRow({ runId }: { runId: string }) {
  const run = useQuery(api.chatRuns.runCard, { runId: runId as Id<"runs"> });
  const active = !!run && ACTIVE.has(run.status);
  const now = useNow(active);
  if (run === undefined) {
    return (
      <Item variant="muted" size="sm">
        <Spinner className="size-4" />
      </Item>
    );
  }
  if (run === null) return null;

  const start = run.startedAt ?? run.createdAt;
  const elapsed = (run.finishedAt ?? now) - start;
  const pct = run.status === "succeeded" ? 100 : (run.progressPct ?? null);
  const line =
    run.status === "awaiting_input"
      ? "Open the side sheet, give the input and press Run"
      : run.status === "failed" || run.status === "cancelled"
        ? (run.error?.message ?? STATUS[run.status])
        : run.last
          ? eventLine(run.last.type, run.last.dataJson)
          : run.status === "queued"
            ? "Waiting for a worker…"
            : "Starting…";

  return (
    <Item variant="muted" size="sm" className="items-start">
      <ItemMedia>
        <AgentLogo name={run.agent.name} logoUrl={run.agent.logoUrl} className="size-9 text-sm" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full">
          {run.agent.name}
          <span
            className={`ml-1 rounded-full px-1.5 py-px text-[10px] font-medium ${
              run.status === "succeeded"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : run.status === "failed"
                  ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                  : run.status === "awaiting_input"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    : "bg-muted text-muted-foreground"
            }`}
          >
            {STATUS[run.status] ?? run.status}
          </span>
          {run.status !== "awaiting_input" && (
            <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">{clock(elapsed)}</span>
          )}
        </ItemTitle>

        {(run.status === "queued" || run.status === "running" || run.status === "succeeded") && (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border">
            {pct === null ? (
              <div className="h-full w-1/3 animate-[chef-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-blue-500" />
            ) : (
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${run.status === "succeeded" ? "bg-emerald-500" : "bg-blue-500"}`}
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
        )}

        {/* single trace line: the newest event slides in over the previous one */}
        <div className="relative mt-1 h-4 overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.p
              key={`${run.status}-${run.last?.at ?? 0}-${line}`}
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={`truncate text-[11px] ${run.status === "failed" ? "text-red-600" : "text-muted-foreground"}`}
            >
              {run.status === "failed" && <CircleAlert className="mr-1 inline size-3" />}
              {line}
            </motion.p>
          </AnimatePresence>
        </div>
      </ItemContent>
      <ItemActions>
        <Button variant={run.status === "succeeded" ? "default" : "outline"} size="xs" onClick={() => openRun(run.id)}>
          {run.status === "succeeded" ? "Open output" : run.status === "awaiting_input" ? "Give input" : "Open"}
          <ExternalLink className="size-3" />
        </Button>
      </ItemActions>
    </Item>
  );
}

/** The chef's "your run finished" message: posted by Convex the moment the run ends, with a way to open it. */
export function RunDoneActions({ runId }: { runId: string }) {
  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
      <Button size="xs" onClick={() => openRun(runId)}>
        Open output <ExternalLink className="size-3" />
      </Button>
      <span className="inline-flex items-center gap-1">
        or press
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>Shift</Kbd>
          <Kbd>B</Kbd>
        </KbdGroup>
      </span>
    </div>
  );
}
