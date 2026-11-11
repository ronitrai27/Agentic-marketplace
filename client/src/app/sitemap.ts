import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import { SITE_URL } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Read agents at request time, not during the build prerender.
  await connection();
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/space/marketplace`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/llms.txt`, lastModified: now, changeFrequency: "daily", priority: 0.3 },
  ];

  // One entry per active agent. If Convex is unreachable at build time, still ship the static pages.
  try {
    const agents = await fetchQuery(api.agents.listMarketplace, {});
    for (const a of agents) {
      pages.push({
        url: `${SITE_URL}/space/marketplace/${encodeURIComponent(a.slug)}`,
        lastModified: new Date(a.createdAt),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  } catch (e) {
    console.error("sitemap: could not load agents", e);
  }
  return pages;
}
