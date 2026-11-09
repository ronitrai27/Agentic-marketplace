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
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  LogOut,
  LayoutDashboard,
  Key,
  Bot,
  Brain,
  BookOpen,
  BarChart3,
  CircleDollarSign,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { LogoutDialog } from "@/modules/space/components/logout-dialog";
import { usePathname } from "next/navigation";

const NAV = [
  {
    href: "/space/creator",
    label: "Overview",
    icon: LayoutDashboard,
    exact: true,
  },
  { href: "/space/creator/credentials", label: "Credentials", icon: Key },
  { href: "/space/creator/my-agents", label: "My agents", icon: Brain },
  { href: "/space/creator/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/space/creator/revenue", label: "Revenue", icon: CircleDollarSign },
] as {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}[];

export function CreatorSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
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
        <SidebarHeader className="p-3 pb-2 flex flex-row items-center justify-between shrink-0">
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

        <SidebarContent className="p-2 mt-4">
          {/* Documentation Full-Width Button */}
          <div className="mb-3 px-1">
            <Link
              href="/docs"
              title="Documentation"
              className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-white dark:bg-neutral-800 text-foreground font-medium text-xs rounded-md border border-neutral-200 dark:border-neutral-700/80 shadow-sm hover:bg-neutral-50 dark:hover:bg-neutral-700/70 transition-all cursor-pointer group-data-[collapsible=icon]:px-0"
            >
              <BookOpen className="size-3.5 shrink-0" />
              <span className="truncate group-data-[collapsible=icon]:hidden">
                Documentation
              </span>
            </Link>
          </div>

          <SidebarGroup className="p-0">
            <SidebarMenu>
              {NAV.map(({ href, label, icon: Icon, exact }) => {
                const active = exact
                  ? pathname === href
                  : pathname.startsWith(href);
                return (
                  <SidebarMenuItem key={href} className="mt-3 first:mt-0">
                    <SidebarMenuButton
                      render={<Link href={href} />}
                      isActive={active}
                      tooltip={label}
                      className={
                        active
                          ? "bg-white dark:bg-neutral-800 text-foreground font-medium shadow-xs py-2 px-3 rounded-lg"
                          : "text-foreground hover:text-foreground py-2 px-3 rounded-lg"
                      }
                    >
                      <Icon className="size-4 shrink-0 text-neutral-600 " />
                      <span className="truncate text-black dark:text-white font-medium text-sm! group-data-[collapsible=icon]:hidden">
                        {label}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-2 pb-3 flex flex-col gap-2">
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
