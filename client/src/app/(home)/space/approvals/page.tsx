"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Check, Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/** "Approve and allow up to" choices, in credits (100 credits = $1). Applies to external (MCP) agents only. */
const ALLOW_PRESETS = [100, 500, 1000];

function minsLeft(at: number) {
  return Math.max(0, Math.ceil((at - Date.now()) / 60_000));
}

function prettyInput(json: string) {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

function Approvals() {
  const highlight = useSearchParams().get("id");
  const pending = useQuery(api.mcpRuns.myPending);
  const settings = useQuery(api.mcpRuns.getSettings);
  const decide = useMutation(api.mcpRuns.decide);
  const wallet = useQuery(api.wallet.getWallet);
  const setAutoApprove = useMutation(api.mcpRuns.setAutoApprove);
  const [busy, setBusy] = useState<string | null>(null);
  const [limit, setLimit] = useState("");

  const available = wallet ? Math.max(0, wallet.credits - wallet.escrow) : null;

  useEffect(() => {
    if (settings) setLimit(String(settings.autoApproveCredits));
  }, [settings]);

  async function answer(id: string, approve: boolean, alwaysAllowCredits?: number) {
    setBusy(id);
    try {
      const res = await decide({ requestId: id as Id<"mcp_run_requests">, approve, alwaysAllowCredits });
      if (!res.ok) toast.error(res.message ?? "Could not complete that.");
      else if (!approve) toast.success("Denied.");
      else if (alwaysAllowCredits) toast.success(`Approved. Future runs up to $${alwaysAllowCredits / 100} start automatically.`);
      else toast.success("Approved. The run is starting.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function saveLimit() {
    try {
      await setAutoApprove({ credits: Number(limit) });
      toast.success("Saved.");
    } catch {
      toast.error("Enter a number of credits between 0 and 10000.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Run approvals</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Assistants connected through MCP (Claude, Codex, Hermes...) ask here before an agent runs. Credits are held only
          after you approve, and charged only if the run succeeds.
          {available !== null && <> Wallet available: <strong>{Math.round(available * 100) / 100} credits</strong>.</>}
        </p>
      </div>

      {pending === undefined ? (
        <Loader2 className="size-5 animate-spin text-neutral-400" />
      ) : pending.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-neutral-500">Nothing is waiting for approval.</p>
      ) : (
        <ul className="space-y-3">
          {pending.map((r) => (
            <li
              key={r.id}
              className={`rounded-2xl border p-4 ${r.id === highlight ? "border-neutral-900 ring-1 ring-neutral-900" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.agentName}</p>
                  <p className="text-xs text-neutral-500">
                    Requested by {r.clientName ?? "an MCP client"} · expires in {minsLeft(r.expiresAt)} min
                  </p>
                </div>
                <p className="shrink-0 text-sm font-medium">up to {r.holdCredits} credits</p>
              </div>
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
                {prettyInput(r.inputPreview)}
              </pre>
              {available !== null && available < r.holdCredits && (
                <p className="mt-3 text-xs text-red-600">
                  Not enough credits: this run can cost up to {r.holdCredits} and you have {Math.round(available * 100) / 100}{" "}
                  available. Top up your wallet to approve.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <Button variant="outline" disabled={busy === r.id} onClick={() => answer(r.id, false)}>
                  <X className="mr-1 size-4" /> Deny
                </Button>
                <Button
                  disabled={busy === r.id || (available !== null && available < r.holdCredits)}
                  onClick={() => answer(r.id, true)}
                >
                  {busy === r.id ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Check className="mr-1 size-4" />}
                  Approve and run
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <span>Or approve and allow future runs up to</span>
                {ALLOW_PRESETS.filter((c) => c >= r.holdCredits).map((c) => (
                  <Button
                    key={c}
                    size="sm"
                    variant="outline"
                    disabled={busy === r.id || (available !== null && available < r.holdCredits)}
                    onClick={() => answer(r.id, true, c)}
                  >
                    ${c / 100}
                  </Button>
                ))}
                <span>per run</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-2xl border p-4">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck className="size-4" /> Auto-approve small runs
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Runs whose maximum cost is at or under this many credits start without asking (100 credits = $1). 0 means always ask.
        </p>
        <div className="mt-3 flex gap-2">
          <Input type="number" min={0} max={10000} value={limit} onChange={(e) => setLimit(e.target.value)} className="w-32" />
          <Button variant="outline" onClick={saveLimit}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<Loader2 className="m-6 size-5 animate-spin text-neutral-400" />}>
      <Approvals />
    </Suspense>
  );
}
