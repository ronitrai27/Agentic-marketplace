"use client";

import React from "react";
import { motion } from "framer-motion";
import { Globe } from "lucide-react";

type L = { n: string; s: string; dark?: boolean };

const ROW_A: L[] = [
  { n: "Claude Code", s: "/claudecode-color.svg" },
  { n: "Hermes Agent", s: "/hermesagent.svg" },
  { n: "Codex", s: "/codex-color.svg" },
  { n: "Cursor", s: "/cursor.svg" },
  { n: "n8n", s: "/n8n-color.svg" },
  { n: "Dify", s: "/dify-color.png" },
  { n: "Langflow", s: "/langflow.png" },
  { n: "Flowise", s: "/flowise-seeklogo.svg" },
  { n: "OpenRouter", s: "/openrouter-color.svg" },
  { n: "Ollama", s: "/ollama.svg" },
];

const ROW_B: L[] = [
  { n: "TypeScript SDK", s: "/typescript.png" },
  { n: "Python SDK", s: "/python.png" },
  { n: "LangGraph", s: "/langgraph.svg" },
  { n: "LangChain", s: "/langchain-color.svg" },
  { n: "LlamaIndex", s: "/llamaindex.svg" },
  { n: "CrewAI", s: "/crewai.svg" },
  { n: "Mastra", s: "/mastra.svg" },
  { n: "Pydantic AI", s: "/pydantic.svg" },
  { n: "Anthropic", s: "/anthropic.svg", dark: true },
  { n: "OpenAI", s: "/openai.svg", dark: true },
  { n: "Google ADK", s: "/gemini-color.svg" },
  { n: "Meta", s: "/meta-color.svg" },
  { n: "Mistral", s: "/mistral-color.svg" },
  { n: "Groq", s: "/groq.svg" },
];

function Row({ items, reverse }: { items: L[]; reverse?: boolean }) {
  const loop = [...items, ...items];
  return (
    <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      <div
        className={`flex w-max gap-4 py-2 ${reverse ? "cat-int-rev" : "cat-int"}`}
      >
        {loop.map((l, i) => (
          <div
            key={i}
            title={l.n}
            className="flex size-20 shrink-0 items-center justify-center rounded-2xl border border-black/[0.05] bg-white shadow-[0_6px_20px_-8px_rgba(0,0,0,0.18)] transition-transform hover:-translate-y-1 md:size-24"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={l.s}
              alt={l.n}
              draggable={false}
              className={`size-9 object-contain md:size-11 ${l.dark ? "brightness-0" : ""}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Integrations() {
  return (
    <section className="relative w-full overflow-hidden bg-white px-4 pb-24 select-none">
      <style>{`
        @keyframes cat-int { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes cat-int-rev { from { transform: translateX(-50%); } to { transform: translateX(0); } }
        .cat-int { animation: cat-int 45s linear infinite; }
        .cat-int-rev { animation: cat-int-rev 50s linear infinite; }
      `}</style>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mx-auto max-w-3xl text-center"
      >
        <h2 className="font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-5xl">
          Connect the agents and tools
          <br />
          you already use
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground md:text-lg">
          SDKs, coding agents and no-code platforms all plug into one
          marketplace.
        </p>
        <div className="mx-auto mt-8 flex size-12 items-center justify-center rounded-2xl border border-black/[0.06] bg-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)]">
          <Globe className="size-5" />
        </div>
      </motion.div>

      <div className="relative mt-10 space-y-3">
        <div className="pointer-events-none absolute left-1/2 top-0 h-6 w-px bg-gradient-to-b from-neutral-300 to-transparent" />
        <Row items={ROW_A} />
        <Row items={ROW_B} reverse />
      </div>
    </section>
  );
}
