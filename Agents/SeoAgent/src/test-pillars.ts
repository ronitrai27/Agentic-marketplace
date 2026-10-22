import { groundTruthActivity } from "./activities/ground-truth.activity.js";
import { geoSemanticActivity } from "./activities/geo-semantic.activity.js";
import { linkGraphActivity } from "./activities/link-graph.activity.js";

async function runPillarsTest() {
  console.log("==================================================================");
  console.log("🧪 TESTING PILLARS 3, 4, 5 (Ground Truth, GEO, Link Graph)");
  console.log("==================================================================\n");

  // 1. Pillar 3: Ground Truth (PageSpeed + SerpApi)
  console.log("📊 [Pillar 3] Testing Ground Truth (PageSpeed + SerpApi)...");
  const groundTruth = await groundTruthActivity({
    url: "https://example.com",
    targetKeyword: "example domain",
  });
  console.log("PageSpeed Result:", groundTruth.pageSpeed || "Not configured");
  console.log("SerpApi Result:", groundTruth.serp || "Not configured");

  // 2. Pillar 4: GEO & Semantic Cannibalization
  console.log("\n🌐 [Pillar 4] Testing GEO & Semantic Cannibalization...");
  const geoResult = await geoSemanticActivity({
    targetDomain: "example.com",
    samplePages: [
      {
        url: "https://example.com/best-seo-tools",
        title: "Best SEO Tools 2026 - Complete Review Guide",
        description: "Compare the best SEO software and top tools for website audits and rankings.",
      },
      {
        url: "https://example.com/top-seo-software",
        title: "Top SEO Software Guide - Best Tools 2026",
        description: "Review top SEO tools and software for technical audits and rank tracking.",
      },
      {
        url: "https://example.com/pricing",
        title: "Pricing Plans - Enterprise SEO Platform",
        description: "Monthly and annual subscription pricing plans for teams.",
      },
    ],
    testQuery: "best technical SEO audit software",
  });
  console.log("Cannibalization Issues Found:", geoResult.cannibalizationIssues);
  console.log("GEO Citation Result:", geoResult.geoCitation || "Skipped (no query)");

  // 3. Pillar 5: Internal Link Graph & PageRank
  console.log("\n🕸️ [Pillar 5] Testing Link Graph & PageRank Engine...");
  const graphResult = await linkGraphActivity({
    rootUrl: "https://example.com",
    pages: [
      {
        url: "https://example.com",
        internalLinks: ["https://example.com/about", "https://example.com/blog", "https://example.com/pricing"],
      },
      {
        url: "https://example.com/about",
        internalLinks: ["https://example.com", "https://example.com/pricing"],
      },
      {
        url: "https://example.com/blog",
        internalLinks: ["https://example.com/blog/seo-guide"],
      },
      {
        url: "https://example.com/blog/seo-guide",
        internalLinks: ["https://example.com/blog/deep-page"],
      },
      {
        url: "https://example.com/blog/deep-page",
        internalLinks: ["https://example.com/blog/super-deep-page"],
      },
      {
        url: "https://example.com/blog/super-deep-page",
        internalLinks: [],
      },
      {
        url: "https://example.com/orphan-article",
        internalLinks: [],
      },
    ],
  });

  console.log(`Total Pages Mapped: ${graphResult.totalPages}`);
  console.log("Orphan Pages (0 Inbound Links):", graphResult.orphanPages);
  console.log("Deep Pages (>3 Clicks From Root):", graphResult.deepPages);
  console.log("Top PageRank Equity Scores:", graphResult.pageRankScores);

  console.log("\n==================================================================");
  console.log("🎉 All 3 Pillars (3, 4, 5) tested successfully!");
  console.log("==================================================================");
}

runPillarsTest().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
