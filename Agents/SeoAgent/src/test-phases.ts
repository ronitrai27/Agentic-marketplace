import { staticCrawlActivity } from "./activities/static-crawl.activity.js";
import { evaluateEscalationGate } from "./jev/escalation-gate.js";
import { collectBrowserEvidenceActivity } from "./activities/browser-evidence.activity.js";

async function runPhasesTest() {
  console.log("==================================================================");
  console.log("🧪 TESTING DUAL-TIER CRAWL & EVIDENCE PIPELINE (Phase 1 & Phase 2)");
  console.log("==================================================================\n");

  const targetUrl = process.argv[2] || "https://example.com";

  // 1. Static Ingestion Pass (Tier 1)
  console.log(`📡 [Pass 1] Running Fast Static Crawl for: ${targetUrl}...`);
  const staticResult = await staticCrawlActivity({ url: targetUrl });
  console.log(`✅ Static Pass Finished in ${staticResult.timing.totalDurationMs}ms (HTTP ${staticResult.statusCode})`);
  console.log(`- SHA-256: ${staticResult.contentHash}`);
  console.log(`- SPA Check: hasRootContainer=${staticResult.spaIndicators.hasRootContainer}, scripts=${staticResult.spaIndicators.scriptCount}`);

  // 2. JEV Hydration & Escalation Gate (Phase 1)
  console.log(`\n🚪 [Phase 1] Evaluating JEV Hydration & Escalation Gate...`);
  const gateDecision = await evaluateEscalationGate(staticResult);
  console.log(`Outcome: ${gateDecision.decision === "STATIC_COMPLETE" ? "🟢 STATIC_COMPLETE" : "🟡 ESCALATE_TO_BROWSER"}`);
  console.log(`- Decision Source: ${gateDecision.source}`);
  console.log(`- Confidence: ${gateDecision.confidence}`);
  console.log(`- Reasons:`, gateDecision.reasons);
  console.log(`- Gate Evaluation Latency: ${gateDecision.durationMs}ms`);

  // 3. Browserbase & Playwright Evidence Engine (Phase 2)
  console.log(`\n📸 [Phase 2] Executing Browserbase & Playwright Evidence Engine...`);
  const evidenceResult = await collectBrowserEvidenceActivity({ staticResult });
  console.log(`✅ Evidence Engine Completed in ${evidenceResult.durationMs}ms`);
  console.log(`- Browser Provider: ${evidenceResult.browserProvider} ${evidenceResult.sessionId ? `(Session: ${evidenceResult.sessionId})` : ""}`);
  console.log(`- Rendered Title: "${evidenceResult.renderedMetadata.title}"`);
  console.log(`- Rendered H1 Tags:`, evidenceResult.renderedMetadata.h1Tags);
  console.log(`- DOM Diff Discrepancies: ${evidenceResult.domDiff.discrepancies.length}`);
  if (evidenceResult.domDiff.discrepancies.length > 0) {
    console.log(evidenceResult.domDiff.discrepancies);
  }
  console.log(`- Visual Bounding Box:`, evidenceResult.evidencePackage.boundingBox);
  console.log(`- Screenshot Generated: ${Boolean(evidenceResult.evidencePackage.screenshotUrl)}`);
  console.log(`- Detected SEO Issues: ${evidenceResult.detectedIssues.length}`);

  console.log("\n==================================================================");
  console.log("🎉 Phase 1 & Phase 2 verification complete!");
  console.log("==================================================================");
}

runPhasesTest().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
