"use client";

import React from "react";
import { useAction, useConvex, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Circle, CircleCheck, CircleX, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { PLATFORM_FEE_RATE, fmtMicros, microsToCredits, runQuote, type PlanMicros } from "@/lib/agent-display";
import { api } from "../../../../../convex/_generated/api";

const HEALTH_SECONDS = 120;
/** Keeps each step on screen long enough to read, even when the answer is instant. */
const MIN_STEP_MS = 600;

type StepState = "idle" | "active" | "ok" | "error";
interface Step {
  state: StepState;
  error?: string;
  /** Offer a shortcut to the wallet page (low balance). */
  topUp?: boolean;
}
const IDLE: Step[] = [{ state: "idle" }, { state: "idle" }, { state: "idle" }];

const credits = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")} credits`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Line({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">{children}</div>
    </div>
  );
}

function StepRow({ step, title, detail, onTopUp }: { step: Step; title: string; detail?: string; onTopUp?: () => void }) {
  const tone =
    step.state === "ok" ? "text-emerald-600" : step.state === "error" ? "text-red-600" : step.state === "idle" ? "text-muted-foreground" : "text-foreground";
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0">
        {step.state === "active" ? (
          <Spinner className="size-5" />
        ) : step.state === "ok" ? (
          <CircleCheck className="size-5 text-emerald-600" />
        ) : step.state === "error" ? (
          <CircleX className="size-5 text-red-600" />
        ) : (
          <Circle className="size-5 text-muted-foreground/40" />
        )}
      </span>
      <div className="min-w-0">
        <p className={`text-sm font-medium ${tone}`}>{title}</p>
        {step.state === "error" && step.error ? (
          <>
            <p className="mt-0.5 text-xs text-red-600">{step.error}</p>
            {step.topUp && onTopUp && (
              <Button size="sm" className="mt-2" onClick={onTopUp}>
                Top up now
              </Button>
            )}
          </>
        ) : (
          detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        )}
      </div>
    </li>
  );
}

/**
 * Confirm, then three checks in order: wallet, agent server, payment hold. Only when all three pass is the run
 * opened (awaiting its input) and `onReady` called, so nothing runs and nothing is held before every check is green.
 */
export function RunConfirmDialog({
  open,
  onOpenChange,
  agentName,
  agentSlug,
  pricing,
  onReady,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  agentSlug: string;
  pricing: PlanMicros | null;
  onReady: (runId: string) => void;
}) {
  const convex = useConvex();
  const checkAgent = useAction(api.health.checkAgent);
  const router = useRouter();
  const hold = useMutation(api.runs.hold);
  const cancelHold = useMutation(api.runs.cancelAwaiting);

  const quote = runQuote(pricing);
  // Tiered agents: every mode with its price (platform fee included), shown as a hint under the price range.
  const modes =
    pricing?.shape === "tiered" && new Set(pricing.tiers.map((t) => t.priceMicros)).size > 1
      ? pricing.tiers.map((t) => ({ label: t.value, price: fmtMicros(t.priceMicros + Math.round(t.priceMicros * PLATFORM_FEE_RATE)) }))
      : null;
  // Tiered: nothing is held here. The payment is held when the buyer sends their chosen mode, so only the cheapest mode must be affordable now.
  const tiered = pricing?.shape === "tiered";
  const needed =
    quote.holdMicros === null
      ? null
      : microsToCredits(
          pricing?.shape === "tiered"
            ? Math.min(...pricing.tiers.map((t) => t.priceMicros + Math.round(t.priceMicros * PLATFORM_FEE_RATE)))
            : quote.holdMicros,
        );

  const [showFee, setShowFee] = React.useState(false);
  const [phase, setPhase] = React.useState<"confirm" | "checking">("confirm");
  const [steps, setSteps] = React.useState<Step[]>(IDLE);
  const [secondsLeft, setSecondsLeft] = React.useState(HEALTH_SECONDS);
  const attempt = React.useRef(0);

  React.useEffect(() => {
    if (open) return;
    attempt.current += 1; // abandons any check still in flight
    setPhase("confirm");
    setSteps(IDLE);
    setShowFee(false);
  }, [open]);

  // Countdown shown while the agent server check is waiting for an answer
  const healthActive = steps[1].state === "active";
  React.useEffect(() => {
    if (!healthActive) return;
    setSecondsLeft(HEALTH_SECONDS);
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [healthActive]);

  const setStep = (i: number, step: Step) => setSteps((prev) => prev.map((s, idx) => (idx === i ? step : s)));

  async function start() {
    if (needed === null) return;
    const mine = ++attempt.current;
    const stale = () => attempt.current !== mine;
    setPhase("checking");
    setSteps(IDLE);

    // 1. Wallet
    setStep(0, { state: "active" });
    let wallet: { credits: number; escrow: number };
    try {
      const [w] = await Promise.all([convex.query(api.wallet.getWallet, {}), sleep(MIN_STEP_MS)]);
      wallet = w;
    } catch {
      if (!stale()) setStep(0, { state: "error", error: "Could not read your wallet. Please try again." });
      return;
    }
    if (stale()) return;
    const available = Math.round((wallet.credits - wallet.escrow) * 100) / 100;
    if (available < needed) {
      setStep(0, { state: "error", topUp: true, error: `Not enough credits. You need ${credits(needed)} and have ${credits(Math.max(0, available))} available.` });
      return;
    }
    setStep(0, { state: "ok" });

    // 2. Agent server (the server side waits up to 120s)
    setStep(1, { state: "active" });
    try {
      const health = await checkAgent({ slug: agentSlug });
      if (stale()) return;
      if (!health.ok) {
        setStep(1, { state: "error", error: health.code === "AGENT_PAUSED" ? "This agent is paused: its server did not respond." : health.message });
        return;
      }
    } catch {
      if (!stale()) setStep(1, { state: "error", error: "Agent server is not reachable." });
      return;
    }
    setStep(1, { state: "ok" });

    // 3. Hold the payment
    setStep(2, { state: "active" });
    try {
      const [held] = await Promise.all([hold({ slug: agentSlug }), sleep(MIN_STEP_MS)]);
      if (stale()) {
        // Cancelled while the hold was being made: give it straight back
        await cancelHold({ runId: held.runId }).catch(() => {});
        return;
      }
      setStep(2, { state: "ok" });
      await sleep(500);
      if (stale()) return;
      onReady(held.runId);
    } catch (err) {
      if (stale()) return;
      const data = err instanceof ConvexError ? (err.data as { message?: string }) : null;
      setStep(2, { state: "error", error: data?.message ?? "Could not hold the payment. Nothing was charged." });
    }
  }

  const failed = steps.some((s) => s.state === "error");

  // While the checks run, only the X or a button closes this dialog: a stray click outside must not hide what happened.
  function handleOpenChange(next: boolean, details?: { reason?: string }) {
    if (next) return onOpenChange(true);
    if (phase === "checking" && (details?.reason === "outside-press" || details?.reason === "escape-key")) return;
    if (phase === "checking" && details?.reason === "close-press" && !failed) {
      toast(`You cancelled the checks to run ${agentName}`);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {phase === "confirm" ? (
          <>
            <DialogHeader>
              <DialogTitle>Run {agentName}?</DialogTitle>
              <DialogDescription>Please confirm before this agent starts working.</DialogDescription>
            </DialogHeader>

            <div className="divide-y divide-border rounded-xl border border-border px-4">
              <Line label="Agent">
                <span className="font-medium">{agentName}</span>
              </Line>
              <Line
                label="You will be charged"
                hint={modes ? undefined : "This amount will be held during execution from your wallet."}
              >
                {quote.charge}
              </Line>
              {modes && (
                <div className="py-3">
                  <p className="text-xs text-muted-foreground">Modes available to select</p>
                  <dl className="mt-1.5 space-y-1 text-xs tabular-nums">
                    {modes.map((m) => (
                      <div key={m.label} className="flex justify-between text-foreground">
                        <dt className="capitalize">{m.label}</dt>
                        <dd className="font-medium">{m.price}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              {quote.holdMicros !== null && (
                <div className="py-2">
                  <button
                    type="button"
                    onClick={() => setShowFee((v) => !v)}
                    aria-expanded={showFee}
                    className="flex w-full items-center justify-between py-1 text-xs text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
                  >
                    Platform commission
                    <ChevronDown className={`size-4 transition-transform ${showFee ? "rotate-180" : ""}`} />
                  </button>
                  {showFee && (
                    <dl className="mt-1 space-y-1.5 pb-1 text-xs tabular-nums">
                      <div className="flex justify-between text-muted-foreground">
                        <dt>Agent price{quote.holdIsMax ? " (maximum)" : ""}</dt>
                        <dd>{fmtMicros(quote.agentMicros!)}</dd>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <dt>Platform fee ({Math.round(PLATFORM_FEE_RATE * 100)}%)</dt>
                        <dd>{fmtMicros(quote.feeMicros!)}</dd>
                      </div>
                    </dl>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-start gap-2.5 rounded-xl bg-muted/60 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
              <p>
                <span className="font-medium text-foreground">Tip:</span> using Chef to run can help you compare and
                choose the best agents for your task.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={start} disabled={needed === null}>
                Confirm &amp; run
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Starting {agentName}</DialogTitle>
              <DialogDescription>Nothing runs until all three checks pass.</DialogDescription>
            </DialogHeader>

            <ol className="space-y-5 py-2">
              <StepRow
                step={steps[0]}
                title="Checking your wallet"
                detail={needed === null ? undefined : `Needs ${credits(needed)} available`}
                onTopUp={() => {
                  onOpenChange(false);
                  router.push("/space/wallet");
                }}
              />
              <StepRow
                step={steps[1]}
                title="Checking the agent server"
                detail={steps[1].state === "active" ? `Waiting for it to respond · ${secondsLeft}s left` : "Confirms the agent is online"}
              />
              <StepRow
                step={steps[2]}
                title={tiered ? "Opening your run" : "Holding the payment"}
                detail={
                  tiered
                    ? "The payment is held after you pick a mode and send."
                    : "This will not be deducted on a failed or wrong output."
                }
              />
            </ol>

            {failed && (
              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button onClick={start}>Try again</Button>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
