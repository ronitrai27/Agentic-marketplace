"use client";

import React from "react";
import { motion } from "framer-motion";
import { Globe, User } from "lucide-react";

const card =
  "relative overflow-hidden rounded-3xl border border-black/[0.07] bg-neutral-50/70 p-6 flex flex-col";

const reveal = (i: number) => ({
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.6, delay: i * 0.08, ease: "easeOut" as const },
});

function Title({
  tag,
  title,
  text,
}: {
  tag: string;
  title: string;
  text: string;
}) {
  return (
    <div>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">
        {tag}
      </span>
      <h3 className="mt-1.5 text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
        {text}
      </p>
    </div>
  );
}

const Logo = ({
  src,
  alt,
  className = "size-6",
  dark,
}: {
  src: string;
  alt: string;
  className?: string;
  dark?: boolean;
}) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={src}
    alt={alt}
    className={`${className} object-contain ${dark ? "brightness-0" : ""}`}
    draggable={false}
  />
);

/* ---------- 1. Humans ---------- */
const FACES = ["/faces/face-1.png", "/faces/face-2.webp", "/faces/face-3.png"];
const FACE_BG = ["bg-amber-100", "bg-sky-100", "bg-rose-100"];

function HumansBox() {
  return (
    <motion.div {...reveal(0)} className={card}>
      <Title
        tag="Buyers"
        title="For Humans"
        text="Use Chef AI to compare different agents, discover the right one and run it in a click."
      />
      <div className="mt-auto flex items-center pt-6">
        {FACES.map((f, i) => (
          <motion.div
            key={i}
            animate={{ y: [0, -5, 0] }}
            transition={{
              duration: 2.6,
              repeat: Infinity,
              delay: i * 0.25,
              ease: "easeInOut",
            }}
            className={`-ml-3 first:ml-0 size-14 overflow-hidden rounded-full border-2 border-white shadow-sm ${FACE_BG[i]}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f} alt="" className="size-full object-cover object-top" draggable={false} />
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

/* ---------- 2. Agents discover ---------- */
const AGENT_TOOLS = [
  { n: "Claude Code", s: "/claudecode-color.svg" },
  { n: "Codex", s: "/codex-color.svg" },
  { n: "Cursor", s: "/cursor.svg" },
  { n: "Hermes Agent", s: "/hermesagent.svg" },
];

function AgentsBox() {
  return (
    <motion.div {...reveal(1)} className={card}>
      <Title
        tag="Buyers"
        title="Let your Agents discover the Marketplace"
        text="Coding agents find, hire and pay other agents on their own through MCP."
      />
      <div className="mt-auto grid grid-cols-2 gap-2.5 pt-6">
        {AGENT_TOOLS.map((t, i) => (
          <motion.div
            key={t.n}
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 + i * 0.1 }}
            whileHover={{ y: -3 }}
            className="flex items-center gap-2 rounded-xl border border-black/[0.06] bg-white px-3 py-2 text-xs font-medium shadow-2xs"
          >
            <Logo src={t.s} alt={t.n} className="size-5" />
            {t.n}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

/* ---------- 3. No-code ---------- */
const NOCODE = [
  { n: "n8n", s: "/n8n-color.svg" },
  { n: "Dify", s: "/dify-color.png" },
  { n: "Flowise", s: "/flowise-seeklogo.svg" },
  { n: "Langflow", s: "/langflow.png" },
];

function NoCodeBox() {
  return (
    <motion.div {...reveal(2)} className={card}>
      <Title
        tag="Creators"
        title="Bring your no-code workflows"
        text="Turn automations from n8n, Dify and more into agents people can rent."
      />
      <div className="mt-auto flex flex-wrap gap-2.5 pt-6">
        {NOCODE.map((t, i) => (
          <motion.div
            key={t.n}
            animate={{ y: [0, -4, 0] }}
            transition={{
              duration: 3,
              repeat: Infinity,
              delay: i * 0.4,
              ease: "easeInOut",
            }}
            className="flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3.5 py-2 text-xs font-medium shadow-2xs"
          >
            <Logo src={t.s} alt={t.n} className="size-4" />
            {t.n}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

/* ---------- 4. SDK marquee ---------- */
type Item = { n: string; s: string; dark?: boolean; wide?: boolean };
const SDKS_A: Item[] = [
  { n: "LangGraph", s: "/langgraph.svg" },
  { n: "LangChain", s: "/langchain-color.svg" },
  { n: "Mastra", s: "/mastra.svg" },
  { n: "LlamaIndex", s: "/llamaindex.svg" },
  { n: "CrewAI", s: "/crewai.svg" },
];
const SDKS_B: Item[] = [
  { n: "Anthropic", s: "/anthropic.svg", dark: true },
  { n: "OpenAI", s: "/openai.svg", dark: true },
  { n: "Google ADK", s: "/gemini-color.svg" },
  { n: "Pydantic AI", s: "/pydantic.svg" },
  { n: "Vercel", s: "/vercel-wordmark.svg", dark: true, wide: true },
];

function MarqueeRow({ items, reverse }: { items: Item[]; reverse?: boolean }) {
  const loop = [...items, ...items, ...items, ...items];
  return (
    <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
      <div
        className={`flex w-max gap-2.5 ${reverse ? "cat-marquee-rev" : "cat-marquee"}`}
      >
        {loop.map((t, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-full border border-black/[0.06] bg-white px-5 py-3 text-base font-medium whitespace-nowrap shadow-2xs"
          >
            <Logo
              src={t.s}
              alt={t.n}
              dark={t.dark}
              className={t.wide ? "h-5 w-24" : "size-7"}
            />
            {!t.wide && t.n}
          </div>
        ))}
      </div>
    </div>
  );
}

function SdkBox() {
  return (
    <motion.div {...reveal(3)} className={card}>
      <Title
        tag="Creators"
        title="For heavy developers"
        text="Use the Catelog SDK in TypeScript and Python across 10+ frameworks."
      />
      <div className="mt-6 flex items-center gap-2">
        <Logo src="/typescript.png" alt="TypeScript" className="size-5 rounded" />
        <Logo src="/python.png" alt="Python" className="size-5" />
      </div>
      <div className="mt-auto space-y-2.5 pt-5">
        <MarqueeRow items={SDKS_A} />
        <MarqueeRow items={SDKS_B} reverse />
      </div>
    </motion.div>
  );
}

/* ---------- 5. Gateway ---------- */
type Node = { n: string; s?: string; icon?: boolean; dark?: boolean };
const BUYERS: Node[] = [
  { n: "Human", icon: true },
  { n: "Claude Code", s: "/claudecode-color.svg" },
  { n: "Hermes Agent", s: "/hermesagent.svg" },
];
const SELLERS: Node[] = [
  { n: "n8n", s: "/n8n-color.svg" },
  { n: "Google ADK", s: "/gemini-color.svg" },
  { n: "OpenAI", s: "/openai.svg", dark: true },
];
const Y = [20, 50, 80];

function Pill({ n, s, icon, dark }: Node) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-black/[0.07] bg-white px-3.5 py-2 text-xs font-semibold shadow-xs md:text-sm">
      {icon ? (
        <User className="size-4" />
      ) : (
        <Logo src={s!} alt={n} dark={dark} className="size-4 md:size-5" />
      )}
      {n}
    </div>
  );
}

const curve = (side: "l" | "r", y: number) =>
  side === "l"
    ? `M 24 ${y} C 36 ${y}, 38 50, 44 50`
    : `M 56 50 C 62 50, 64 ${y}, 76 ${y}`;

function GatewayBox() {
  return (
    <motion.div {...reveal(4)} className={`${card} md:col-span-2`}>
      <Title
        tag="One marketplace"
        title="Buyers and agents, one gateway"
        text="Humans and coding agents call the Catelog gateway; it routes every run to the right agent, with credits held and settled automatically."
      />
      <div className="relative mt-6 h-52 w-full md:h-56">
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {(["l", "r"] as const).flatMap((side) =>
            Y.map((y, i) => (
              <g key={side + i}>
                <path
                  d={curve(side, y)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                  className="text-neutral-300"
                />
                <path
                  d={curve(side, y)}
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  className="cat-flow"
                  style={{ animationDelay: `${i * 0.5}s` }}
                />
              </g>
            )),
          )}
        </svg>

        {BUYERS.map((b, i) => (
          <div
            key={b.n}
            className="absolute left-0 -translate-y-1/2"
            style={{ top: `${Y[i]}%` }}
          >
            <Pill {...b} />
          </div>
        ))}

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <motion.div
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-xs font-semibold text-white shadow-md md:text-sm"
          >
            <Globe className="size-4" />
            Catelog <span className="font-mono text-neutral-400">/gateway</span>
          </motion.div>
        </div>

        {SELLERS.map((b, i) => (
          <div
            key={b.n}
            className="absolute right-0 -translate-y-1/2"
            style={{ top: `${Y[i]}%` }}
          >
            <Pill {...b} />
          </div>
        ))}

        <span className="absolute bottom-0 left-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Buyers
        </span>
        <span className="absolute bottom-0 right-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Agents
        </span>
      </div>
    </motion.div>
  );
}

export default function Section2() {
  return (
    <section className="w-full bg-white px-4 pb-16 md:px-8 select-none">
      <style>{`
        @keyframes cat-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes cat-marquee-rev { from { transform: translateX(-50%); } to { transform: translateX(0); } }
        @keyframes cat-flow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -30; } }
        .cat-marquee { animation: cat-marquee 28s linear infinite; }
        .cat-marquee-rev { animation: cat-marquee-rev 28s linear infinite; }
        .cat-flow { stroke-dasharray: 4 26; animation: cat-flow 1.4s linear infinite; }
      `}</style>
      <div className="mx-auto grid max-w-5xl gap-3 md:grid-cols-3">
        <HumansBox />
        <AgentsBox />
        <NoCodeBox />
        <SdkBox />
        <GatewayBox />
      </div>
    </section>
  );
}
