"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Bot, Check, ChevronRight, Clock, History, Loader2, ShieldCheck, Wallet, X } from "lucide-react";
import { CardDitherBackground } from "@/components/ui/card-dither-background";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { creditsToUsd, mcpClient, SUPPORTED_CLIENTS } from "@/modules/space/mcp-clients";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/** "Approve and allow future runs up to" choices, in credits (100 credits = $1). External (MCP) agents only. */
const ALLOW_PRESETS = [100, 500, 1000];
/** Auto-approve limit choices; 0 = always ask. */
const LIMIT_CHOICES = [0, 100, 500, 1000];

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

function ClientLogo({ name, size = 44 }: { name: string | null; size?: number }) {
  const client = mcpClient(name);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl border bg-white dark:bg-neutral-100"
      style={{ width: size, height: size }}
      title={client.label}
    >
      {client.logo ? (
        <Image src={client.logo} alt={client.label} width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} className="object-contain" />
      ) : (
        <Bot className="size-4 text-neutral-500" />
      )}
    </span>
  );
}

function Approvals() {
  const highlight = useSearchParams().get("id");
  const pending = useQuery(api.mcpRuns.myPending);
  const recent = useQuery(api.mcpRuns.myRecent);
  const [showRecent, setShowRecent] = useState(false);
  const settings = useQuery(api.mcpRuns.getSettings);
  const wallet = useQuery(api.wallet.getWallet);
  const decide = useMutation(api.mcpRuns.decide);
  const setAutoApprove = useMutation(api.mcpRuns.setAutoApprove);
  const [busy, setBusy] = useState<string | null>(null);

  const available = wallet ? Math.max(0, wallet.credits - wallet.escrow) : null;
  const limit = settings?.autoApproveCredits ?? 0;

  async function answer(id: string, approve: boolean, alwaysAllowCredits?: number) {
    setBusy(id);
    try {
      const res = await decide({ requestId: id as Id<"mcp_run_requests">, approve, alwaysAllowCredits });
      if (!res.ok) toast.error(res.message ?? "Could not complete that.");
      else if (!approve) toast.success("Denied.");
      else if (alwaysAllowCredits) toast.success(`Approved. Future runs up to ${creditsToUsd(alwaysAllowCredits)} start automatically.`);
      else toast.success("Approved. The run is starting.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function saveLimit(credits: number) {
    try {
      await setAutoApprove({ credits });
      toast.success(credits === 0 ? "Auto-approve is off." : `Runs up to ${creditsToUsd(credits)} start automatically.`);
    } catch {
      toast.error("Could not save that.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Agent approvals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Runs requested by your coding assistants. Credits are held only after you approve, and charged only if the run
            succeeds.
          </p>
        </div>
        {available !== null && (
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium">
            <Wallet className="size-3.5 text-muted-foreground" />
            {creditsToUsd(available)}
          </div>
        )}
      </header>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>Works with</span>
        <div className="flex items-center gap-2">
          {SUPPORTED_CLIENTS.map((c) => (
            <span key={c.label} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1">
              <Image src={c.logo} alt="" width={18} height={18} className="size-[18px] object-contain dark:rounded-sm dark:bg-white dark:p-px" />
              {c.label}
            </span>
          ))}
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">
            Waiting for you{pending && pending.length > 0 ? ` (${pending.length})` : ""}
          </h2>
          <button
            type="button"
            onClick={() => setShowRecent((v) => !v)}
            aria-expanded={showRecent}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
              showRecent && "border-foreground text-foreground",
            )}
          >
            <History className="size-3.5" /> Recent requests
          </button>
        </div>

        {showRecent && (
          <div className="overflow-hidden rounded-xl border border-neutral-300 dark:border-neutral-700">
            {recent === undefined ? (
              <Loader2 className="m-4 size-4 animate-spin text-muted-foreground" />
            ) : recent.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">No requests yet.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-neutral-300 text-muted-foreground dark:border-neutral-700">
                  <tr>
                    <th className="px-3 py-2 font-medium">Requested by</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">Agent</th>
                    <th className="px-3 py-2 text-right font-medium">Credits</th>
                    <th className="px-3 py-2 text-right font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className="border-b border-neutral-300 last:border-0 dark:border-neutral-700">
                      <td className="px-3 py-2">
                        <ClientLogo name={r.clientName} size={28} />
                      </td>
                      <td className="px-3 py-2 capitalize">{r.status}</td>
                      <td className="px-3 py-2 font-medium">{r.agentName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.credits !== null ? creditsToUsd(r.credits) : "-"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-muted-foreground">
                        {new Date(r.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {pending === undefined ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : pending.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-12 text-center">
            <ShieldCheck className="size-6 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">Nothing is waiting for approval.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => {
              const client = mcpClient(r.clientName);
              const short = available !== null && available < r.holdCredits;
              const disabled = busy === r.id || short;
              return (
                <li
                  key={r.id}
                  className={cn("rounded-2xl border p-4", r.id === highlight && "border-foreground ring-1 ring-foreground")}
                >
                  <div className="flex items-start gap-3">
                    <ClientLogo name={r.clientName} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">{client.label}</span>
                        <span className="text-muted-foreground"> wants to run </span>
                        <span className="font-medium">{r.agentName}</span>
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" /> expires in {minsLeft(r.expiresAt)} min
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-medium">up to {creditsToUsd(r.holdCredits)}</p>
                  </div>

                  <details className="group mt-3">
                    <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
                      View input
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs">{prettyInput(r.inputPreview)}</pre>
                  </details>

                  {short && (
                    <p className="mt-3 text-xs text-red-600">
                      Not enough credits: you have {creditsToUsd(available ?? 0)} available. Top up your wallet to approve.
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button size="sm" disabled={disabled} onClick={() => answer(r.id, true)}>
                      {busy === r.id ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Check className="mr-1 size-3.5" />}
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => answer(r.id, false)}>
                      <X className="mr-1 size-3.5" /> Deny
                    </Button>
                    <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>Approve and allow up to</span>
                      {ALLOW_PRESETS.filter((c) => c >= r.holdCredits).map((c) => (
                        <Button
                          key={c}
                          size="xs"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => answer(r.id, true, c)}
                        >
                          {creditsToUsd(c)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="relative space-y-3 overflow-hidden rounded-2xl border p-4">
        <CardDitherBackground className="opacity-40" />
        <div className="relative flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4" /> Auto-approve
        </div>
        <p className="relative text-sm text-muted-foreground">
          Runs from your assistants that cost up to this amount start without asking. Anything higher still needs your
          approval.
        </p>
        <div className="relative flex flex-wrap gap-2">
          {LIMIT_CHOICES.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={limit === c ? "default" : "outline"}
              disabled={settings === undefined}
              onClick={() => saveLimit(c)}
            >
              {c === 0 ? "Always ask" : `Up to ${creditsToUsd(c)}`}
            </Button>
          ))}
          {settings && !LIMIT_CHOICES.includes(limit) && (
            <Button size="sm" variant="default" disabled>
              Up to {creditsToUsd(limit)}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<Loader2 className="m-6 size-5 animate-spin text-muted-foreground" />}>
      <Approvals />
    </Suspense>
  );
}
