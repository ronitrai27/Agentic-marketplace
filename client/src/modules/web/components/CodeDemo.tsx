"use client";

import React, { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";

// Real Catelog SDK usage (see sdk/py-sdk/README.md and sdk/ts-sdk/Catelog-TS.md)
const FILES = [
  {
    id: "py",
    name: "main.py",
    icon: "/python.png",
    code: `from pydantic import BaseModel
from catelog import create_agent

class Input(BaseModel):
    text: str

async def execute(ctx):
    ctx.stream.progress(50, "Summarizing...")
    ctx.stream.delta("Hello from Python!")
    return {"output": {"summary": ctx.input.text[:100]}}

agent = create_agent(
    name="Python Summarizer",
    max_timeout_minute=5,
    input_schema=Input,
    execute=execute,
)

if __name__ == "__main__":
    agent.listen(3000)`,
  },
  {
    id: "ts",
    name: "server.ts",
    icon: "/typescript.png",
    code: `import { createAgent } from "catelog";
import { z } from "zod";

const agent = createAgent({
  maxTimeoutMinute: 5,
  name: "Summarizer",
  description: "Summarizes text",
  inputSchema: z.object({ text: z.string().min(1) }),
  async execute({ input, stream }) {
    stream.progress(20, "Reading...");
    stream.delta("Working on it...\\n");
    return { output: { summary: input.text.slice(0, 100) } };
  },
});

agent.listen(3000);`,
  },
];

const KEYWORDS = new Set([
  "from", "import", "class", "async", "await", "def", "return", "if",
  "const", "new", "export", "default",
]);

type Tok = { t: string; c?: string };

function tokenize(line: string): Tok[] {
  const out: Tok[] = [];
  const re =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+\b)|([A-Za-z_][A-Za-z0-9_]*)(?=\()|([A-Za-z_][A-Za-z0-9_]*)|(\s+|.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[1]) out.push({ t: m[1], c: "text-emerald-300" });
    else if (m[2]) out.push({ t: m[2], c: "text-amber-300" });
    else if (m[3]) out.push({ t: m[3], c: "text-orange-300" });
    else if (m[4]) {
      const w = m[4];
      if (KEYWORDS.has(w) || w === "__name__" || w === "__main__")
        out.push({ t: w, c: w.startsWith("__") ? "text-emerald-300" : "text-sky-300" });
      else if (/^[A-Z]/.test(w)) out.push({ t: w, c: "text-violet-300" });
      else out.push({ t: w });
    } else out.push({ t: m[5] });
  }
  return out;
}

export default function CodeDemo() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const file = FILES[active];
  const lines = file.code.split("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <section className="w-full bg-white px-4 pb-24 md:px-8">
      <div className="mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        {/* Left */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <h2 className="font-display text-4xl leading-[1.05] tracking-tight text-foreground md:text-5xl">
            Turn any agent into a marketplace service in 20 lines
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
            Write one <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-[0.9em] text-foreground">execute()</code>{" "}
            function. The Catelog SDK gives you the HTTP server, streaming,
            auth, timeouts and usage tracking. Works with any framework, in
            Python or TypeScript.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {["GET /health", "GET /schema", "POST /execute"].map((e) => (
              <span
                key={e}
                className="rounded-full border border-black/[0.08] bg-neutral-50 px-3 py-1 font-mono text-xs text-neutral-700"
              >
                {e}
              </span>
            ))}
          </div>
        </motion.div>

        {/* Code card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.7, delay: 0.1, ease: "easeOut" }}
          className="overflow-hidden rounded-3xl border border-white/10 bg-[#0e0e10] p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)]"
        >
          <div className="flex items-center justify-between px-2 pt-1">
            <div className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
            </div>
            <button
              type="button"
              onClick={copy}
              aria-label="Copy code"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-neutral-400 transition-colors hover:text-white"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="mt-3 flex gap-1">
            {FILES.map((f, i) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setActive(i)}
                className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  i === active
                    ? "border border-white/10 bg-white/[0.06] text-white"
                    : "border border-transparent text-neutral-400 hover:text-white"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.icon} alt="" className="size-4 rounded-sm object-contain" />
                {f.name}
              </button>
            ))}
          </div>

          <div className="mt-4 min-h-[420px] overflow-x-auto px-2 pb-4">
            <AnimatePresence mode="wait">
              <motion.pre
                key={file.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="font-mono text-[13px] leading-[1.75] text-neutral-100"
              >
                {lines.map((l, i) => (
                  <div key={i} className="flex">
                    <span className="w-7 shrink-0 select-none pr-3 text-right text-neutral-600">
                      {i + 1}
                    </span>
                    <code className="whitespace-pre">
                      {tokenize(l).map((tk, j) => (
                        <span key={j} className={tk.c}>
                          {tk.t}
                        </span>
                      ))}
                    </code>
                  </div>
                ))}
              </motion.pre>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
