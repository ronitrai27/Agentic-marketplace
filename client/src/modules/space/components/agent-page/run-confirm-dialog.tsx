"use client";

import React from "react";
import { ChevronDown, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PLATFORM_FEE_RATE, fmtMicros, runQuote, type PlanMicros } from "@/lib/agent-display";

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

/** Confirmation step before a manual run. UI only: confirming just closes it for now. */
export function RunConfirmDialog({
  open,
  onOpenChange,
  agentName,
  pricing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  pricing: PlanMicros | null;
}) {
  const quote = runQuote(pricing);
  const [showFee, setShowFee] = React.useState(false);
  React.useEffect(() => {
    if (!open) setShowFee(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run {agentName}?</DialogTitle>
          <DialogDescription>Please confirm before this agent starts working.</DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-border rounded-xl border border-border px-4">
          <Line label="Agent">
            <span className="font-medium">{agentName}</span>
          </Line>
          <Line label="You will be charged" hint="Deducted from your wallet when the run completes.">
            {quote.charge}
          </Line>
          <Line
            label="Held from your wallet now"
            hint={
              quote.holdIsMax
                ? "The most this run can cost. Anything unused is released back."
                : "Released back to you if the run fails."
            }
          >
            {quote.holdMicros === null ? "None" : fmtMicros(quote.holdMicros)}
          </Line>
          {quote.holdMicros !== null && (
            <div className="py-2">
              <button
                type="button"
                onClick={() => setShowFee((v) => !v)}
                aria-expanded={showFee}
                className="flex w-full items-center justify-between py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
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
                  <div className="flex justify-between font-medium text-foreground">
                    <dt>Total held</dt>
                    <dd>{fmtMicros(quote.holdMicros)}</dd>
                  </div>
                </dl>
              )}
            </div>
          )}
        </div>

        <div className="flex items-start gap-2.5 rounded-xl bg-muted/60 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
          <p>
            <span className="font-medium text-foreground">Tip:</span> using Chef to run can help you compare and choose
            the best agents for your task.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onOpenChange(false)}>Confirm &amp; run</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
