"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { Eraser, History } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "../../../../convex/_generated/api";

const btn =
  "inline-flex size-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

const fmt = (t: number) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Top-right of the chat: past chats, and clear (back to the start screen). */
export function ChefChatActions({ onClear }: { onClear: () => void }) {
  const chats = useQuery(api.chat.listMine);
  return (
    <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
      <Popover>
        <Tooltip>
          <TooltipTrigger render={<PopoverTrigger aria-label="History" className={btn} />}>
            <History className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="bottom">History</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-72 p-1">
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {chats === undefined && <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>}
            {chats?.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No chats yet.</p>}
            {chats?.map((c) => (
              <Link
                key={c.chatId}
                href={`/space/chat/${c.chatId}`}
                className="block rounded-md px-3 py-2 text-sm hover:bg-muted"
              >
                <span className="block truncate text-foreground">{c.title}</span>
                <span className="text-[11px] text-muted-foreground">{fmt(c.lastMessageAt)}</span>
              </Link>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Tooltip>
        <TooltipTrigger render={<button type="button" aria-label="Clear" onClick={onClear} className={btn} />}>
          <Eraser className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="bottom">Clear</TooltipContent>
      </Tooltip>
    </div>
  );
}
