"use client";

import React, { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";

// Nature and abstract only. One is picked at random per visit, independent of the agent.
const IMAGES = [
  "photo-1506744038136-46273834b3fb",
  "photo-1470071459604-3b5ec3a7fe05",
  "photo-1441974231531-c6227db76b6e",
  "photo-1501785888041-af3ef285b470",
  "photo-1519681393784-d120267933ba",
  "photo-1464822759023-fed622ff2c3b",
  "photo-1472214103451-9374bd1c798e",
  "photo-1557682250-33bd709cbe85",
  "photo-1558591710-4b4a1ae0f04d",
  "photo-1620121692029-d088224ddc74",
  "photo-1550684848-fac1c5b4e853",
];

const src = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=2000&h=480&q=70`;

/** Short wide cover image, Notion style. Starts as a soft gradient, then fades the photo in. */
export function AgentBanner() {
  const [url, setUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Picked after mount so server HTML and the first client render match
  useEffect(() => {
    setUrl(src(IMAGES[Math.floor(Math.random() * IMAGES.length)]));
  }, []);

  return (
    <div className="relative h-40 sm:h-48 w-full overflow-hidden bg-gradient-to-br from-muted to-muted/40">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          onLoad={() => setReady(true)}
          className={`absolute inset-0 size-full object-cover transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
        />
      )}
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Spinner className="size-5" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}
