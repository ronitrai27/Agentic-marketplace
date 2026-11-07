"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MAX_CAPABILITIES,
  MAX_CAPABILITY_CHARS,
  cleanCapabilities,
  suggestCapabilities,
} from "@/lib/agent-capabilities";
import { MAX_DESCRIPTION_WORDS, MIN_DESCRIPTION_WORDS, validateDescription, wordCount } from "@/lib/agent-description";
import type { AgentWithPricing } from "./agent-card";

export function EditAgentDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: AgentWithPricing;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useMutation(api.agents.updateDetails);
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [status, setStatus] = useState<"active" | "paused">(agent.status === "paused" ? "paused" : "active");
  const [caps, setCaps] = useState<string[]>(agent.keyCapabilities ?? []);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset to the saved values each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setName(agent.name);
    setDescription(agent.description);
    setStatus(agent.status === "paused" ? "paused" : "active");
    setCaps(agent.keyCapabilities ?? []);
    setDraft("");
  }, [open, agent]);

  // a description you did not touch is never blocked (older agents may have a short one)
  const descError = description.trim() !== agent.description && !validateDescription(description).ok;
  const statusLocked = agent.status === "suspended" || agent.status === "archived";
  const suggestions = useMemo(() => suggestCapabilities(agent.tags, caps), [agent.tags, caps]);
  const full = caps.length >= MAX_CAPABILITIES;

  const add = (text: string) => {
    const next = cleanCapabilities([...caps, text]);
    if (next.length !== caps.length) setCaps(next);
    setDraft("");
  };

  const save = async () => {
    setSaving(true);
    try {
      await update({
        agentId: agent._id,
        name,
        description,
        ...(statusLocked ? {} : { status }),
        keyCapabilities: cleanCapabilities(draft.trim() ? [...caps, draft] : caps),
      });
      toast.success("Agent updated");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg h-[85vh] max-h-[640px] flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Edit agent</DialogTitle>
          <DialogDescription>Update how your agent appears on the marketplace.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-5 pr-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Name</label>
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            {name.trim() && name.trim() !== agent.name && (
              <p className="text-[11px] text-muted-foreground">
                Renaming also changes your agent&apos;s page address, so old links to it will stop working.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Description</label>
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            <p className={`text-[11px] tabular-nums ${descError ? "text-destructive" : "text-muted-foreground"}`}>
              {wordCount(description)} / {MAX_DESCRIPTION_WORDS} words
              {descError ? ` · ${MIN_DESCRIPTION_WORDS} to ${MAX_DESCRIPTION_WORDS} needed` : ""}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium">Status</label>
            {statusLocked ? (
              <p className="text-xs text-muted-foreground">
                This agent is {agent.status}, so its status can&apos;t be changed here.
              </p>
            ) : (
              <div className="flex gap-2">
                {(["active", "paused"] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={status === s ? "default" : "outline"}
                    onClick={() => setStatus(s)}
                    className="capitalize cursor-pointer"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <label className="text-xs font-medium">Key capabilities</label>
              <span className="text-[11px] text-muted-foreground">
                {caps.length}/{MAX_CAPABILITIES}
              </span>
            </div>

            {caps.length > 0 && (
              <ul className="rounded-lg border border-border divide-y divide-border">
                {caps.map((c) => (
                  <li key={c} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className="flex-1 min-w-0 break-words">{c}</span>
                    <button
                      type="button"
                      onClick={() => setCaps(caps.filter((x) => x !== c))}
                      className="text-muted-foreground hover:text-foreground cursor-pointer"
                      aria-label={`Remove ${c}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2">
              <Input
                value={draft}
                maxLength={MAX_CAPABILITY_CHARS}
                disabled={full}
                placeholder={full ? "Limit reached" : "Short point, e.g. Writes cited reports"}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (draft.trim()) add(draft);
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={full || !draft.trim()}
                onClick={() => add(draft)}
                className="cursor-pointer shrink-0"
                aria-label="Add capability"
              >
                <Plus className="size-4" />
              </Button>
            </div>

            {suggestions.length > 0 && !full && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] text-muted-foreground">Suggested from your tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.slice(0, 8).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => add(s)}
                      className="rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40 cursor-pointer"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={saving || name.trim().length < 2 || descError} className="cursor-pointer">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
