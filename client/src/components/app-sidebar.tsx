"use client";

import React, { useState } from "react";
import Image from "next/image";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { LogoutDialog } from "@/modules/space/components/logout-dialog";

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

        <SidebarFooter className="p-2 pb-3">
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
