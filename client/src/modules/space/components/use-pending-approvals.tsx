"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../../convex/_generated/api";
import { creditsToUsd, mcpClient } from "../mcp-clients";

/** Number of MCP run requests waiting for the user (live). 0 until loaded. */
export function usePendingApprovalCount(): number {
  const pending = useQuery(api.mcpRuns.myPending);
  return pending?.length ?? 0;
}

/**
 * Mount once (in the sidebar). Shows a toast the moment a new approval request arrives from an external agent.
 * Requests already pending when the page loads are not toasted again; the badge covers those.
 */
export function ApprovalToaster() {
  const pending = useQuery(api.mcpRuns.myPending);
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!pending) return;
    if (seen.current === null) {
      seen.current = new Set(pending.map((p) => p.id));
      return;
    }
    for (const p of pending) {
      if (seen.current.has(p.id)) continue;
      seen.current.add(p.id);
      const client = mcpClient(p.clientName);
      toast(`Approval requested by ${client.label}`, {
        id: `approval-${p.id}`,
        description: `${p.agentName} · up to ${creditsToUsd(p.holdCredits)}`,
        duration: 15_000,
        action: { label: "Review", onClick: () => router.push(`/space/approvals?id=${p.id}`) },
      });
    }
  }, [pending, router]);

  return null;
}
