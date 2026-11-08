"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { MIN_DESCRIPTION_WORDS, wordCount } from "@/lib/agent-description";
import { Input } from "@/components/ui/input";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { AgentPromptDialog } from "./agent-prompt-dialog";
import {
  AGENT_TAGS,
  MAX_TAGS,
  MIN_TAGS,
  TAG_GROUP_LABEL,
  searchTags,
  tagById,
  type TagGroup,
} from "@/lib/agent-tags";

type Suggest =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; tags: string[] }
  | { state: "error"; message: string };

/** Waits this long after the creator stops typing before asking for suggestions. */
const SUGGEST_DEBOUNCE_MS = 1200;

/** Tag ids suggested from the description by the server (Groq). Refetches when the description settles on new text. */
function useTagSuggestions(description: string) {
  const [s, setS] = useState<Suggest>({ state: "idle" });
  const [nonce, setNonce] = useState(0);
  const text = description.trim();
  const enough = wordCount(text) >= MIN_DESCRIPTION_WORDS;
  const lastKey = useRef("");
  /** Set by "Suggest again": skip the typing debounce. */
  const now = useRef(false);

  useEffect(() => {
    if (!enough) {
      lastKey.current = "";
      setS({ state: "idle" });
      return;
    }
    const key = `${text}#${nonce}`;
    if (key === lastKey.current) return;
    const ctrl = new AbortController();
    const timer = setTimeout(
      async () => {
        lastKey.current = key;
        setS({ state: "loading" });
        try {
          const res = await fetch("/api/agents/suggest-tags", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description: text }),
            signal: ctrl.signal,
          });
          const data = (await res.json().catch(() => ({}))) as { tags?: string[]; error?: string };
          if (!res.ok) throw new Error(data.error ?? "Could not suggest tags right now.");
          setS({ state: "ready", tags: (data.tags ?? []).filter((id) => tagById(id)) });
        } catch (e) {
          if (ctrl.signal.aborted) return;
          lastKey.current = ""; // let the next edit (or Retry) try again
          setS({ state: "error", message: e instanceof Error ? e.message : "Could not suggest tags right now." });
        }
      },
      now.current ? 0 : SUGGEST_DEBOUNCE_MS,
    );
    now.current = false;
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [text, enough, nonce]);

  return {
    s,
    enough,
    retry: () => {
      now.current = true;
      setNonce((n) => n + 1);
    },
  };
}

export function TagsStep({
  selected,
  onChange,
  onRegisterAi,
  description = "",
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  onRegisterAi?: () => void;
  /** The agent's description: tags are suggested from it. */
  description?: string;
}) {
  const [query, setQuery] = useState("");
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const full = selected.length >= MAX_TAGS;
  const { s: suggest, enough, retry } = useTagSuggestions(description);
  const suggested = suggest.state === "ready" ? suggest.tags : [];
  const unpicked = suggested.filter((id) => !selected.includes(id));
  const addAll = () => onChange([...selected, ...unpicked].slice(0, MAX_TAGS));

  const matches = useMemo(() => searchTags(query), [query]);
  const searching = query.trim().length > 0;

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (!full) onChange([...selected, id]);
  };

  const groups: TagGroup[] = ["category", "feature"];

  const chip = (id: string, label: string, via?: string) => {
    const on = selected.includes(id);
    const blocked = !on && full;
    return (
      <button
        key={id}
        type="button"
        disabled={blocked}
        onClick={() => toggle(id)}
        title={blocked ? `You can pick up to ${MAX_TAGS} tags` : undefined}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
          on
            ? "border-foreground bg-foreground text-background"
            : "border-border text-foreground hover:bg-muted"
        }`}
      >
        {on && <Check className="size-2.5" />}
        {label}
        {via && !on && (
          <span className="text-[9px] text-muted-foreground">· {via}</span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">Tags</h3>
          <p className="text-sm text-muted-foreground mt-1.5">
            Pick {MIN_TAGS} to {MAX_TAGS} tags so buyers can find it. Use the
            suggestions from your description, or search by what it does, for
            example &quot;plagiarism&quot;, &quot;cold email&quot; or
            &quot;invoice&quot;.
          </p>
        </div>

        <div className="shrink-0">
          <RainbowButton
            type="button"
            size="sm"
            onClick={() => {
              if (onRegisterAi) onRegisterAi();
              else setAiPromptOpen(true);
            }}
            className="h-8 rounded-md px-3 text-xs font-medium cursor-pointer"
          >
            Register with AI
          </RainbowButton>
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Sparkles className="size-3.5" />
            Suggested from your description
          </p>
          <div className="flex items-center gap-3">
            {unpicked.length > 0 && !full && (
              <button
                type="button"
                onClick={addAll}
                className="text-[11px] font-medium text-foreground underline-offset-2 hover:underline cursor-pointer"
              >
                Use these
              </button>
            )}
            {(suggest.state === "ready" || suggest.state === "error") && (
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label="Suggest tags again"
              >
                <RefreshCw className="size-3" />
                {suggest.state === "error" ? "Retry" : "Suggest again"}
              </button>
            )}
          </div>
        </div>
        {!enough ? (
          <p className="text-xs text-muted-foreground">
            Write at least {MIN_DESCRIPTION_WORDS} words in the description
            above and we&apos;ll suggest {MAX_TAGS} tags that match it.
          </p>
        ) : suggest.state === "loading" || suggest.state === "idle" ? (
          <div className="flex flex-wrap gap-2" aria-busy="true" aria-label="Suggesting tags">
            {Array.from({ length: MAX_TAGS }, (_, i) => (
              <span key={i} className="h-6 w-20 animate-pulse rounded-full bg-muted" />
            ))}
          </div>
        ) : suggest.state === "error" ? (
          <p className="text-xs text-destructive">{suggest.message}</p>
        ) : suggested.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No tag fits this description well. Pick tags below.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {suggested.map((id) => chip(id, tagById(id)?.label ?? id))}
          </div>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tags…"
          className="pl-9"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-foreground">Selected</p>
          <p
            className={`text-[11px] ${
              selected.length < MIN_TAGS
                ? "text-muted-foreground"
                : "text-green-600 dark:text-green-400"
            }`}
          >
            {selected.length} of {MAX_TAGS}
            {selected.length < MIN_TAGS &&
              ` · pick ${MIN_TAGS - selected.length} more`}
          </p>
        </div>
        {selected.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing selected yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selected.map((id) => chip(id, tagById(id)?.label ?? id))}
          </div>
        )}
      </div>

      {/* Capped height: the list scrolls so the rest of the step (pricing later) stays in view */}
      <div className="max-h-56 overflow-y-auto rounded-lg border border-border p-3 space-y-4">
        {searching ? (
          matches.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No tag matches &quot;{query}&quot;. Try a broader word, like
              &quot;research&quot; or &quot;writing&quot;.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {matches.map(({ tag, via }) => chip(tag.id, tag.label, via))}
            </div>
          )
        ) : (
          groups.map((g) => (
            <section key={g} className="space-y-2">
              <p className="text-[10px] font-medium text-muted-foreground">
                {TAG_GROUP_LABEL[g]}
              </p>
              <div className="flex flex-wrap gap-2">
                {AGENT_TAGS.filter((t) => t.group === g).map((t) =>
                  chip(t.id, t.label),
                )}
              </div>
            </section>
          ))
        )}
      </div>

      <AgentPromptDialog open={aiPromptOpen} onOpenChange={setAiPromptOpen} />
    </div>
  );
}
