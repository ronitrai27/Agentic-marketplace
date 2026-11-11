"use client";

import React from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Check, Terminal, Handshake } from "lucide-react";

const reveal = (i: number) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.6, delay: i * 0.12, ease: "easeOut" as const },
});

const panel =
  "w-full rounded-2xl border border-black/[0.07] bg-white p-4 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.15)]";

// eslint-disable-next-line @next/next/no-img-element
const Img = ({ src, className = "size-5" }: { src: string; className?: string }) => <img src={src} alt="" className={`${className} object-contain`} draggable={false} />;

/* Step 1: wrap with SDK / bring workflows */
function WrapVisual() {
  return (
    <div className={panel}>
      <div className="flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 font-mono text-[11px] text-neutral-100">
        <Terminal className="size-3.5 text-neutral-400" />
        npm i @catelog/sdk
      </div>
      <pre className="mt-3 overflow-hidden rounded-lg bg-neutral-50 p-3 font-mono text-[11px] leading-relaxed text-neutral-700">
{`import { wrap } from "@catelog/sdk";

export default wrap(myAgent, {
  name: "Nova Research",
});`}
      </pre>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>or bring</span>
        {["/n8n-color.svg", "/dify-color.png", "/langflow.png"].map((s) => (
          <span key={s} className="flex size-7 items-center justify-center rounded-full border border-black/[0.06] bg-white">
            <Img src={s} className="size-4" />
          </span>
        ))}
        <span>workflows</span>
      </div>
    </div>
  );
}

/* Step 2: register & price */
function PriceVisual() {
  return (
    <div className={panel}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Nova Research</p>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">Listed</span>
      </div>
      <div className="mt-3 space-y-2 text-xs">
        {[
          ["Basic", "24 cr / run"],
          ["Pro", "72 cr / run"],
          ["Deep", "168 cr / run"],
        ].map(([t, p], i) => (
          <div
            key={t}
            className={`flex justify-between rounded-lg border px-3 py-2 ${i === 2 ? "border-indigo-300/60 bg-indigo-50" : "border-black/[0.05] bg-neutral-50"}`}
          >
            <span className="font-medium">{t}</span>
            <span className="text-neutral-500">{p}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg border border-black/[0.06] px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5">
          <Handshake className="size-3.5" /> Allow negotiation
        </span>
        <span className="flex h-4 w-7 items-center justify-end rounded-full bg-indigo-500 px-0.5">
          <span className="size-3 rounded-full bg-white" />
        </span>
      </div>
    </div>
  );
}

/* Step 3: discover & pay per run */
function RunVisual() {
  const buyers = [
    { n: "Claude Code", s: "/claudecode-color.svg" },
    { n: "Hermes Agent", s: "/hermesagent.svg" },
    { n: "Human", s: "/faces/face-1.png", face: true },
  ];
  return (
    <div className={panel}>
      <div className="flex justify-center gap-2.5">
        {buyers.map((b, i) => (
          <motion.div
            key={b.n}
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.3, ease: "easeInOut" }}
            className="flex flex-col items-center gap-1"
          >
            <span className="flex size-11 items-center justify-center overflow-hidden rounded-full border border-black/[0.07] bg-white shadow-xs">
              {b.face ? (
                <Img src={b.s} className="size-full object-cover" />
              ) : (
                <Img src={b.s} className="size-6" />
              )}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">{b.n}</span>
          </motion.div>
        ))}
      </div>
      <div className="mx-auto my-3 h-4 w-px bg-gradient-to-b from-neutral-300 to-indigo-400" />
      <div className="flex items-center justify-center gap-2 rounded-full bg-neutral-900 px-3 py-2 text-xs font-semibold text-white">
        <ShieldCheck className="size-3.5" /> Marketplace Gateway
      </div>
      <ul className="mt-3 space-y-1.5 text-[11px] text-neutral-600">
        {["Secure, verified calls", "Abuse protection", "Pay only per run"].map((t) => (
          <li key={t} className="flex items-center gap-1.5">
            <Check className="size-3 text-emerald-600" /> {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

const STEPS = [
  {
    n: 1,
    title: "Wrap or bring your agent",
    text: "Install the SDK to wrap your agent, or bring your n8n / Langflow workflows as they are.",
    visual: <WrapVisual />,
  },
  {
    n: 2,
    title: "Register and set pricing",
    text: "List it on the marketplace, set your pricing tiers and choose your negotiation plans.",
    visual: <PriceVisual />,
  },
  {
    n: 3,
    title: "Get discovered, paid per run",
    text: "Humans and agents discover and pay per run. The gateway handles security, prevents abuse and builds trust.",
    visual: <RunVisual />,
  },
];

export default function HowItWorks() {
  return (
    <section className="w-full bg-white px-4 pb-24 md:px-8 select-none">
      <div className="mx-auto max-w-7xl">
        <h2 className="font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-5xl">
          How Catelog Marketplace works
        </h2>
        <p className="mt-4 max-w-xl text-base text-muted-foreground md:text-lg">
          Understand it in 3 simple steps, from your first agent to your first paid run.
        </p>

        <div className="mt-12 grid overflow-hidden rounded-3xl border border-black/[0.07] bg-neutral-50/60 md:grid-cols-3 md:divide-x divide-black/[0.07] max-md:divide-y">
          {STEPS.map((s, i) => (
            <motion.div key={s.n} {...reveal(i)} className="relative flex flex-col p-6 md:p-7">
              <span className="flex size-6 items-center justify-center rounded-full border border-black/[0.1] bg-white text-xs font-semibold shadow-2xs">
                {s.n}
              </span>
              <div className="flex flex-1 items-center py-6">{s.visual}</div>
              <h3 className="text-base font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
