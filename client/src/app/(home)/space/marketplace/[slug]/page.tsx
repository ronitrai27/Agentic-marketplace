import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../../convex/_generated/api";
import { cached } from "@/lib/redis/cache";
import { getRedis } from "@/lib/redis/client";
import { agentPageKey } from "@/lib/redis/agent-page-cache";
import { Skeleton } from "@/components/ui/skeleton";
import { jsonLd, SITE_NAME, SITE_URL } from "@/lib/site";
import { AgentPageView } from "@/modules/space/components/agent-page/agent-page-view";

// Stats, reviews and charts may be up to 20 minutes old; that is the price of not hitting Convex per visit.
const CACHE_SECONDS = 20 * 60;
// Unknown slugs are cached briefly so repeated bad URLs don't hit Convex either.
const MISS_SECONDS = 60;

async function loadAgent(slug: string) {
  const redisKey = agentPageKey(slug);
  // `cached` stores whatever load returns; wrap so a missing agent is a cacheable value, not null
  const entry = await cached(redisKey, CACHE_SECONDS, async () => {
    const agent = await fetchQuery(api.agentPage.getBySlug, { slug });
    return { agent };
  });
  if (!entry.agent) {
    // shorten the lifetime of cached misses
    await getRedis()?.expire(redisKey, MISS_SECONDS).catch(() => undefined);
  }
  return entry.agent;
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const agent = await loadAgent(slug).catch(() => null);
  if (!agent) return { title: "Agent not found", robots: { index: false, follow: false } };
  const description = clip(agent.description, 160);
  const url = `/space/marketplace/${encodeURIComponent(slug)}`;
  return {
    title: agent.name,
    description,
    keywords: [agent.name, ...agent.tags, "AI agent", "MCP"],
    alternates: { canonical: url },
    openGraph: { type: "website", url, siteName: SITE_NAME, title: `${agent.name} | ${SITE_NAME}`, description },
    twitter: { card: "summary_large_image", title: `${agent.name} | ${SITE_NAME}`, description },
  };
}

async function AgentLoader({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await loadAgent(slug);
  if (!agent) notFound();
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: agent.name,
    description: clip(agent.description, 300),
    url: `${SITE_URL}/space/marketplace/${encodeURIComponent(slug)}`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    keywords: agent.tags.join(", "),
    softwareVersion: agent.version,
    ...(agent.ratingCount > 0
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: agent.ratingAvg, ratingCount: agent.ratingCount, bestRating: 5, worstRating: 1 } }
      : {}),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />
      <AgentPageView agent={agent} />
    </>
  );
}

// Params and the Redis/Convex reads are request-time data, so they stream in behind this placeholder
export default function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="flex-1 overflow-hidden">
          <Skeleton className="h-40 sm:h-48 w-full rounded-none" />
          <div className="mx-auto max-w-4xl px-6 -mt-10 space-y-4">
            <Skeleton className="size-20 rounded-2xl" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-full max-w-2xl" />
          </div>
        </div>
      }
    >
      <AgentLoader params={params} />
    </Suspense>
  );
}
