"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ChevronDown, MessagesSquare, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";

const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Sidebar: "History Chats", open by default, newest first (date only), scrolls inside a max height. Clear All wipes it. */
export function ChatHistoryNav() {
  const chats = useQuery(api.chat.listMine);
  const clearAll = useMutation(api.chat.clearAll);
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function clear() {
    setBusy(true);
    try {
      for (let i = 0; i < 40; i++) {
        const { more } = await clearAll({});
        if (!more) break;
      }
      setConfirm(false);
      toast.success("Chat history cleared.");
      if (pathname.startsWith("/space/chat/")) router.push("/space");
    } catch {
      toast.error("Could not clear your history. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col group-data-[collapsible=icon]:hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-[13px] font-medium text-black hover:bg-black/5 dark:text-white dark:hover:bg-white/10"
      >
        <MessagesSquare className="size-4 text-neutral-600" strokeWidth={1.75} />
        <span>History Chats</span>
        <ChevronDown className={cn("ml-auto size-4 text-neutral-600 transition-transform", !open && "-rotate-90")} />
      </button>

      {open && (
        <div className="ml-5 mt-1 flex flex-col gap-0.5 border-l border-neutral-400 pl-2 dark:border-neutral-700">
          {chats && chats.length > 0 && (
            <div className="flex items-center justify-between px-2 py-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setConfirm(true)}
                className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3" /> Clear All
              </Button>
            </div>
          )}

          <div className="scrollbar-thin flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {chats === undefined && <p className="px-2 py-1 text-xs text-muted-foreground">Loading…</p>}
            {chats?.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No chats yet</p>}
            {chats?.map((c) => {
              const href = `/space/chat/${c.chatId}`;
              return (
                <Link
                  key={c.chatId}
                  href={href}
                  className={cn(
                    "flex flex-col rounded-md px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10",
                    pathname === href && "bg-black/[0.07] dark:bg-white/10",
                  )}
                >
                  <span className="truncate text-xs text-foreground">{c.title}</span>
                  <span className="text-[10px] text-muted-foreground">{fmtDate(c.lastMessageAt)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={(next) => !busy && setConfirm(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all chat history?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to clear all chat history? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} className="cursor-pointer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={clear}
              className="cursor-pointer"
            >
              {busy ? "Clearing…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
