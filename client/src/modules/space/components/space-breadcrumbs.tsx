"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export function SpaceBreadcrumbs() {
  const pathname = usePathname();

  // Extract path segments (e.g. "/space/wallet" -> ["space", "wallet"])
  const segments = pathname ? pathname.split("/").filter(Boolean) : [];

  // Determine sub-segments relative to "space"
  const spaceIndex = segments.indexOf("space");
  const allSub = spaceIndex !== -1 ? segments.slice(spaceIndex + 1) : [];
  // /space/chat/<uuid> shows just "Chat"; the id is noise
  const subSegments = allSub[0] === "chat" ? ["chat"] : allSub;

  // Helper to format titles nicely (e.g. "wallet" -> "Wallet", "my-tasks" -> "My Tasks")
  const formatTitle = (segment: string) => {
    return segment
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="text-xs sm:text-sm font-medium flex-nowrap">
        <BreadcrumbItem className="shrink-0">
          {subSegments.length === 0 ? (
            <BreadcrumbPage className="font-semibold text-foreground">
              Space
            </BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              render={<Link href="/space" />}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Space
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {subSegments.map((segment, idx) => {
          const isLast = idx === subSegments.length - 1;
          const href = `/space/${subSegments.slice(0, idx + 1).join("/")}`;
          const title = formatTitle(segment);
          const isAgentOrLong = isLast && title.length > 8;
          const displayTitle = isAgentOrLong
            ? `${title.slice(0, 8)}...`
            : title;

          return (
            <React.Fragment key={href}>
              <BreadcrumbSeparator className="text-muted-foreground/60 shrink-0" />
              <BreadcrumbItem className="min-w-0">
                {isLast ? (
                  <BreadcrumbPage
                    title={title}
                    className="font-semibold text-foreground truncate max-w-[80px] sm:max-w-[100px] inline-block align-bottom"
                  >
                    {displayTitle}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    render={<Link href={href} />}
                    title={title}
                    className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[90px] sm:max-w-[110px] inline-block align-bottom"
                  >
                    {title}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
