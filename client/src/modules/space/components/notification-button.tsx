"use client";

import React from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NotificationButton() {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Notifications"
      className="size-8 rounded-md text-foreground hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
    >
      <Bell className="size-4" />
      <span className="sr-only">Notifications</span>
    </Button>
  );
}
