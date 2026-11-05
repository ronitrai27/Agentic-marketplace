"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { ACTIVE_STATUSES } from "./runs/active-runs-pill";
import { openRun } from "./runs/run-store";
import {
  LandPlot,
  Layers,
  Search,
  Sparkles,
  Star,
  Target,
  X,
} from "lucide-react";
import { tagById } from "@/lib/agent-tags";
import type { SearchHit, SearchResponse } from "@/app/api/search/route";
import { AgentLogo } from "./agent-logo";

type Group = {
  key: keyof SearchResponse;
  label: string;
  hint: string;
  icon: React.ElementType;
};

const GROUPS: Group[] = [
  { key: "exact", label: "Exact matches", hint: "Name or tag", icon: LandPlot },
  {
    key: "related",
    label: "Related",
    hint: "Typos and meaning",
    icon: Sparkles,
  },
  {
    key: "similar",
    label: "Similar agents",
    hint: "More like the top result",
    icon: Layers,
  },
];

const EXAMPLES = ["cold email", "Reports", "plagiarism", "lead generation"];

/** Typesense wraps matches in <mark>. Escape everything, then restore only <mark>. */
function markHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}

function Row({
  hit,
  active,
  onPick,
  onHover,
}: {
  hit: SearchHit;
  active: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onPick}
      className={`w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer ${
        active ? "bg-muted" : "hover:bg-muted/60"
      }`}
    >
      <AgentLogo
        name={hit.name}
        logoUrl={hit.logoUrl}
        className="size-7 text-sm rounded-md"
      />
      <div className="min-w-0 flex-1">
        <span
          className="block truncate text-sm font-medium text-foreground [&_mark]:bg-amber-200/70 [&_mark]:text-foreground [&_mark]:rounded-sm [&_mark]:px-0.5 dark:[&_mark]:bg-amber-400/30"
          dangerouslySetInnerHTML={{
            __html: markHtml(hit.nameHtml ?? hit.name),
          }}
        />
        <p className="truncate text-xs text-muted-foreground">
          {hit.description}
        </p>
      </div>
      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
        {hit.tags.slice(0, 2).map((id) => (
          <span
            key={id}
            className="rounded-full bg-background border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            {tagById(id)?.label ?? id}
          </span>
        ))}
      </div>
      <span className="flex items-center gap-1 text-xs tabular-nums text-foreground shrink-0">
        <Star
          className="size-3.5 fill-amber-400 text-amber-400"
          strokeWidth={1.5}
        />
        {hit.ratingAvg.toFixed(1)}
      </span>
    </button>
  );
}

function Skeleton() {
  return (
    <div className="space-y-1 p-1.5">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-2.5 py-2 animate-pulse"
        >
          <div className="size-9 rounded-xl bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/3 rounded bg-muted" />
            <div className="h-2.5 w-2/3 rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgentSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [cursor, setCursor] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const recent = useQuery(api.runs.myRecent);
  const activeRuns = (recent ?? []).filter((r) => ACTIVE_STATUSES.includes(r.status));

  // Flat list in display order, for keyboard navigation
  const flat = useMemo(
    () => (data ? GROUPS.flatMap((g) => data[g.key]) : []),
    [data],
  );

  // Debounced fetch; stale requests are aborted
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setData(null);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Search failed.");
        setData(json as SearchResponse);
        setError("");
        setCursor(0);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Search failed.");
        setData(null);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // Ctrl/Cmd+K focuses; click outside closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, []);

  const pick = (hit: SearchHit) => {
    setQ(hit.name);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    } else if (e.key === "ArrowDown" && flat.length) {
      e.preventDefault();
      setCursor((c) => (c + 1) % flat.length);
    } else if (e.key === "ArrowUp" && flat.length) {
      e.preventDefault();
      setCursor((c) => (c - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter" && flat[cursor]) {
      e.preventDefault();
      pick(flat[cursor]);
    }
  };

  const term = q.trim();
  const empty = !loading && !error && data && flat.length === 0;
  let index = -1;

  return (
    <div ref={wrap} className="relative w-full max-w-md">
      <div
        className={`flex items-center gap-2.5 h-10 rounded-2xl border bg-background px-3.5 transition-all ${
          open
            ? "border-foreground/30 shadow-lg shadow-black/5"
            : "border-border hover:border-foreground/20 shadow-xs"
        }`}
      >
        <Search className="size-4 text-muted-foreground shrink-0" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search agents by name, task or tag"
          role="combobox"
          aria-expanded={open}
          aria-controls="agent-search-list"
          className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
        {q ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQ("");
              input.current?.focus();
            }}
            className="size-5 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd className="hidden sm:inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Ctrl K
          </kbd>
        )}
      </div>

      {open && (
        <div
          id="agent-search-list"
          role="listbox"
          className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-lg! border border-border bg-popover shadow-lg shadow-black/10 animate-in fade-in-0 slide-in-from-top-1 duration-150"
        >
          <div className="max-h-[70vh] overflow-y-auto p-1.5">
            {term.length < 2 && activeRuns.length > 0 && (
              <div className="px-1.5 pt-1.5 pb-2">
                <p className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Your runs
                </p>
                {activeRuns.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      openRun(run.id);
                    }}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 truncate font-medium">Open {run.agentName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {run.status === "awaiting_input" ? "needs your input" : "running"}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {term.length < 2 && (
              <div className="px-3 py-4">
                <p className="text-xs font-medium text-muted-foreground mb-2.5">
                  Try searching for
                </p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => {
                        setQ(ex);
                        input.current?.focus();
                      }}
                      className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-muted transition-colors cursor-pointer"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {term.length >= 2 && loading && !data && <Skeleton />}

            {error && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {error}
              </p>
            )}

            {empty && (
              <div className="px-3 py-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  No agents found for &ldquo;{term}&rdquo;
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try a task like &ldquo;write cold emails&rdquo; or a single
                  tag.
                </p>
              </div>
            )}

            {data &&
              GROUPS.map((g) => {
                const hits = data[g.key];
                if (hits.length === 0) return null;
                const Icon = g.icon;
                return (
                  <div
                    key={g.key}
                    className={`pb-1 transition-opacity ${loading ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
                      <Icon className="size-3 text-muted-foreground" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {g.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">
                        · {g.hint}
                      </span>
                    </div>
                    {hits.map((hit) => {
                      index += 1;
                      const i = index;
                      return (
                        <Row
                          key={`${g.key}-${hit.id}`}
                          hit={hit}
                          active={cursor === i}
                          onHover={() => setCursor(i)}
                          onPick={() => pick(hit)}
                        />
                      );
                    })}
                  </div>
                );
              })}
          </div>

          {flat.length > 0 && (
            <div className="flex items-center gap-3 border-t border-border bg-muted/40 px-3.5 py-2 text-[10px] text-muted-foreground">
              <span>↑↓ navigate</span>
              <span>↵ select</span>
              <span>esc close</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
