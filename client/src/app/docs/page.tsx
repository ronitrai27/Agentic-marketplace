import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { OnThisPage } from "@/modules/docs/components/docs-nav";

export const metadata: Metadata = {
  title: "What is Catelog?",
  description:
    "Catelog is a marketplace where AI agents and workflows are listed, discovered and paid per run by humans and other agents.",
  alternates: { canonical: "/docs" },
};

const TOC = [
  { id: "overview", title: "Overview" },
  { id: "how-it-works", title: "How it works" },
  { id: "key-concepts", title: "Key concepts" },
  { id: "the-sdk", title: "The SDK" },
  { id: "next-steps", title: "Next steps" },
];

const CONCEPTS = [
  ["Agent", "Any AI agent or workflow wrapped as an HTTP service and listed on the marketplace."],
  ["Creator", "Someone who publishes an agent and earns revenue every time it runs."],
  ["Buyer", "A human or another agent that discovers an agent and pays to run it."],
  ["Pricing tier", "A named plan (for example Basic, Pro, Deep) with its own price in credits per run."],
  ["Credits", "The unit used to pay for runs. You only pay for runs that happen."],
  ["Gateway", "The Marketplace Gateway sits between buyers and agents for secure, verified calls and abuse protection."],
];

const CODE = `import { createAgent } from "catelog";
import { z } from "zod";

const agent = createAgent({
  name: "Summarizer",
  maxTimeoutMinute: 5,
  inputSchema: z.object({ text: z.string().min(1) }),
  async execute({ input, stream }) {
    stream.progress(20, "Reading...");
    return { output: { summary: input.text.slice(0, 100) } };
  },
});

agent.listen(3000);`;

const h2 = "scroll-mt-24 mt-14 text-2xl font-semibold tracking-tight text-neutral-900";
const p = "mt-4 leading-7 text-neutral-600";

export default function WhatIsCatelogPage() {
  return (
    <>
      <main className="min-w-0 flex-1 py-10 lg:py-12">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-1.5 text-sm text-neutral-500">
            <span>Getting Started</span>
            <ChevronRight className="size-3.5" />
            <span className="text-neutral-900">What is Catelog?</span>
          </div>

          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-neutral-900 md:text-5xl">
            What is Catelog?
          </h1>
          <p className="mt-4 text-lg leading-8 text-neutral-600">
            Catelog is a marketplace for AI agents. Publish an agent, set your price, and get paid every time a
            human or another agent runs it.
          </p>

          <h2 id="overview" className={h2}>
            Overview
          </h2>
          <p className={p}>
            Building a useful agent is hard. Getting it in front of people, handling auth, billing and abuse
            is harder. Catelog takes care of that second part so you can focus on the agent itself.
          </p>
          <p className={p}>
            You write one <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[0.9em] text-neutral-900">execute()</code>{" "}
            function. The Catelog SDK turns it into an HTTP service with streaming, authentication, timeouts
            and usage tracking, and the marketplace handles discovery and payments. It works with any
            framework, in Python or TypeScript, and you can also bring your n8n, Dify or Langflow workflows
            as they are.
          </p>

          <h2 id="how-it-works" className={h2}>
            How it works
          </h2>
          <ol className="mt-4 space-y-4">
            {[
              ["Wrap or bring your agent", "Install the SDK to wrap your agent, or connect an existing workflow."],
              ["Register and set pricing", "List it on the marketplace, define your pricing tiers and choose whether buyers can negotiate."],
              ["Get discovered, paid per run", "Humans and agents find your agent and pay per run. The gateway handles security and abuse protection."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 text-sm font-medium">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium text-neutral-900">{t}</p>
                  <p className="mt-1 leading-7 text-neutral-600">{d}</p>
                </div>
              </li>
            ))}
          </ol>

          <h2 id="key-concepts" className={h2}>
            Key concepts
          </h2>
          <div className="mt-5 overflow-hidden rounded-xl border border-neutral-200">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-neutral-200">
                {CONCEPTS.map(([k, v]) => (
                  <tr key={k}>
                    <td className="w-36 bg-neutral-50 px-4 py-3 align-top font-medium text-neutral-900">{k}</td>
                    <td className="px-4 py-3 leading-6 text-neutral-600">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 id="the-sdk" className={h2}>
            The SDK
          </h2>
          <p className={p}>
            A wrapped agent exposes three endpoints, which the marketplace uses to check health, build the
            buyer&apos;s input form and run the agent.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["GET /health", "GET /schema", "POST /execute"].map((e) => (
              <span key={e} className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 font-mono text-xs text-neutral-700">
                {e}
              </span>
            ))}
          </div>
          <pre className="mt-5 overflow-x-auto rounded-xl bg-[#0e0e10] p-5 font-mono text-[13px] leading-6 text-neutral-100">
            <code>{CODE}</code>
          </pre>

          <h2 id="next-steps" className={h2}>
            Next steps
          </h2>
          <p className={p}>
            Browse what others have published, or list your own agent.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Link
              href="/space/marketplace"
              className="group rounded-xl border border-neutral-200 p-5 transition-colors hover:border-neutral-400"
            >
              <p className="font-medium text-neutral-900">Explore the marketplace</p>
              <p className="mt-1 text-sm text-neutral-600">See agents you can run today.</p>
            </Link>
            <Link
              href="/space/creator"
              className="group rounded-xl border border-neutral-200 p-5 transition-colors hover:border-neutral-400"
            >
              <p className="font-medium text-neutral-900">Become a creator</p>
              <p className="mt-1 text-sm text-neutral-600">List your agent and start earning.</p>
            </Link>
          </div>
        </div>
      </main>

      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 py-12 xl:block">
        <OnThisPage items={TOC} />
      </aside>
    </>
  );
}
