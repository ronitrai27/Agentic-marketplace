"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag as TagIcon,
  X,
} from "lucide-react";
import { FIELD_FILL, SectionHeading } from "./section-heading";
import { MIN_DESCRIPTION_WORDS, wordCount } from "@/lib/agent-description";
import { Input } from "@/components/ui/input";
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
          const data = (await res.json().catch(() => ({}))) as {
            tags?: string[];
            error?: string;
          };
          if (!res.ok)
            throw new Error(data.error ?? "Could not suggest tags right now.");
          setS({
            state: "ready",
            tags: (data.tags ?? []).filter((id) => tagById(id)),
          });
        } catch (e) {
          if (ctrl.signal.aborted) return;
          lastKey.current = ""; // let the next edit (or Retry) try again
          setS({
            state: "error",
            message:
              e instanceof Error
                ? e.message
                : "Could not suggest tags right now.",
          });
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
  description = "",
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  /** The agent's description: tags are suggested from it. */
  description?: string;
}) {
  const [query, setQuery] = useState("");
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
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
          on
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-background text-foreground hover:border-foreground/40"
        }`}
      >
        {on ? (
          <Check className="size-3" />
        ) : (
          <Plus className="size-3 text-muted-foreground" />
        )}
        {label}
        {via && !on && (
          <span className="text-[10px] text-muted-foreground">· {via}</span>
        )}
      </button>
    );
  };

  /** Suggestion chip: violet so AI picks read differently from the library; dark once added. */
  const suggestChip = (id: string) => {
    const on = selected.includes(id);
    const blocked = !on && full;
    return (
      <button
        key={id}
        type="button"
        disabled={blocked}
        onClick={() => toggle(id)}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
          on ? "border-foreground bg-foreground text-background" : ""
        }`}
      >
        {on ? <Check className="size-3" /> : <Plus className="size-3" />}
        {tagById(id)?.label ?? id}
      </button>
    );
  };

  const ok = selected.length >= MIN_TAGS;

  return (
    <section className="space-y-5 border-b border-border pb-8 font-sans">
      <SectionHeading
        icon={TagIcon}
        title="Tags"
        right={
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${
              ok
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-muted text-zinc-800 dark:text-zinc-200"
            }`}
          >
            {selected.length} / {MAX_TAGS} picked
          </span>
        }
      >
        Pick {MIN_TAGS} to {MAX_TAGS} tags so buyers can find your agent.
      </SectionHeading>

      {/* 1. Your tags: filled slots, then the empty ones */}
      <div className="flex flex-wrap items-center gap-2">
        {selected.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => toggle(id)}
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background cursor-pointer hover:opacity-85"
            aria-label={`Remove ${tagById(id)?.label ?? id}`}
          >
            {tagById(id)?.label ?? id}
            <X className="size-3 opacity-70" />
          </button>
        ))}
        {Array.from({ length: MAX_TAGS - selected.length }, (_, i) => (
          <span
            key={`slot-${i}`}
            className="inline-flex h-7 w-24 items-center justify-center rounded-full border border-dashed border-zinc-400 dark:border-zinc-600 text-[11px] font-medium text-zinc-700 dark:text-zinc-300"
          >
            {i < MIN_TAGS - selected.length ? "required" : "optional"}
          </span>
        ))}
      </div>

      {/* 2. Suggested from the description (violet = AI) */}
      <div className="rounded-xl bg-yellow-300/10 p-3.5 space-y-2.5 ">
        <div className="flex items-center justify-between gap-3">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium ">
            <Sparkles className="size-3.5" />
            Suggested from your description
          </p>
          <div className="flex items-center gap-3">
            {unpicked.length > 0 && !full && (
              <button
                type="button"
                onClick={addAll}
                className="text-xs font-medium  hover:underline underline-offset-2 cursor-pointer d"
              >
                Add all
              </button>
            )}
            {(suggest.state === "ready" || suggest.state === "error") && (
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-1 text-xs text-zinc-700 dark:text-zinc-300 hover:text-foreground cursor-pointer"
                aria-label="Suggest tags again"
              >
                <RefreshCw className="size-3" />
                {suggest.state === "error" ? "Retry" : "Refresh"}
              </button>
            )}
          </div>
        </div>
        {!enough ? (
          <p className="text-xs text-zinc-700 dark:text-zinc-300">
            Write at least {MIN_DESCRIPTION_WORDS} words above and AI will
            suggest {MAX_TAGS} tags that match it.
          </p>
        ) : suggest.state === "loading" || suggest.state === "idle" ? (
          <div
            className="flex flex-wrap gap-2"
            aria-busy="true"
            aria-label="Suggesting tags"
          >
            {Array.from({ length: MAX_TAGS }, (_, i) => (
              <span
                key={i}
                className="h-7 w-24 animate-pulse rounded-full bg-violet-200/60 dark:bg-violet-500/20"
              />
            ))}
          </div>
        ) : suggest.state === "error" ? (
          <p className="text-xs text-destructive">{suggest.message}</p>
        ) : suggested.length === 0 ? (
          <p className="text-xs text-zinc-700 dark:text-zinc-300">
            No tag fits this description well. Browse below.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {suggested.map(suggestChip)}
          </div>
        )}
      </div>

      {/* 3. Browse: search and the full list in one box */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="relative border-b border-border">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-600 dark:text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all tags, e.g. plagiarism, cold email, invoice"
            className={`h-10 rounded-none border-0 pl-9 ${FIELD_FILL} placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus-visible:ring-0`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-600 dark:text-zinc-400 hover:text-foreground cursor-pointer"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Capped height: the list scrolls so pricing stays reachable */}
        <div className="max-h-56 overflow-y-auto p-3.5 space-y-4">
          {searching ? (
            matches.length === 0 ? (
              <p className="text-xs text-zinc-700 dark:text-zinc-300">
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
              <div key={g} className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                  {TAG_GROUP_LABEL[g]}
                </p>
                <div className="flex flex-wrap gap-2">
                  {AGENT_TAGS.filter((t) => t.group === g).map((t) =>
                    chip(t.id, t.label),
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
