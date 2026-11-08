"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUp, Mic, Plus } from "lucide-react";
import { ComposerLoader } from "@/components/application/composer-loader/composer-loader";

/** The chat input that rises from the bottom once a first message is sent: sweeping border, plus, mic, send. */
export function ChefBottomInput({
  onSubmit,
  lockedReason,
}: {
  onSubmit: (text: string) => void;
  /** Set while the chef waits on the human (a run approval): typing is paused and this is shown instead. */
  lockedReason?: string;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const send = () => {
    const t = text.trim();
    if (!t || lockedReason) return;
    onSubmit(t);
    setText("");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 48 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.35 }}
      className="w-full shrink-0 px-4 pb-5 pt-2"
    >
      <ComposerLoader
        className="mx-auto max-w-3xl"
        colors={["#fde68a", "#fbbf24", "#f59e0b", "#fcd34d"]}
        speed={6.5}
        arc={120}
        intensity={0.7}
        bloom={16}
        bloomStrength={0.3}
        radius={26}
      >
        <div className="flex items-center gap-2 p-1.5">
          <button
            type="button"
            aria-label="Add"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-foreground transition-colors hover:bg-amber-100 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            <Plus className="size-4" />
          </button>
          <input
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={!!lockedReason}
            placeholder={lockedReason ?? "Ask me anything"}
            className="min-w-0 flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            aria-label="Voice input"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-muted"
          >
            <Mic className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            disabled={!text.trim() || !!lockedReason}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white transition-opacity hover:bg-amber-600 disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </ComposerLoader>
    </motion.div>
  );
}
