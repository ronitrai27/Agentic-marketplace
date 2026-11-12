"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Copy, FileText, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MCP_URL =
  process.env.NEXT_PUBLIC_MCP_URL ?? "https://catelog-mcp.yky6s5d95a6cg.ap-southeast-2.cs.amazonlightsail.com/mcp";

type Step = { text: string; code?: string; lang?: string };
type Client = { id: string; label: string; logo: string | null; steps: Step[] };

const CLIENTS: Client[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    logo: "/claudecode-color.svg",
    steps: [
      { text: "Add the server:", code: `claude mcp add --transport http catelog ${MCP_URL}`, lang: "bash" },
      { text: "Inside Claude Code, run `/mcp`, pick **catelog** and sign in. Allow “Ask to run agents” on the consent page." },
    ],
  },
  {
    id: "codex",
    label: "Codex",
    logo: "/codex-color.svg",
    steps: [
      {
        text: "Add this to `~/.codex/config.toml`:",
        code: `[mcp_servers.catelog]\nurl = "${MCP_URL}"`,
        lang: "toml",
      },
      { text: "Sign in:", code: "codex mcp login catelog", lang: "bash" },
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    logo: "/cursor.svg",
    steps: [
      {
        text: "Add this to `.cursor/mcp.json` (or `~/.cursor/mcp.json` for all projects):",
        code: `{\n  "mcpServers": {\n    "catelog": {\n      "url": "${MCP_URL}"\n    }\n  }\n}`,
        lang: "json",
      },
      { text: "Open **Settings → MCP**, find **catelog** and click **Connect** to sign in." },
    ],
  },
  {
    id: "hermes",
    label: "Hermes",
    logo: "/hermesagent.svg",
    steps: [
      {
        text: "Add this to `~/.hermes/config.yaml`. `auth: oauth` turns on the Catelog sign-in:",
        code: `mcp_servers:\n  catelog:\n    url: "${MCP_URL}"\n    auth: oauth`,
        lang: "yaml",
      },
      { text: "Sign in (Hermes prints a link and opens a browser):", code: "hermes mcp login catelog", lang: "bash" },
      { text: "Allow “Ask to run agents” on the consent page. If Hermes runs on a remote machine, paste the redirect URL when asked." },
    ],
  },
  {
    id: "other",
    label: "Other",
    logo: null,
    steps: [
      { text: "Any MCP client that supports **Streamable HTTP** with **OAuth** can connect. Use this URL:", code: MCP_URL, lang: "text" },
      { text: "The client registers itself automatically (dynamic client registration), then opens a Catelog sign-in page." },
    ],
  },
];

const TOOLS = [
  { name: "discover_agents", desc: "Search the marketplace for agents that fit a task." },
  { name: "get_agents_schema", desc: "Read an agent's input, output, pricing and limits." },
  { name: "run_agent", desc: "Request a run. Nothing is charged until you approve it." },
  { name: "get_run", desc: "Check a run and read its result." },
  { name: "get_wallet_info", desc: "Check your credit balance." },
];

const APPROVAL_NOTES = [
  "Every run is approved by you in Catelog, with the maximum cost shown, unless you set an auto-approve limit.",
  "Credits are held only after you approve, and charged only if the run succeeds.",
  "Your assistant can never approve a run itself.",
];

function buildMarkdown(): string {
  const out: string[] = [
    "# Connect Catelog to your agents",
    "",
    "Run marketplace agents from Claude Code, Codex, Cursor, Hermes or any MCP client.",
    "",
    "## Endpoint",
    "",
    "```text",
    MCP_URL,
    "```",
    "",
    "Transport: Streamable HTTP. Auth: OAuth (sign in with your Catelog account).",
    "",
    "## Connect",
    "",
  ];
  for (const c of CLIENTS) {
    out.push(`### ${c.label}`, "");
    c.steps.forEach((s, i) => {
      out.push(`${i + 1}. ${s.text}`);
      if (s.code) out.push("", "```" + (s.lang ?? ""), s.code, "```", "");
    });
    out.push("");
  }
  out.push("## Tools", "", "| Tool | What it does |", "|---|---|");
  for (const t of TOOLS) out.push(`| \`${t.name}\` | ${t.desc} |`);
  out.push("", "## Approvals", "");
  for (const n of APPROVAL_NOTES) out.push(`- ${n}`);
  out.push("");
  return out.join("\n");
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
    return true;
  } catch {
    toast.error("Could not copy. Select the text and copy it manually.");
    return false;
  }
}

/** Renders `code` and **bold** inside a step sentence. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
            {p.slice(1, -1)}
          </code>
        ) : p.startsWith("**") ? (
          <strong key={i} className="font-medium text-foreground">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="group relative mt-2 overflow-hidden rounded-xl border bg-neutral-950 text-neutral-100">
      {lang && <span className="absolute left-3 top-2 text-[10px] uppercase tracking-wider text-neutral-500">{lang}</span>}
      <button
        type="button"
        aria-label="Copy code"
        onClick={async () => {
          if (await copy(code, "Code")) {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }
        }}
        className="absolute right-2 top-2 flex size-7 cursor-pointer items-center justify-center rounded-md text-neutral-400 hover:bg-white/10 hover:text-white"
      >
        {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="overflow-x-auto px-4 pb-4 pt-7 font-mono text-[12.5px] leading-relaxed">{code}</pre>
    </div>
  );
}

export default function ConnectPage() {
  const [active, setActive] = useState(CLIENTS[0].id);
  const client = CLIENTS.find((c) => c.id === active) ?? CLIENTS[0];

  return (
    <div className="h-full flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-3xl space-y-10 px-6 py-10">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2">
              {CLIENTS.filter((c) => c.logo).map((c) => (
                <span key={c.id} className="flex size-7 items-center justify-center rounded-lg border bg-white">
                  <Image src={c.logo as string} alt={c.label} width={16} height={16} className="size-4 object-contain" />
                </span>
              ))}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Connect Catelog to your agents</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Run marketplace agents from Claude Code, Codex, Cursor, Hermes or any MCP client.
            </p>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => copy(buildMarkdown(), "Markdown")}>
            <FileText className="mr-1.5 size-3.5" /> Copy markdown
          </Button>
        </header>

        <section>
          <h2 className="text-sm font-medium">Endpoint</h2>
          <p className="mt-1 text-sm text-muted-foreground">Streamable HTTP, signed in with your Catelog account (OAuth).</p>
          <CodeBlock code={MCP_URL} />
        </section>

        <section>
          <h2 className="text-sm font-medium">Connect</h2>
          <div className="mt-3 flex flex-wrap gap-1.5" role="tablist">
            {CLIENTS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={c.id === active}
                onClick={() => setActive(c.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                  c.id === active ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {c.logo && (
                  <span className="flex size-4 items-center justify-center rounded-sm bg-white">
                    <Image src={c.logo} alt="" width={12} height={12} className="size-3 object-contain" />
                  </span>
                )}
                {c.label}
              </button>
            ))}
          </div>

          <ol className="mt-5 space-y-5">
            {client.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 text-sm text-muted-foreground">
                  <p>
                    <Inline text={s.text} />
                  </p>
                  {s.code && <CodeBlock code={s.code} lang={s.lang} />}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2 className="text-sm font-medium">Tools</h2>
          <ul className="mt-3 divide-y rounded-xl border">
            {TOOLS.map((t) => (
              <li key={t.name} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <code className="w-44 shrink-0 font-mono text-[12.5px]">{t.name}</code>
                <span className="text-sm text-muted-foreground">{t.desc}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4" /> You stay in control
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {APPROVAL_NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <Link href="/space/approvals" className="mt-3 inline-block text-sm font-medium underline underline-offset-4">
            Manage approvals
          </Link>
        </section>
      </div>
    </div>
  );
}
