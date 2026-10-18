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
  const subSegments = spaceIndex !== -1 ? segments.slice(spaceIndex + 1) : [];

  // Helper to format titles nicely (e.g. "wallet" -> "Wallet", "my-tasks" -> "My Tasks")
  const formatTitle = (segment: string) => {
    return segment
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  return (
    <Breadcrumb>
      <BreadcrumbList className="text-xs sm:text-sm font-medium">
        <BreadcrumbItem>
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

          return (
            <React.Fragment key={href}>
              <BreadcrumbSeparator className="text-muted-foreground/60" />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage className="font-semibold text-foreground">
                    {title}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    render={<Link href={href} />}
                    className="text-muted-foreground hover:text-foreground transition-colors"
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
