"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { ACTIVE_STATUSES } from "./runs/active-runs-pill";
import { openRun } from "./runs/run-store";
import { motion } from "framer-motion";
import { Search, Star, X } from "lucide-react";
import { tagById } from "@/lib/agent-tags";
import { tokensOf } from "@/lib/search-text";
import {
  highlightParts,
  localSearch,
  type CatalogAgent,
  type SemanticResponse,
} from "@/lib/agent-search";
import { AgentLogo } from "./agent-logo";

const FALLBACK_CHIPS = [
  "cold email",
  "Reports",
  "plagiarism",
  "lead generation",
];
const RECENT_KEY = "catelog:recent-agents";
const MAX_RECENT = 6;

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function saveRecent(id: string) {
  try {
    const next = [id, ...readRecent().filter((x) => x !== id)].slice(
      0,
      MAX_RECENT,
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // private mode: recents just do not persist
  }
}

function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded! border border-border bg-background px-1.5 text-[11px] font-medium  shadow-[0_1px_0_0_var(--border)]">
      {children}
    </kbd>
  );
}

function Row({
  agent,
  query,
  active,
  onPick,
  onHover,
}: {
  agent: CatalogAgent;
  query: string;
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
      className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors ${
        active ? "bg-muted" : "hover:bg-muted/60"
      }`}
    >
      <AgentLogo
        name={agent.name}
        logoUrl={agent.logoUrl}
        className="size-9 rounded-xl text-sm"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {highlightParts(agent.name, query).map((p, i) =>
          p.mark ? (
            <mark
              key={i}
              className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-400/30"
            >
              {p.text}
            </mark>
          ) : (
            <React.Fragment key={i}>{p.text}</React.Fragment>
          ),
        )}
      </span>
      <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
        {agent.tags.slice(0, 2).map((id) => (
          <span
            key={id}
            className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            {tagById(id)?.label ?? id}
          </span>
        ))}
      </span>
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs tabular-nums text-foreground">
        <Star
          className="size-3.5 fill-amber-400 text-amber-400"
          strokeWidth={1.5}
        />
        {agent.ratingAvg.toFixed(1)}
      </span>
    </button>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
      {children}
    </p>
  );
}

/** A magnifying glass drawing a figure 8 on a loop: the "still searching" state. */
const EIGHT = Array.from({ length: 33 }, (_, i) => {
  const t = (i / 32) * Math.PI * 2;
  const d = 1 + Math.sin(t) ** 2;
  return { x: (22 * Math.cos(t)) / d, y: (22 * Math.sin(t) * Math.cos(t)) / d };
});

function SearchingLoop() {
  return (
    <div
      className="flex flex-col items-center gap-2 px-3 py-7"
      role="status"
      aria-label="Searching"
    >
      <div className="relative h-14 w-24">
        <motion.span
          className="absolute left-1/2 top-1/2 -ml-3 -mt-3 text-foreground"
          animate={{ x: EIGHT.map((p) => p.x), y: EIGHT.map((p) => p.y) }}
          transition={{ duration: 2.6, ease: "linear", repeat: Infinity }}
        >
          <Search className="size-6" strokeWidth={2} />
        </motion.span>
      </div>
      <p className="text-xs text-muted-foreground">Looking for matches…</p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-1 p-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex animate-pulse items-center gap-3 px-3 py-2"
        >
          <div className="size-9 rounded-xl bg-muted" />
          <div className="h-3 w-1/3 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function AgentSearch() {
  const router = useRouter();
  const catalog = useQuery(api.chefAgents.listForSearch) as
    | CatalogAgent[]
    | undefined;
  const recentRuns = useQuery(api.runs.myRecent);
  const activeRuns = (recentRuns ?? []).filter((r) =>
    ACTIVE_STATUSES.includes(r.status),
  );

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [semantic, setSemantic] = useState<{
    q: string;
    data: SemanticResponse;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [isMac, setIsMac] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, SemanticResponse>());

  const term = q.trim();
  const byId = useMemo(
    () => new Map((catalog ?? []).map((a) => [a.id, a])),
    [catalog],
  );

  // 1) instant: runs in the browser on every keystroke, no network
  const local = useMemo(
    () => (catalog && term ? localSearch(catalog, term, 6) : []),
    [catalog, term],
  );

  // 2) by meaning: asked for in the background; results are added below when they arrive
  useEffect(() => {
    const hasWords = tokensOf(term).length > 0;
    if (term.length < 3 || !hasWords) {
      setSemantic(null);
      setPending(false);
      return;
    }
    const cached = cache.current.get(term.toLowerCase());
    if (cached) {
      setSemantic({ q: term, data: cached });
      setPending(false);
      return;
    }
    setPending(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as SemanticResponse;
        cache.current.set(term.toLowerCase(), data);
        setSemantic({ q: term, data });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setSemantic(null); // the instant results are still on screen
      } finally {
        if (!ctrl.signal.aborted) setPending(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [term]);

  const extras = useMemo(() => {
    if (!semantic || semantic.q !== term) return [];
    const shown = new Set(local.map((a) => a.id));
    return [
      ...semantic.data.exact,
      ...semantic.data.related,
      ...semantic.data.similar,
    ]
      .map((id) => byId.get(id))
      .filter((a): a is CatalogAgent => !!a && !shown.has(a.id))
      .slice(0, 4);
  }, [semantic, term, local, byId]);

  // idle list: what you opened lately, else the best rated
  const idle = useMemo(() => {
    if (!catalog) return { title: "", list: [] as CatalogAgent[] };
    const recents = recentIds
      .map((id) => byId.get(id))
      .filter((a): a is CatalogAgent => !!a);
    if (recents.length) return { title: "Recent", list: recents.slice(0, 3) };
    // only agents that actually have a rating, best first, at most 3 (the section is hidden when there are none)
    return {
      title: "Top rated",
      list: catalog
        .filter((a) => a.ratingAvg > 0)
        .sort((a, b) => b.ratingAvg - a.ratingAvg)
        .slice(0, 3),
    };
  }, [catalog, recentIds, byId]);

  // "Try searching for": the most used tags of the real catalog
  const chips = useMemo(() => {
    const count = new Map<string, number>();
    for (const a of catalog ?? [])
      for (const t of a.tags) count.set(t, (count.get(t) ?? 0) + 1);
    const top = [...count.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id]) => tagById(id)?.label)
      .filter((x): x is string => !!x);
    return top.length >= 3 ? top : FALLBACK_CHIPS;
  }, [catalog]);

  const flat = term ? [...local, ...extras] : idle.list;

  useEffect(() => setCursor(0), [term]);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    setRecentIds(readRecent());
  }, [open]);

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

  const pick = (a: CatalogAgent) => {
    saveRecent(a.id);
    setOpen(false);
    setQ("");
    input.current?.blur();
    router.push(`/space/marketplace/${a.slug}`);
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

  const noResults =
    !!term &&
    !!catalog &&
    local.length === 0 &&
    extras.length === 0 &&
    !pending;

  return (
    <div ref={wrap} className="relative w-full max-w-[500px]">
      <div
        className={`flex h-11 items-center gap-3 rounded-lg! border bg-white! dark:bg-background! px-4 transition-all ${
          open
            ? "border-foreground/10 shadow"
            : "border-border shadow hover:border-foreground/20"
        }`}
      >
        <Search className="size-[18px] shrink-0 text-muted-foreground" />
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
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {q ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQ("");
              input.current?.focus();
            }}
            className="flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : (
          <span className="hidden items-center gap-1 sm:flex rounded-none!">
            <Keycap>{isMac ? "⌘" : "Ctrl"}</Keycap>
            <Keycap>K</Keycap>
          </span>
        )}
      </div>

      {open && (
        <div
          id="agent-search-list"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+10px)] z-50 overflow-hidden rounded-lg! border border-border bg-popover shadow-md! animate-in fade-in-0 slide-in-from-top-1 duration-150"
        >
          {/* thin progress line while the by-meaning results are on their way */}
          <div
            className={`h-0.5 w-full bg-foreground/15 ${pending ? "animate-pulse" : "opacity-0"}`}
          />

          <div className="max-h-[70vh] overflow-y-auto px-2 pb-2">
            {!term && (
              <>
                {activeRuns.length > 0 && (
                  <div>
                    <Heading>Your runs</Heading>
                    {activeRuns.map((run) => (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          openRun(run.id);
                        }}
                        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg! px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        <span className="min-w-0 truncate font-medium">
                          Open {run.agentName}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {run.status === "awaiting_input"
                            ? "needs your input"
                            : "running"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <Heading>Try searching for</Heading>
                <div className="flex flex-wrap gap-2 px-3 pb-2">
                  {chips.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setQ(c);
                        input.current?.focus();
                      }}
                      className="cursor-pointer rounded-full border border-border bg-white dark:bg-card px-3.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                    >
                      {c}
                    </button>
                  ))}
                </div>

                {catalog === undefined && <SkeletonRows />}
                {idle.list.length > 0 && (
                  <div className="mt-1 border-t border-border pt-0.5">
                    <Heading>{idle.title}</Heading>
                    {idle.list.map((a, i) => (
                      <Row
                        key={a.id}
                        agent={a}
                        query=""
                        active={cursor === i}
                        onHover={() => setCursor(i)}
                        onPick={() => pick(a)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {term && catalog === undefined && <SkeletonRows />}

            {term && local.length > 0 && (
              <div>
                <Heading>Agents</Heading>
                {local.map((a, i) => (
                  <Row
                    key={a.id}
                    agent={a}
                    query={term}
                    active={cursor === i}
                    onHover={() => setCursor(i)}
                    onPick={() => pick(a)}
                  />
                ))}
              </div>
            )}

            {term && extras.length > 0 && (
              <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
                <Heading>Related</Heading>
                {extras.map((a, i) => (
                  <Row
                    key={a.id}
                    agent={a}
                    query={term}
                    active={cursor === local.length + i}
                    onHover={() => setCursor(local.length + i)}
                    onPick={() => pick(a)}
                  />
                ))}
              </div>
            )}

            {term &&
              catalog &&
              local.length === 0 &&
              extras.length === 0 &&
              pending && <SearchingLoop />}

            {noResults && (
              <div className="px-3 py-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  No agent found currently
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try a task like &ldquo;write cold emails&rdquo; or a single
                  tag.
                </p>
              </div>
            )}
          </div>

          {flat.length > 0 && (
            <div className="flex items-center gap-5 border-t border-border bg-muted px-4 py-2.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Keycap>↓</Keycap>
                <Keycap>↑</Keycap> Move
              </span>
              <span className="flex items-center gap-1.5">
                <Keycap>↵</Keycap> Select
              </span>
              <span className="flex items-center gap-1.5">
                <Keycap>Esc</Keycap> Quit
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
