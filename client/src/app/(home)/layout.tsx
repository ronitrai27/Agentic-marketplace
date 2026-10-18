import type { Metadata } from "next";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

import { ThemeToggle } from "@/modules/space/components/theme-toggle";
import { NotificationButton } from "@/modules/space/components/notification-button";
import { WalletBadge } from "@/modules/space/components/wallet-badge";
import { HeaderUserMenu } from "@/modules/space/components/header-user-menu";

export const metadata: Metadata = {
  title: "Space | Marketplace",
};

export default function HomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider
      defaultOpen={true}
      className="bg-neutral-100 dark:bg-neutral-900 text-foreground min-h-screen"
    >
      <AppSidebar />
      <SidebarInset className="bg-transparent m-0 p-0 md:peer-data-[variant=inset]:m-0 md:peer-data-[variant=inset]:rounded-none md:peer-data-[variant=inset]:shadow-none">
        {/* Outer connected container with padding surrounding the inner main content box */}
        <div className="flex flex-col flex-1 h-screen w-full px-3 pb-3 pt-1.5 bg-neutral-100 dark:bg-neutral-900 overflow-hidden">
          {/* Top Header Bar above the main content box (for breadcrumbs, search, user avatar, icons) */}
          <header className="h-12 sm:h-14 w-full flex items-center justify-between px-2 shrink-0">
            {/* Left slot (breadcrumbs, etc.) */}
            <div className="flex items-center gap-2" />

            {/* Right slot: theme toggle, notification, wallet badge, and user avatar with dropdown */}
            <div className="flex items-center gap-2">
              <WalletBadge />
              <ThemeToggle />
              <NotificationButton />
              <HeaderUserMenu />
            </div>
          </header>

          {/* Main content square with rounded corners and border */}
          <div className="flex-1 flex flex-col rounded-xl border border-border/80 dark:border-neutral-700/60 bg-white dark:bg-neutral-950 overflow-hidden shadow-xs">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
