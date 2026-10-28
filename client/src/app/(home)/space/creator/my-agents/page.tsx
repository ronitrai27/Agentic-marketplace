"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Key, BookAlert } from "lucide-react";
import { Loupe } from "@lucasmarkes/hairline/react";
import { RegisterAgentDialog } from "@/modules/space/components/register-agent-dialog";
import { Button } from "@/components/ui/button";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { CardDitherBackground } from "@/components/ui/card-dither-background";

export default function MyAgentsPage() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-thin px-10 py-8 bg-background flex flex-col">
      <div className="max-w-7xl w-full mx-auto flex-1 flex flex-col space-y-8">
        {/* Header Heading & Subheading */}
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Ready to Turn your AI agents into recurring revenue?
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-2xl leading-relaxed">
            Bring your own server (BYOS) with zero code lock-in. Connect your
            Catelog SDK endpoint, register in Catelog Marketplace, and start
            monetizing calls from developers worldwide in minutes.
          </p>
        </div>

        {/* Before you start - Top Empty State Banner with Dither Pixel Animation at right end */}
        <div className="relative overflow-hidden flex items-start gap-3 rounded-lg border border-zinc-200 dark:border-neutral-800 bg-white dark:bg-card p-4 shadow-2xs">
          <div className="absolute -bottom-2 -right-2 w-72 h-36 pointer-events-none overflow-hidden [mask-image:radial-gradient(ellipse_at_bottom_right,black_35%,transparent_75%)] opacity-100">
            <CardDitherBackground />
          </div>

          <div className="relative z-10 size-8 rounded-md border border-zinc-300 dark:border-zinc-700 bg-background/90 flex items-center justify-center shrink-0 shadow-2xs">
            <Key className="size-4 text-foreground" />
          </div>
          <div className="relative z-10 min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              Before you start
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Ensure your server has the Catelog SDK running and an active API
              secret key. Ready to connect? Or check the quickstart guide.
            </p>
            <div className="mt-3">
              <Link href="/docs">
                <Button size="sm" className="text-xs gap-1.5 cursor-pointer">
                  <span>View docs</span>
                  <BookAlert className="size-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Center Empty State: Hairline Loupe + 2 Action Buttons */}
        <div className="flex-1 flex flex-col items-center justify-center py-6 gap-6">
          <div className="w-80">
            <Loupe />
          </div>

          <div className="flex items-center gap-3 -mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(true)}
              className="h-9 rounded-md px-4 text-xs font-medium cursor-pointer"
            >
              Add agent manually
            </Button>

            <RainbowButton
              type="button"
              size="sm"
              onClick={() => setOpen(true)}
              className="h-9 rounded-md px-4 text-xs font-medium cursor-pointer"
            >
              Register with AI
            </RainbowButton>
          </div>
        </div>
      </div>

      <RegisterAgentDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
