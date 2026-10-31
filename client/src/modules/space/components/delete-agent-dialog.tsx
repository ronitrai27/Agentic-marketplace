"use client";

import React, { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { Archive } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "../../../../convex/_generated/api";
import type { AgentWithPricing } from "./agent-card";

export function DeleteAgentDialog({
  agent: current,
  onOpenChange,
}: {
  agent: AgentWithPricing | null;
  onOpenChange: (open: boolean) => void;
}) {
  const archive = useMutation(api.agents.archive);
  const [typed, setTyped] = useState("");
  // Keep the name while the dialog fades out
  const [last, setLast] = useState<AgentWithPricing | null>(null);
  const agent = current ?? last;

  useEffect(() => {
    if (current) {
      setLast(current);
      setTyped("");
    }
  }, [current]);

  const confirmed = !!agent && typed.trim() === agent.name;

  const submit = () => {
    if (!agent || !confirmed) return;
    onOpenChange(false);
    toast.promise(archive({ agentId: agent._id }), {
      loading: `Archiving ${agent.name}…`,
      success: `${agent.name} was archived`,
      error: (e) =>
        (e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught Error:\s*/, "").split("\n")[0] : "") ||
        "Could not archive the agent.",
    });
  };

  return (
    <Dialog open={!!current} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-2 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="size-7 rounded-md border border-border bg-muted flex items-center justify-center">
              <Archive className="size-4" />
            </span>
            Delete agent
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Your agent is never deleted because of certain policies. It will be archived instead and can no longer
            be used by anyone on the marketplace.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="confirm-name" className="text-xs text-muted-foreground font-normal">
              Type <span className="font-semibold text-foreground select-all">{agent?.name}</span> to confirm
            </Label>
            <Input
              id="confirm-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={agent?.name}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!confirmed} className="cursor-pointer">
              Archive agent
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
