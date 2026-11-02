"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

const SCOPE_LABELS: Record<string, string> = {
  "wallet:read": "View your wallet balance",
  openid: "Know who you are",
  profile: "See your name",
  email: "See your email",
  offline_access: "Stay connected until you disconnect",
};

function Consent() {
  const params = useSearchParams();
  const consentCode = params.get("consent_code");
  const clientId = params.get("client_id");
  const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);

  const [clientName, setClientName] = useState<string | null>(null);
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    fetch(`/api/auth/oauth2/client/${encodeURIComponent(clientId)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setClientName(c?.name ?? null))
      .catch(() => {});
  }, [clientId]);

  async function decide(accept: boolean) {
    setBusy(accept ? "allow" : "deny");
    setError(null);
    try {
      const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, consent_code: consentCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.redirectURI) {
        throw new Error(data.message ?? "Request failed");
      }
      window.location.href = data.redirectURI;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(null);
    }
  }

  if (!consentCode) {
    return (
      <p className="text-sm text-muted-foreground">
        This authorization link is invalid or expired.
      </p>
    );
  }

  return (
    <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <ShieldCheck className="size-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Connect to Catelog</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {clientName ?? "An application"}
            </span>{" "}
            wants to act on your behalf.
          </p>
        </div>
      </div>

      <ul className="mb-6 space-y-2 rounded-xl bg-muted/50 p-4 text-sm">
        {scopes.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <Wallet className="size-4 shrink-0 text-muted-foreground" />
            {SCOPE_LABELS[s] ?? s}
          </li>
        ))}
      </ul>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          disabled={!!busy}
          onClick={() => decide(false)}
        >
          {busy === "deny" && <Loader2 className="mr-2 size-4 animate-spin" />}
          Deny
        </Button>
        <Button
          className="flex-1"
          disabled={!!busy}
          onClick={() => decide(true)}
        >
          {busy === "allow" && (
            <Loader2 className="mr-2 size-4 animate-spin" />
          )}
          Allow
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        You can disconnect this application at any time from your Catelog
        settings.
      </p>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense fallback={<Loader2 className="size-5 animate-spin" />}>
        <Consent />
      </Suspense>
    </main>
  );
}
