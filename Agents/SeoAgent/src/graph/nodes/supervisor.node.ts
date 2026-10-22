import { AIMessage, SystemMessage } from "@langchain/core/messages";
import type { SeoAgentStateType } from "../state.js";
import { getChatModel } from "../model.js";

const URL_REGEX = /https?:\/\/[^\s/$.?#].[^\s]*/i;

export async function supervisorNode(state: SeoAgentStateType): Promise<Partial<SeoAgentStateType>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const query = typeof lastMessage?.content === "string" ? lastMessage.content : "";

  // 1. Detect if the user provided a URL to audit
  const match = query.match(URL_REGEX);
  const detectedUrl = match ? match[0].replace(/[),.;]+$/, "") : null;

  if (detectedUrl && detectedUrl !== state.currentUrl) {
    console.log(`🎯 [Supervisor] Target URL detected: ${detectedUrl} -> Starting Audit Pipeline`);
    // New URL requested -> start audit pipeline
    return {
      currentUrl: detectedUrl,
      auditComplete: false,
      scoutData: null,
      evidenceData: null,
      groundTruth: null,
      geoData: null,
      linkGraphData: null,
      lastError: null,
    };
  }

  // 2. If no new URL, but we have prior audit memory -> Answer from memory using gpt-4.1-mini
  const model = getChatModel();

  if (state.auditComplete && state.currentUrl) {
    console.log(`💬 [Supervisor] Answering follow-up query from memory for: ${state.currentUrl}`);
    const contextPrompt = `You are an elite Autonomous SEO & Generative Engine Optimization (GEO) Senior Technical Director.
The user is asking follow-up questions about the audited site: ${state.currentUrl}.

Here is the Ground Truth & Technical Data from the audit memory:
- Static Crawl: Title="${state.scoutData?.metadata.title || "None"}", Status=${state.scoutData?.statusCode}, Description="${state.scoutData?.metadata.metaDescription || "None"}", Canonical="${state.scoutData?.metadata.declaredCanonical || "None"}"
- Client Hydration & Proof of Issue: Escalated=${state.requiresBrowser}, Discrepancies Count=${state.evidenceData?.domDiff.discrepancies.length ?? 0}, Diff Details=${JSON.stringify(state.evidenceData?.domDiff.discrepancies ?? [])}
- Google PageSpeed Insights: Score=${state.groundTruth?.pageSpeed?.performanceScore ?? "N/A"}/100, LCP=${state.groundTruth?.pageSpeed?.coreWebVitals?.lcpMs ?? "N/A"}ms, CLS=${state.groundTruth?.pageSpeed?.coreWebVitals?.cls ?? "N/A"}
- SerpApi Ground Truth: Rank=${state.groundTruth?.serp?.position ?? "Unranked"}, Competitors=${state.groundTruth?.serp?.topCompetitors.join(", ") ?? "None"}
- GEO & Semantic Cannibalization: Domain Cited=${state.geoData?.geoCitation?.isDomainCited ?? false}, Engine=${state.geoData?.geoCitation?.aiEngine ?? "None"}, Cannibalization Pairs=${state.geoData?.cannibalizationIssues.length ?? 0}
- Link Graph: Total Pages=${state.linkGraphData?.totalPages ?? 0}, Orphan Pages=${state.linkGraphData?.orphanPages.length ?? 0}, Deep Pages (>3)=${state.linkGraphData?.deepPages.length ?? 0}
- Scraped Page Content (Firecrawl Markdown Extract):
${state.scrapedContent?.markdown ? state.scrapedContent.markdown.slice(0, 3000) : "None"}

Answer the user's inquiry thoroughly, authoritatively, and concisely. DO NOT re-crawl or make up fake metrics. Reference the exact audit memory and scraped page content above.`;

    try {
      const response = await model.invoke([
        new SystemMessage(contextPrompt),
        ...state.messages,
      ]);
      return { messages: [response] };
    } catch {
      const fallbackModel = getChatModel("gpt-4o-mini");
      const response = await fallbackModel.invoke([
        new SystemMessage(contextPrompt),
        ...state.messages,
      ]);
      return { messages: [response] };
    }
  }

  // 3. Casual chit-chat or general request with no URL yet
  console.log("👋 [Supervisor] Conversational inquiry handled");
  const greetingPrompt = `You are the Autonomous SEO & GEO Intelligence Agent.
You assist users by auditing websites across 5 core pillars:
1. Fast Static Ingestion & Guardrails
2. Browser Proof of Issue (Playwright / Browserbase)
3. Google PageSpeed (CWV) & SerpApi Rank
4. GEO Engine Citations & Semantic Cannibalization
5. Internal Link Graph & PageRank
Plus parallel Firecrawl scraping for deep page content understanding.

Invite the user to share a URL they'd like audited, or answer any general SEO/GEO questions. Keep it brief and professional.`;

  try {
    const response = await model.invoke([
      new SystemMessage(greetingPrompt),
      ...state.messages,
    ]);
    return { messages: [response] };
  } catch {
    const fallbackModel = getChatModel("gpt-4o-mini");
    const response = await fallbackModel.invoke([
      new SystemMessage(greetingPrompt),
      ...state.messages,
    ]);
    return { messages: [response] };
  }
}

/**
 * Conditional router: Decide whether to enter audit & scraping pipeline or stay in conversational chat
 */
export function routeAfterSupervisor(
  state: SeoAgentStateType
): ("scoutNode" | "firecrawlNode")[] | "__end__" {
  if (state.currentUrl && !state.auditComplete) {
    return ["scoutNode", "firecrawlNode"];
  }
  return "__end__";
}
