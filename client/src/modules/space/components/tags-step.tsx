"use client";

import React, { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
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

export function TagsStep({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const full = selected.length >= MAX_TAGS;

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
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${
          on
            ? "border-foreground bg-foreground text-background"
            : "border-border text-foreground hover:bg-muted"
        }`}
      >
        {on && <Check className="size-3" />}
        {label}
        {via && !on && (
          <span className="text-[10px] text-muted-foreground">· {via}</span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-foreground">
          Describe your agent
        </h3>
        <p className="text-sm text-muted-foreground mt-1.5">
          Pick {MIN_TAGS} to {MAX_TAGS} tags so buyers can find it. Search by
          what it does, for example &quot;plagiarism&quot;, &quot;cold
          email&quot; or &quot;invoice&quot;.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tags…"
          className="pl-9"
          autoFocus
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
    </div>
  );
}
