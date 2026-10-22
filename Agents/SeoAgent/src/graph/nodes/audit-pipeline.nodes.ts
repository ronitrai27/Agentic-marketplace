import { AIMessage } from "@langchain/core/messages";
import type { SeoAgentStateType } from "../state.js";
import { staticCrawlActivity } from "../../activities/static-crawl.activity.js";
import { evaluateEscalationGate } from "../../jev/escalation-gate.js";
import { collectBrowserEvidenceActivity } from "../../activities/browser-evidence.activity.js";
import { groundTruthActivity } from "../../activities/ground-truth.activity.js";
import { geoSemanticActivity } from "../../activities/geo-semantic.activity.js";
import { linkGraphActivity } from "../../activities/link-graph.activity.js";
import { getChatModel } from "../model.js";

/**
 * Scout Node: Fast Static Ingestion and JEV Escalation Gate
 */
export async function scoutNode(state: SeoAgentStateType): Promise<Partial<SeoAgentStateType>> {
  const url = state.currentUrl;
  if (!url) {
    console.log("⚠️ [Scout] No URL provided for audit.");
    return { lastError: "No URL provided for audit." };
  }

  // 1. Static Ingestion (<100ms)
  console.log(`🔍 [Scout] Starting static crawl for: ${url}`);
  let scoutData;
  try {
    scoutData = await staticCrawlActivity({ url });
    console.log(
      `🔍 [Scout] Crawl complete: HTTP ${scoutData.statusCode} | Duration: ${scoutData.timing.totalDurationMs}ms | Title: "${scoutData.metadata.title || "None"}"`
    );
  } catch (err: any) {
    console.log(`❌ [Scout] Static crawl failed: ${err.message || String(err)}`);
    return {
      lastError: `Static crawl failed: ${err.message || String(err)}`,
    };
  }

  // 2. JEV Escalation Gate (Deterministic check + JEV probability)
  const escalation = await evaluateEscalationGate(scoutData);
  console.log(
    `⚡ [JEV Gate] Decision: ${escalation.decision} | Browser required: ${escalation.requiresBrowser} | Conf: ${escalation.confidence} | Source: ${escalation.source} | Reasons: [${escalation.reasons.join("; ")}]`
  );

  return {
    scoutData,
    requiresBrowser: escalation.requiresBrowser,
  };
}

/**
 * Conditional router: Decide whether to run Browser Evidence or skip directly to Pillar 3-5
 */
export function routeAfterScout(state: SeoAgentStateType): "evidenceNode" | "auditNode" {
  if (state.lastError) {
    return "auditNode";
  }
  return state.requiresBrowser ? "evidenceNode" : "auditNode";
}

/**
 * Evidence Node: Pillar 2 Proof of Issue (Playwright / Browserbase)
 */
export async function evidenceNode(state: SeoAgentStateType): Promise<Partial<SeoAgentStateType>> {
  if (!state.currentUrl || !state.scoutData) {
    return {};
  }

  console.log(`🌐 [Evidence] Escalating to Browser session for ${state.currentUrl}...`);
  try {
    const evidenceData = await collectBrowserEvidenceActivity({
      staticResult: state.scoutData,
      captureScreenshot: true,
    });
    console.log(
      `🌐 [Evidence] Browser completed | Discrepancies: ${evidenceData.domDiff.discrepancies.length} | Screenshot captured`
    );

    return { evidenceData };
  } catch (err: any) {
    console.log(`⚠️ [Evidence] Browser capture warning: ${err.message || String(err)}`);
    return {
      lastError: `Evidence capture warning: ${err.message || String(err)}`,
    };
  }
}

/**
 * Audit Node: Runs Pillars 3, 4, and 5 in parallel clean steps
 */
export async function auditNode(state: SeoAgentStateType): Promise<Partial<SeoAgentStateType>> {
  if (!state.currentUrl || state.lastError) {
    return {};
  }

  const url = state.currentUrl;
  const brandName = state.scoutData?.metadata.title?.split(/[-|]/)[0]?.trim() || "Brand";

  console.log(`📊 [Audit] Running Pillars 3-5 (PageSpeed, SerpApi, GEO, Link Graph)...`);

  // Execute Ground Truth, GEO, and Link Graph concurrently
  const [groundTruth, geoData, linkGraphData] = await Promise.all([
    groundTruthActivity({ url, targetKeyword: brandName }),
    geoSemanticActivity({
      targetDomain: new URL(url).hostname,
      samplePages: [
        {
          url,
          title: state.scoutData?.metadata.title || "Home",
          description: state.scoutData?.metadata.metaDescription,
        },
      ],
      testQuery: brandName,
    }),
    linkGraphActivity({
      rootUrl: url,
      pages: [
        {
          url,
          internalLinks: [],
        },
      ],
    }),
  ]);

  console.log(
    `📊 [Audit] Pillars 3-5 completed | PageSpeed: ${groundTruth.pageSpeed?.performanceScore ?? "N/A"}/100 | SERP: #${groundTruth.serp?.position ?? "Unranked"} | GEO Cited: ${geoData.geoCitation?.isDomainCited ?? false} | Orphan Pages: ${linkGraphData.orphanPages.length}`
  );

  return {
    groundTruth,
    geoData,
    linkGraphData,
  };
}

/**
 * Summary Node: Synthesizes all 5 pillars into an executive AI response using gpt-4.1-mini
 */
export async function summaryNode(state: SeoAgentStateType): Promise<Partial<SeoAgentStateType>> {
  if (state.lastError && !state.scoutData) {
    return { auditComplete: true };
  }

  console.log(`📝 [Summary] Synthesizing audit report for ${state.currentUrl}...`);
  const model = getChatModel();

  const auditReportPrompt = `You are an Autonomous SEO & GEO Senior Lead.
Synthesize the technical audit for: ${state.currentUrl}.

AUDIT FINDINGS:
1. Static Crawl (Pillar 1):
   - Status: ${state.scoutData?.statusCode}
   - Title: ${state.scoutData?.metadata.title || "None"}
   - Description: ${state.scoutData?.metadata.metaDescription || "None"}
   - Canonical: ${state.scoutData?.metadata.declaredCanonical || "None"}
   - Latency: ${state.scoutData?.timing.totalDurationMs}ms
   - SPA Heuristic: ${state.scoutData?.spaIndicators.isPotentialClientOnlySpa}

2. Browser Evidence (Pillar 2):
   - Escalated to Browser: ${state.requiresBrowser}
   - Discrepancies Found: ${state.evidenceData?.domDiff.discrepancies.length ?? 0}
   - Diff Summary: ${JSON.stringify(state.evidenceData?.domDiff.discrepancies ?? [])}

3. Ground Truth (Pillar 3):
   - Google PageSpeed Score: ${state.groundTruth?.pageSpeed?.performanceScore ?? "N/A"}/100
   - LCP: ${state.groundTruth?.pageSpeed?.coreWebVitals?.lcpMs ?? "N/A"}ms
   - CLS: ${state.groundTruth?.pageSpeed?.coreWebVitals?.cls ?? "N/A"}
   - SerpApi Rank: ${state.groundTruth?.serp?.position ?? "Unranked"}
   - Top Competitors: ${state.groundTruth?.serp?.topCompetitors?.join(", ") || "None"}

4. GEO & Semantic Cannibalization (Pillar 4):
   - Domain Cited in AI Engines: ${state.geoData?.geoCitation?.isDomainCited ?? false}
   - Engine: ${state.geoData?.geoCitation?.aiEngine ?? "None"}
   - Cannibalization Alerts: ${state.geoData?.cannibalizationIssues.length ?? 0}

5. Internal Link Graph & PageRank (Pillar 5):
   - Total Scanned: ${state.linkGraphData?.totalPages ?? 0} pages
   - Orphan Pages: ${state.linkGraphData?.orphanPages.length ?? 0}
   - Deep Pages (>3 clicks): ${state.linkGraphData?.deepPages.length ?? 0}

Provide an ultra-crisp, executive summary with:
- 🟢 Highlights (what's great)
- ⚠️ Critical Technical Risks
- 🎯 Actionable Fixes (Code & Strategy)
Invite the user to ask follow-up questions about any pillar!`;

  let response: AIMessage;
  try {
    response = (await model.invoke(auditReportPrompt)) as AIMessage;
  } catch {
    const fallbackModel = getChatModel("gpt-4o-mini");
    response = (await fallbackModel.invoke(auditReportPrompt)) as AIMessage;
  }

  console.log(`✅ [Summary] Audit report generated successfully.`);

  return {
    messages: [response],
    auditComplete: true,
  };
}
