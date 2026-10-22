"use client";

import React, { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  LogOut,
  LogIn,
  User,
  Settings,
  Sun,
  Moon,
  Laptop,
} from "lucide-react";
import { useTheme } from "next-themes";
import { LogoutDialog } from "@/modules/space/components/logout-dialog";

export function HeaderUserMenu() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const { theme, setTheme } = useTheme();
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
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white dark:bg-neutral-950 border border-neutral-200/80 dark:border-neutral-800 shadow-2xs hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          }
        >
          <Avatar size="sm" className="size-6.5 shrink-0">
            {avatarImage && <AvatarImage src={avatarImage} alt={name} />}
            <AvatarFallback className="bg-neutral-200 dark:bg-neutral-800 text-foreground text-[11px] font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>

          <span className="text-xs font-medium text-foreground max-w-[100px] truncate hidden sm:inline-block">
            {isGuestActive ? "Guest" : email || name}
          </span>

          <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56 p-1.5">
          {/* User info */}
          <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5">
            {isGuestActive ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground truncate">
                    Guest
                  </span>
                </div>
              </>
            ) : (
              <>
                <span className="text-xs font-semibold text-foreground truncate">
                  {name}
                </span>
                <span className="text-[11px] text-muted-foreground truncate">
                  {email}
                </span>
              </>
            )}
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          {isGuestActive ? (
            <DropdownMenuItem
              onClick={() => router.push("/auth")}
              className="flex items-center gap-2.5 px-2 py-1.5 text-xs font-medium text-primary hover:text-primary cursor-pointer"
            >
              <LogIn className="size-4" />
              <span>Sign In / Register</span>
            </DropdownMenuItem>
          ) : (
            <>
              {/* User Profile */}
              <DropdownMenuItem className="flex items-center gap-2.5 px-2 py-1.5 text-xs cursor-pointer">
                <User className="size-4 text-muted-foreground" />
                <span>Profile</span>
              </DropdownMenuItem>

              {/* Settings */}
              <DropdownMenuItem className="flex items-center gap-2.5 px-2 py-1.5 text-xs cursor-pointer">
                <Settings className="size-4 text-muted-foreground" />
                <span>Settings</span>
              </DropdownMenuItem>
            </>
          )}

          {/* Theme Section */}
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
            Theme
          </div>
          <div className="grid grid-cols-3 gap-1 px-1 pb-1">
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded text-[11px] transition-colors cursor-pointer ${
                theme === "light"
                  ? "bg-accent text-accent-foreground font-semibold"
                  : "hover:bg-accent/50 text-muted-foreground"
              }`}
            >
              <Sun className="size-3.5" />
              <span>Light</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded text-[11px] transition-colors cursor-pointer ${
                theme === "dark"
                  ? "bg-accent text-accent-foreground font-semibold"
                  : "hover:bg-accent/50 text-muted-foreground"
              }`}
            >
              <Moon className="size-3.5" />
              <span>Dark</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme("system")}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded text-[11px] transition-colors cursor-pointer ${
                theme === "system"
                  ? "bg-accent text-accent-foreground font-semibold"
                  : "hover:bg-accent/50 text-muted-foreground"
              }`}
            >
              <Laptop className="size-3.5" />
              <span>System</span>
            </button>
          </div>

          <DropdownMenuSeparator />

          {/* Logout / Exit Guest Mode */}
          <DropdownMenuItem
            onClick={() => setLogoutOpen(true)}
            variant="default"
            className="flex items-center gap-2.5 px-2 py-1.5 text-xs cursor-pointer"
          >
            <LogOut className="size-4" />
            <span>{isGuestActive ? "Exit Guest Mode" : "Log out"}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <LogoutDialog open={logoutOpen} onOpenChange={setLogoutOpen} />
    </>
  );
}
