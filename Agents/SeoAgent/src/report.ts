import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getChatModel } from "./graph/model.js";
import type { FullAuditWorkflowResult } from "./temporal/workflows/full-audit.workflow.js";

/**
 * Synthesize Executive Report from Verified Audit Data
 */
export async function generateVerifiedExecutiveReport(data: FullAuditWorkflowResult): Promise<string> {
  const model = getChatModel();

  const prompt = `You are an Autonomous Technical SEO & GEO Senior Director.
Synthesize the verified audit findings for: ${data.url}.

VERIFIED AUDIT EVIDENCE (From Temporal Cloud execution):
1. Static Ingestion:
   - Status: ${data.staticResult.statusCode}
   - Title: "${data.staticResult.metadata.title || "None"}"
   - Description: "${data.staticResult.metadata.metaDescription || "None"}"
   - Canonical: "${data.staticResult.metadata.declaredCanonical || "None"}"
   - Fetch Latency: ${data.staticResult.timing.totalDurationMs}ms

2. Firecrawl Verified Deep Markdown Content:
   - Scrape Success: ${data.firecrawlResult.success}
   - Scraped Title: "${data.firecrawlResult.title || "None"}"
   - Scraped Description: "${data.firecrawlResult.description || "None"}"
   - Page Content Markdown:
${data.firecrawlResult.markdown ? data.firecrawlResult.markdown.slice(0, 3000) : "No markdown returned"}

3. JEV Escalation & Browser Proof (Browserbase / Playwright):
   - Browser Escalation Required: ${data.escalationDecision.requiresBrowser}
   - JEV Reasons: [${data.escalationDecision.reasons.join("; ")}]
   - DOM Diff Discrepancies Count: ${data.browserEvidence?.domDiff.discrepancies.length ?? 0}
   - Diff Details: ${JSON.stringify(data.browserEvidence?.domDiff.discrepancies ?? [])}

4. Google Ground Truth & Core Web Vitals:
   - Performance Score: ${data.groundTruth.pageSpeed?.performanceScore ?? "N/A"}/100
   - LCP: ${data.groundTruth.pageSpeed?.coreWebVitals?.lcpMs ?? "N/A"}ms
   - CLS: ${data.groundTruth.pageSpeed?.coreWebVitals?.cls ?? "N/A"}
   - SerpApi Organic Position: #${data.groundTruth.serp?.position ?? "Unranked"}
   - Top Competitors: ${data.groundTruth.serp?.topCompetitors.join(", ") || "None"}

5. GEO Engine Visibility & Internal Link Graph:
   - Domain Cited in AI Engines: ${data.geoSemantic.geoCitation?.isDomainCited ?? false}
   - Engine: ${data.geoSemantic.geoCitation?.aiEngine ?? "None"}
   - Keyword Cannibalization Alerts: ${data.geoSemantic.cannibalizationIssues.length}
   - Orphan Pages: ${data.linkGraph.orphanPages.length}
   - Deep Pages (>3 Clicks): ${data.linkGraph.deepPages.length}

INSTRUCTIONS:
- First, clearly state what the website and company ACTUALLY do based STRICTLY on the Firecrawl Verified Scraped Content above. DO NOT guess or invent fake service categories.
- Provide a crisp, structured report with:
  - 🟢 Highlights (what's great)
  - ⚠️ Critical Technical Risks
  - 🎯 Actionable Fixes (Code & Strategy)
- Reference the exact metrics above. DO NOT invent fake numbers.`;

  try {
    const res = await model.invoke([new SystemMessage(prompt)]);
    return typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  } catch {
    const fallback = getChatModel("gpt-4o-mini");
    const res = await fallback.invoke([new SystemMessage(prompt)]);
    return typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  }
}
