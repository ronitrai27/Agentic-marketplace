"use client";

import React, { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, Loader2, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const TTL_CHOICES = [60, 90, 180, 300] as const;
const TTL_PREF = "catelog:test-token-ttl";

interface Minted {
  token: string;
  expiresAt: number;
  publicKey: string;
}

function fmt(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={label}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/**
 * Creates short-lived test tokens. Used in Credentials and inside the
 * register flow. Reports the live token (or null once expired) to the parent.
 */
export function TestTokenPanel({
  onTokenChange,
  disabled,
}: {
  onTokenChange?: (token: string | null) => void;
  disabled?: boolean;
}) {
  const [ttl, setTtl] = useState<number>(180);
  const [minted, setMinted] = useState<Minted | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState(false);

  // The expiry is a preference, not a secret.
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(TTL_PREF));
      if ((TTL_CHOICES as readonly number[]).includes(saved)) setTtl(saved);
    } catch {
      // storage unavailable
    }
  }, []);

  useEffect(() => {
    if (!minted) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [minted]);

  const remaining = minted ? minted.expiresAt - now : 0;
  const live = !!minted && remaining > 0;

  useEffect(() => {
    onTokenChange?.(live ? minted!.token : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, minted]);

  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      // Minting is harmless to repeat, so one quick retry hides a transient server hiccup.
      let res!: Response;
      let data: any = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        res = await fetch("/api/test-tokens", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ttlSec: ttl }),
        });
        data = await res.json().catch(() => null); // empty/non-JSON body on a server error
        if (res.ok || res.status < 500) break;
        await new Promise((r) => setTimeout(r, 600));
      }
      if (!res.ok) {
        throw new Error(
          data?.error ??
            (res.status >= 500
              ? "The server had a temporary problem. Please try again."
              : "Could not create a token."),
        );
      }
      setNow(Date.now());
      setReveal(false);
      setMinted(data as Minted);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a token.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(ttl)}
          onValueChange={(v) => {
            const n = Number(v);
            setTtl(n);
            try {
              localStorage.setItem(TTL_PREF, String(n));
            } catch {
              // ignore
            }
          }}
          disabled={busy || disabled}
        >
          <SelectTrigger className="w-40">
            <Timer className="size-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TTL_CHOICES.map((t) => (
              <SelectItem key={t} value={String(t)}>
                Expires in {t}s
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          size="sm"
          onClick={generate}
          disabled={busy || disabled}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {live ? "Generate new token" : minted ? "Generate again" : "Generate test token"}
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {minted && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
            <code className="flex-1 min-w-0 truncate text-[11px] font-mono text-foreground">
              {reveal ? minted.token : "cat_test_" + "•".repeat(24)}
            </code>
            <button
              type="button"
              title={reveal ? "Hide" : "Show"}
              onClick={() => setReveal(!reveal)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
            <CopyButton text={minted.token} label="Copy token" />
            <span
              className={`text-[11px] font-mono tabular-nums ${
                live ? "text-green-600 dark:text-green-400" : "text-destructive"
              }`}
            >
              {live ? fmt(remaining) : "Expired"}
            </span>
          </div>
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            <p>Your agent must have set its public key to accept test tokens.</p>
          </div>
        </div>
      )}
    </div>
  );
}
