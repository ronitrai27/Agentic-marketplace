"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Check, Loader2, Search, FileJson, Wallet } from "lucide-react";

const SCOPE_LABELS: Record<string, string> = {
  "wallet:read": "View your wallet balance",
  openid: "Know who you are",
  profile: "See your name",
  email: "See your email",
  offline_access: "Stay connected until you disconnect",
};

const TOOLS = [
  { name: "get_wallet_info", label: "Wallet info", desc: "Check your credit balance, escrow and what you can withdraw.", icon: Wallet },
  { name: "discover_agents", label: "Discover agents", desc: "Search the marketplace for agents that fit a task.", icon: Search },
  { name: "get_agents_schema", label: "Agent schemas", desc: "Read an agent's input, output, pricing and limits.", icon: FileJson },
];

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
      <p className="rounded-xl bg-white/90 p-4 text-sm text-neutral-600">
        This authorization link is invalid or expired.
      </p>
    );
  }

  return (
    <div className="w-full max-w-md rounded-3xl border border-black/5 bg-white/90 p-7 text-neutral-900 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.25)] backdrop-blur-xl">
      <div className="mb-5 flex flex-col items-center text-center">
        <Image src="/logo.svg" alt="Catelog" width={96} height={30} priority className="mb-4 h-9 w-auto object-contain" />
        <h1 className="text-xl font-semibold tracking-tight">Connect to Catelog</h1>
        <p className="mt-1 text-sm text-neutral-500">
          <span className="font-medium text-neutral-900">{clientName ?? "An application"}</span>{" "}
          wants to use your Catelog account.
        </p>
      </div>

      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
        Tools it can use
      </p>
      <ul className="mb-5 space-y-2">
        {TOOLS.map(({ name, label, desc, icon: Icon }) => (
          <li key={name} className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-neutral-200">
              <Icon className="size-4 text-neutral-700" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{label}</span>
                <code className="rounded bg-neutral-200/70 px-1.5 py-0.5 text-[10px] text-neutral-600">{name}</code>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">{desc}</p>
            </div>
          </li>
        ))}
      </ul>

      {scopes.length > 0 && (
        <ul className="mb-5 space-y-1.5 text-xs text-neutral-600">
          {scopes.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <Check className="size-3.5 shrink-0 text-emerald-600" />
              {SCOPE_LABELS[s] ?? s}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => decide(false)}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-neutral-300 bg-white text-sm font-medium text-neutral-800 transition hover:bg-neutral-100 disabled:opacity-60"
        >
          {busy === "deny" && <Loader2 className="mr-2 size-4 animate-spin" />}
          Deny
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => decide(true)}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-neutral-900 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60"
        >
          {busy === "allow" && <Loader2 className="mr-2 size-4 animate-spin" />}
          Allow
        </button>
      </div>
      <p className="mt-4 text-center text-xs text-neutral-400">
        You can disconnect this application at any time from your Catelog settings.
      </p>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <main
      style={{ colorScheme: "light" }}
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white p-6"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=2000&q=80"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-white via-white/70 to-white/10" />
      <div className="relative z-10 flex w-full justify-center">
        <Suspense fallback={<Loader2 className="size-5 animate-spin text-neutral-500" />}>
          <Consent />
        </Suspense>
      </div>
    </main>
  );
}
