"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  Home,
  History,
  LogOut,
  Receipt,
  Sparkles,
  Store,
  Wallet,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { LogoutDialog } from "@/modules/space/components/logout-dialog";
import { ActiveRunsIndicator, ActiveRunsList, useActiveRuns } from "@/modules/space/components/runs/active-runs-pill";
import { CardDitherBackground } from "@/components/ui/card-dither-background";

const NAV_LINKS = [
  { label: "Home", href: "/space", icon: Home },
  { label: "Marketplace", href: "/marketplace", icon: Store },
  { label: "Recent Runs", href: "/space/runs", icon: History },
  { label: "Transactions", href: "/space/transactions", icon: Receipt },
  { label: "Wallet", href: "/space/wallet", icon: Wallet },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = authClient.useSession();
  const pathname = usePathname();
  const activeRuns = useActiveRuns();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [isGuest, setIsGuest] = useState(false);

  React.useEffect(() => {
    const checkGuest = () => {
      try {
        setIsGuest(localStorage.getItem("catelxg_guest_mode") === "true");
      } catch {
        setIsGuest(false);
      }
    };
    checkGuest();
    window.addEventListener("storage", checkGuest);
    window.addEventListener("catelxg-guest-change", checkGuest);
    return () => {
      window.removeEventListener("storage", checkGuest);
      window.removeEventListener("catelxg-guest-change", checkGuest);
    };
  }, []);

  const user = session?.user;
  const isGuestActive = isGuest || !user;
  const name = isGuestActive
    ? "Guest"
    : user?.name || user?.email?.split("@")[0] || "User";
  const email = isGuestActive ? "Guest Mode" : user?.email || "";
  const avatarImage = isGuestActive ? undefined : user?.image || undefined;
  const initials = isGuestActive
    ? "G"
    : name
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

        <SidebarContent className="p-2 gap-3 font-sans">
          <Link
            href="/space/connect"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-9 w-full justify-start gap-2 rounded-lg border-neutral-200 bg-white px-3 text-[13px] font-medium text-black shadow-2xs hover:bg-white hover:border-neutral-300 dark:bg-white dark:text-black group-data-[collapsible=icon]:hidden",
            )}
          >
            <span className="flex items-center gap-1.5 shrink-0">
              <Image
                src="/cursor.svg"
                alt="Cursor"
                width={16}
                height={16}
                className="size-4"
              />
              <Image
                src="/claudecode-color.svg"
                alt="Claude Code"
                width={16}
                height={16}
                className="size-4"
              />
              <Image
                src="/codex-color.svg"
                alt="Cursor"
                width={16}
                height={16}
                className="size-5"
              />
            </span>
            <span className="truncate">Catelog MCP</span>
          </Link>

          <SidebarGroup className="p-0 mt-4">
            <SidebarMenu className="gap-0.5">
              {NAV_LINKS.map(({ label, href, icon: Icon }) => {
                const active =
                  href === "/space"
                    ? pathname === "/space"
                    : pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={label}
                      render={<Link href={href} />}
                      className="h-9 gap-2.5 rounded-lg px-3 text-[13px] font-medium text-black hover:bg-black/5 hover:text-black data-active:bg-black/[0.07] data-active:text-black dark:text-white dark:hover:text-white dark:hover:bg-white/10"
                    >
                      <Icon
                        className="size-4 text-neutral-600"
                        strokeWidth={1.75}
                      />
                      <span>{label}</span>
                      {href === "/space/runs" && <ActiveRunsIndicator count={activeRuns.length} />}
                    </SidebarMenuButton>
                    {href === "/space/runs" && <ActiveRunsList runs={activeRuns} />}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-2 pb-3 flex flex-col gap-5">
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
              title={isGuestActive ? "Exit Guest Mode" : "Log out"}
              aria-label={isGuestActive ? "Exit Guest Mode" : "Log out"}
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
