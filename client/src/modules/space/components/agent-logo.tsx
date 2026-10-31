"use client";

import React, { useState } from "react";

/** Agent logo, or the first letter of the agent's name when none is set (or it fails to load). */
export function AgentLogo({
  name,
  logoUrl,
  className = "size-9 text-sm",
}: {
  name: string;
  logoUrl?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!logoUrl && failed !== logoUrl;

  return (
    <span
      className={`rounded-lg border border-border bg-muted flex items-center justify-center shrink-0 font-semibold text-foreground overflow-hidden ${className}`}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={`${name} logo`}
          className="size-full object-contain"
          onError={() => setFailed(logoUrl)}
        />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
