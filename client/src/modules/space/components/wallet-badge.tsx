"use client";

import React from "react";
import Link from "next/link";
import { Lock, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "convex/react";

import { authClient } from "@/lib/auth-client";
import { api } from "../../../../convex/_generated/api";

export function WalletBadge() {
  const { data: session } = authClient.useSession();
  const wallet = useQuery(api.wallet.getWallet);
  const credits = wallet?.credits ?? (session?.user as any)?.credits ?? 0;
  const held = wallet?.escrow ?? 0;
  const available = Math.round((credits - held) * 100) / 100;

  return (
    <Link
      href="/space/wallet"
      className="outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
    >
      <Badge
        variant="outline"
        className="rounded-sm! h-8 gap-1.5 px-2.5 border-neutral-200 dark:border-neutral-800 bg-linear-to-br from-white via-white to-yellow-100 dark:from-neutral-950 dark:via-neutral-800 dark:to-neutral-800 text-xs font-medium text-foreground shadow-2xs hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors cursor-pointer"
      >
        {held > 0 ? (
          <Lock className="size-3.5 text-amber-600" aria-label="Credits on hold" />
        ) : (
          <Wallet className="size-3.5 text-muted-foreground" />
        )}
        <span>wallet: {available} credits</span>
        {held > 0 && <span className="text-muted-foreground">· {held} held</span>}
      </Badge>
    </Link>
  );
}
