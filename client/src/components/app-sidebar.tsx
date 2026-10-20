"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, ArrowRight, Sparkles } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { LogoutDialog } from "@/modules/space/components/logout-dialog";
import { CardDitherBackground } from "@/components/ui/card-dither-background";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = authClient.useSession();
  const [logoutOpen, setLogoutOpen] = useState(false);

  const user = session?.user;
  const name = user?.name || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";
  const avatarImage = user?.image || undefined;
  const initials = name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <Sidebar
        collapsible="icon"
        className="border-none bg-neutral-100 dark:bg-neutral-900 text-sidebar-foreground"
        {...props}
      >
        <SidebarHeader className="p-3 pb-2 flex flex-row items-center gap-5 shrink-0">
          <div className="flex items-center gap-2 overflow-hidden">
            <Image
              src="/logo.svg"
              alt="Logo"
              width={72}
              height={22}
              priority
              className="dark:invert brightness-100 object-contain h-9 w-auto shrink-0 group-data-[collapsible=icon]:hidden"
            />
          </div>
          <SidebarTrigger className="text-foreground hover:bg-black/5 dark:hover:bg-white/10 shrink-0" />
        </SidebarHeader>

        <SidebarContent className="p-2" />

        <SidebarFooter className="p-2 pb-3 flex flex-col gap-2">
          {/* Agent Space Card with Image 1 style Pixel Dither effect */}
          <div className="relative overflow-hidden py-4 px-3 rounded-lg border border-neutral-200/90 dark:border-neutral-800 shadow-2xs group-data-[collapsible=icon]:hidden bg-white dark:bg-[#0c0c0e]">
            {/* Pixel Dither Background: top white, middle to bottom dither pixels */}
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none overflow-hidden"
              style={{
                maskImage:
                  "linear-gradient(to bottom, transparent 0%, transparent 28%, black 70%, black 100%)",
                WebkitMaskImage:
                  "linear-gradient(to bottom, transparent 0%, transparent 28%, black 70%, black 100%)",
              }}
            >
              <CardDitherBackground />
            </div>

            {/* Card Content */}
            <div className="relative z-10 flex flex-col">
              <div className="flex items-center gap-1.5 mb-1 text-neutral-900 dark:text-neutral-100">
                <Sparkles className="size-3.5 text-neutral-700 dark:text-neutral-300" />
                <span className="text-sm font-semibold tracking-tight">
                  Agent Space
                </span>
              </div>
              <p className="text-[12px] text-neutral-800 dark:text-neutral-300 leading-snug mb-3">
                Turn your agents into products. Publish to the marketplace and
                monetize your work.
              </p>

              {/* Button to visit */}
              <Link
                href="/space/creator"
                className="group/btn flex items-center justify-center gap-1.5 w-fit! py-1.5 px-4 mx-auto rounded-lg text-[10px] font-medium bg-neutral-900 text-white hover:bg-black dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100 shadow-xs transition-all cursor-pointer"
              >
                <span>Publish Agent</span>
                <ArrowRight className="size-3 group-hover/btn:translate-x-0.5 transition-transform" />
              </Link>
            </div>
          </div>

          {/* User Profile Card */}
          <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-white dark:bg-neutral-950 border border-neutral-200/80 dark:border-neutral-800 shadow-2xs group-data-[collapsible=icon]:p-1 group-data-[collapsible=icon]:justify-center transition-all">
            <div className="flex items-center gap-2.5 min-w-0 overflow-hidden">
              <Avatar size="sm" className="size-8 shrink-0">
                {avatarImage && <AvatarImage src={avatarImage} alt={name} />}
                <AvatarFallback className="bg-neutral-200 dark:bg-neutral-800 text-foreground text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
                <span className="text-xs font-medium text-foreground truncate">
                  {name}
                </span>
                <span className="text-[11px] text-muted-foreground truncate">
                  {email}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setLogoutOpen(true)}
              title="Log out"
              aria-label="Log out"
              className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 group-data-[collapsible=icon]:hidden cursor-pointer"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <LogoutDialog open={logoutOpen} onOpenChange={setLogoutOpen} />
    </>
  );
}
