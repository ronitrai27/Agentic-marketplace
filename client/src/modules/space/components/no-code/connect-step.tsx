"use client";

import React, { useState } from "react";
import Image from "next/image";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  Check,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Link2,
  Loader2,
} from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import { SectionHeading } from "../section-heading";

export const HEADER_NAME = "X-Marketplace-Key";
const DAY = 24 * 60 * 60 * 1000;

const EXPIRY = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "Never", days: null },
] as const;

/** Problem with the webhook URL, or null when it looks right. */
export function webhookUrlProblem(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "That is not a valid URL.";
  }
  if (u.protocol !== "https:") return "Use the https:// Production URL.";
  if (/^\/(workflow|home|projects)\b/.test(u.pathname)) {
    return "That is the n8n editor page. Open the Webhook node and copy its Production URL (it contains /webhook/).";
  }
  if (!u.pathname.includes("/webhook/") && !u.pathname.includes("/webhook-test/")) {
    return "A webhook URL contains /webhook/. Copy the Production URL from your Webhook node.";
  }
  if (u.pathname.includes("/webhook-test/")) {
    return "This is the n8n Test URL. Publish the workflow and copy the Production URL.";
  }
  return null;
}

function CopyChip({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground shadow-2xs hover:border-foreground/40 cursor-pointer"
    >
      {label ?? text}
      {copied ? <Check className="size-3" /> : <Copy className="size-3 text-muted-foreground" />}
    </button>
  );
}

/** The creator's X-Marketplace-Key: create it here if missing, otherwise reveal / copy it. */
function KeyCard() {
  const authKey = useQuery(api.apiKeys.getAuthKey);
  const createAuthKey = useAction(api.apiKeysActions.createAuthKey);
  const revealAuthKey = useAction(api.apiKeysActions.revealAuthKey);
  const [expiry, setExpiry] = useState<number | null>(90);
  const [raw, setRaw] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (raw) return raw;
    const { rawKey } = await revealAuthKey();
    setRaw(rawKey);
    return rawKey;
  };

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught Error:\s*/, "").split("\n")[0] : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  if (authKey === undefined) {
    return <div className="h-28 animate-pulse rounded-lg border border-border bg-muted/40" />;
  }

  if (authKey === null) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">You don&apos;t have a marketplace key yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Create one. You can see and copy it again any time from API Keys.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            {EXPIRY.map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => setExpiry(o.days)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                  expiry === o.days ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              guard(async () => {
                await createAuthKey({ expiresAt: expiry === null ? undefined : Date.now() + expiry * DAY });
                await load();
                setVisible(true);
                toast.success("Marketplace key created");
              })
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90 disabled:opacity-50 cursor-pointer"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
            Create key
          </button>
        </div>
      </div>
    );
  }

  const expired = !!authKey.expiresAt && authKey.expiresAt <= Date.now();
  const days = authKey.expiresAt ? Math.ceil((authKey.expiresAt - Date.now()) / DAY) : null;

  return (
    <div className="rounded-lg border border-border bg-card shadow-2xs">
      <div className="flex items-center gap-2 p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
          <KeyRound className="size-4 text-foreground" />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground select-all">
          {visible && raw ? raw : authKey.previewKey}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            guard(async () => {
              if (!visible) await load();
              setVisible((v) => !v);
            })
          }
          title={visible ? "Hide key" : "Show key"}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
        >
          {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            guard(async () => {
              await navigator.clipboard.writeText(await load());
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
          title="Copy key"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
        >
          {copied ? <Check className="size-3.5 text-foreground" /> : <Copy className="size-3.5" />}
        </button>
      </div>
      <div className="flex items-center justify-between border-t border-border/70 bg-muted/20 px-3 py-2 text-[11px]">
        <span className={expired ? "font-medium text-destructive" : "text-muted-foreground"}>
          {expired ? "Expired: rotate it in API Keys" : days === null ? "Never expires" : `Expires in ${days} days`}
        </span>
        <a href="/space/creator/credentials" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
          Manage in API Keys
        </a>
      </div>
    </div>
  );
}

const SETUP = [
  {
    title: "Secure the Webhook node",
    body: (
      <>
        Set <b className="font-medium text-foreground">Authentication</b> to{" "}
        <b className="font-medium text-foreground">Header Auth</b> and create a credential:
      </>
    ),
    extra: true,
  },
  {
    title: "Answer with JSON",
    body: (
      <>
        Set the Webhook to respond using a <b className="font-medium text-foreground">Respond to Webhook</b> node that returns a JSON object.
      </>
    ),
  },
  {
    title: "Publish the workflow",
    body: (
      <>
        Then copy the <b className="font-medium text-foreground">Production URL</b> (not the Test URL).
      </>
    ),
  },
];

export function ConnectStep({
  url,
  onUrlChange,
}: {
  url: string;
  onUrlChange: (u: string) => void;
}) {
  const problem = webhookUrlProblem(url);
  return (
    <div className="space-y-8 pb-4">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md border border-border bg-background shadow-2xs">
          <Image src="/n8n-color.svg" alt="n8n" width={22} height={22} className="h-5 w-auto" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">Connect your n8n workflow</h2>
          <p className="text-xs text-muted-foreground">
            The marketplace calls your webhook with a secret header, so only it can run your workflow.
          </p>
        </div>
      </div>

      <section className="space-y-4 border-b border-border pb-8">
        <SectionHeading icon={KeyRound} title="Your marketplace key">
          Sent as the <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">{HEADER_NAME}</code> header on every call.
        </SectionHeading>
        <KeyCard />

        <ol className="relative space-y-4 pl-1">
          {SETUP.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold text-foreground shadow-2xs">
                {i + 1}
              </span>
              <div className="min-w-0 space-y-1.5 pt-0.5">
                <p className="text-sm font-medium text-foreground">{s.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.body}</p>
                {s.extra && (
                  <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted/30 p-2.5 text-[11px]">
                    <span className="text-muted-foreground">Name</span>
                    <span>
                      <CopyChip text={HEADER_NAME} />
                    </span>
                    <span className="text-muted-foreground">Value</span>
                    <span className="text-muted-foreground">Your marketplace key above</span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <SectionHeading icon={Link2} title="Webhook URL">
          Paste the Production URL of your published workflow.
        </SectionHeading>
        <div
          className={`relative flex items-center rounded-lg border bg-background p-1 pl-3 shadow-2xs transition-all focus-within:ring-2 focus-within:ring-foreground/10 ${
            problem ? "border-destructive/60" : "border-zinc-300 focus-within:border-foreground dark:border-zinc-700"
          }`}
        >
          <Globe className="mr-2.5 size-4 shrink-0 text-muted-foreground" />
          <input
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://you.app.n8n.cloud/webhook/lead-email-writer"
            spellCheck={false}
            autoComplete="off"
            className="h-9 flex-1 border-none bg-transparent pr-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 sm:text-sm"
          />
          {url.trim() && !problem && (
            <span className="mr-2 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-foreground">
              <Check className="size-3" />
              Looks right
            </span>
          )}
        </div>
        {problem && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <CircleAlert className="size-3.5" />
            {problem}
          </p>
        )}
      </section>
    </div>
  );
}
