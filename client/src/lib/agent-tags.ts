/**
 * Tags a creator picks for an agent (min 2, max 4).
 *
 * Two groups:
 *  - "category": WHAT the agent does. One tag covers many related jobs; the specific words
 *    people search for live in `keywords` (e.g. "plagiarism" finds Writing & Language tags).
 *  - "feature":  HOW the agent behaves (speed, depth, tools). Creator claims; the marketplace
 *    shows measured badges separately.
 *
 * To add a tag, add one entry here. Search needs no other change.
 */

export type TagGroup = "category" | "feature";

export interface AgentTag {
  id: string;
  label: string;
  group: TagGroup;
  /** Extra words that should find this tag. Lowercase. */
  keywords: string[];
}

export const MIN_TAGS = 2;
export const MAX_TAGS = 4;

export const TAG_GROUP_LABEL: Record<TagGroup, string> = {
  category: "What it does",
  feature: "How it behaves",
};

export const AGENT_TAGS: AgentTag[] = [
  // ───── What it does ─────
  { id: "research", label: "Research", group: "category", keywords: ["web research", "investigate", "find information", "report", "literature review", "due diligence", "briefing", "analysis"] },
  { id: "deep-research", label: "Deep Research", group: "category", keywords: ["multi-source", "long report", "comprehensive", "in-depth", "citations", "whitepaper"] },
  { id: "competitor-analysis", label: "Competitor Analysis", group: "category", keywords: ["competitor", "competitive intelligence", "benchmark", "swot", "market positioning", "alternatives"] },
  { id: "market-research", label: "Market Research", group: "category", keywords: ["market size", "trends", "industry report", "customer research", "tam", "survey analysis"] },
  { id: "fact-checking", label: "Fact Checking", group: "category", keywords: ["verify claims", "misinformation", "source check", "validation", "debunk"] },
  { id: "summarization", label: "Summarization", group: "category", keywords: ["summarize", "summary", "tldr", "digest", "condense", "abstract", "key points"] },
  { id: "text-classification", label: "Text Classification", group: "category", keywords: ["classify", "categorize", "sentiment", "tagging", "labeling", "intent detection", "spam", "topic detection"] },
  { id: "plagiarism-check", label: "Plagiarism Check", group: "category", keywords: ["plagiarism", "duplicate content", "originality", "similarity check", "copy detection", "ai content detection"] },
  { id: "rewriting", label: "Rewriting & Rephrasing", group: "category", keywords: ["rephrase", "paraphrase", "rewrite", "tone change", "simplify", "humanize", "shorten", "expand text"] },
  { id: "translation", label: "Translation", group: "category", keywords: ["translate", "localization", "localisation", "language conversion", "multilingual", "subtitles"] },
  { id: "content-writing", label: "Content Writing", group: "category", keywords: ["story", "story writer", "blog", "article", "copywriting", "script", "essay", "storytelling", "ghostwriting"] },
  { id: "proofreading", label: "Proofreading", group: "category", keywords: ["grammar", "spelling", "editing", "copy edit", "style check", "typos"] },
  { id: "lead-generation", label: "Lead Generation", group: "category", keywords: ["leads", "lead finder", "prospecting", "verified leads", "contact list", "email finder", "icp", "prospect list"] },
  { id: "b2b-sales", label: "B2B Sales", group: "category", keywords: ["b2b", "saas", "sales", "enterprise", "account research", "decision makers", "pipeline"] },
  { id: "data-enrichment", label: "Data Enrichment", group: "category", keywords: ["enrich", "company data", "firmographics", "contact data", "tech stack", "append data", "dedupe"] },
  { id: "outreach", label: "Outreach", group: "category", keywords: ["cold email", "email outreach", "sequence", "follow-up", "linkedin message", "personalized message", "intro email"] },
  { id: "email-marketing", label: "Email Marketing", group: "category", keywords: ["newsletter", "campaign", "subject line", "drip", "email copy", "mailing list"] },
  { id: "social-media", label: "Social Media", group: "category", keywords: ["posts", "twitter", "instagram", "linkedin post", "content calendar", "captions", "threads"] },
  { id: "ad-copy", label: "Ads & Copywriting", group: "category", keywords: ["ads", "google ads", "meta ads", "headline", "landing page copy", "cta", "creative"] },
  { id: "seo", label: "SEO", group: "category", keywords: ["search engine optimization", "keywords", "backlinks", "technical seo", "serp", "rank", "meta tags", "content brief", "site audit"] },
  { id: "ai-search-geo", label: "AI Search (GEO)", group: "category", keywords: ["geo", "generative engine optimization", "ai citations", "chatgpt visibility", "llm seo", "ai overview"] },
  { id: "web-audit", label: "Website Audit", group: "category", keywords: ["site audit", "core web vitals", "pagespeed", "performance", "broken links", "crawl", "lighthouse"] },
  { id: "code-review", label: "Code Review", group: "category", keywords: ["pull request", "pr review", "code quality", "refactor", "lint", "best practices", "bugs", "static analysis"] },
  { id: "ui-ux-testing", label: "UI / UX Testing", group: "category", keywords: ["web ui tester", "ui test", "usability", "visual regression", "accessibility", "design review", "user flow", "screenshots"] },
  { id: "qa-testing", label: "QA & Test Automation", group: "category", keywords: ["test generation", "unit tests", "e2e", "api testing", "regression", "test cases", "bug report"] },
  { id: "security-scan", label: "Security Scanning", group: "category", keywords: ["vulnerability", "pentest", "owasp", "dependency audit", "secrets scan", "cve", "security review"] },
  { id: "documentation", label: "Documentation", group: "category", keywords: ["docs", "readme", "api docs", "changelog", "technical writing", "comments", "explain code"] },
  { id: "jobs-careers", label: "Jobs & Careers", group: "category", keywords: ["job search", "job match", "resume", "cv", "cover letter", "interview prep", "ats", "salary", "career"] },
  { id: "recruiting", label: "Recruiting", group: "category", keywords: ["hiring", "candidate screening", "job description", "sourcing", "talent", "shortlist", "hr"] },
  { id: "data-extraction", label: "Data Extraction", group: "category", keywords: ["scrape", "scraping", "parse", "pdf", "invoice", "ocr", "receipt", "table extraction", "structured data", "forms"] },
  { id: "spreadsheets-data", label: "Spreadsheets & Data", group: "category", keywords: ["csv", "excel", "clean data", "analysis", "charts", "pivot", "data cleaning", "sql", "dashboard"] },
  { id: "ecommerce", label: "E-commerce", group: "category", keywords: ["shopify", "product listing", "catalog", "sku", "amazon", "dropshipping", "product description", "store"] },
  { id: "price-monitoring", label: "Price & Market Monitoring", group: "category", keywords: ["price tracker", "price monitor", "stock check", "competitor prices", "alerts", "deal finder"] },
  { id: "finance", label: "Finance", group: "category", keywords: ["accounting", "invoices", "expenses", "bookkeeping", "financial report", "earnings", "reconciliation", "budget"] },
  { id: "legal-compliance", label: "Legal & Compliance", group: "category", keywords: ["contract", "contract review", "policy", "gdpr", "terms", "kyc", "regulation", "privacy policy", "clauses"] },
  { id: "customer-support", label: "Customer Support", group: "category", keywords: ["tickets", "helpdesk", "support reply", "faq", "chatbot", "triage", "knowledge base", "complaints"] },
  { id: "crm-sales-ops", label: "CRM & Sales Ops", group: "category", keywords: ["hubspot", "salesforce", "pipeline", "crm sync", "deal", "forecast", "sales ops"] },
  { id: "meetings-transcripts", label: "Meetings & Transcripts", group: "category", keywords: ["transcription", "meeting notes", "action items", "minutes", "call summary", "speech to text", "podcast"] },
  { id: "design-creative", label: "Design & Creative", group: "category", keywords: ["image", "logo", "brand", "branding", "mockup", "illustration", "thumbnail", "video script", "storyboard"] },
  { id: "education", label: "Education & Tutoring", group: "category", keywords: ["tutor", "learning", "quiz", "study", "lesson plan", "homework", "flashcards", "course"] },
  { id: "travel-real-estate", label: "Travel & Real Estate", group: "category", keywords: ["trip planner", "itinerary", "flights", "hotels", "property", "listings", "rent", "relocation"] },
  { id: "personal-productivity", label: "Productivity & Automation", group: "category", keywords: ["workflow", "automation", "calendar", "scheduling", "email triage", "task manager", "to-do", "assistant"] },

  // ───── How it behaves ─────
  { id: "instant-response", label: "Instant Response", group: "feature", keywords: ["fast", "real time", "quick", "low latency", "seconds", "realtime"] },
  { id: "long-running", label: "Long Running", group: "feature", keywords: ["background", "async", "takes minutes", "slow", "hours", "durable", "queue"] },
  { id: "deep-agent", label: "Deep Agent", group: "feature", keywords: ["multi-step", "autonomous", "planning", "reasoning", "agentic", "thorough", "complex tasks"] },
  { id: "heavy-tool-use", label: "Heavy Tool Use", group: "feature", keywords: ["many tools", "tool calling", "apis", "integrations", "function calling", "mcp"] },
  { id: "live-web-data", label: "Live Web Data", group: "feature", keywords: ["web search", "browsing", "up to date", "real-time data", "fresh data", "internet access"] },
  { id: "browser-automation", label: "Browser Automation", group: "feature", keywords: ["headless browser", "playwright", "puppeteer", "click", "navigate", "browserbase", "web actions"] },
  { id: "file-upload", label: "Accepts Files", group: "feature", keywords: ["upload", "pdf input", "documents", "attachments", "images input", "resume upload", "csv upload"] },
  { id: "human-in-the-loop", label: "Asks Follow-ups", group: "feature", keywords: ["conversational", "human in the loop", "clarifying questions", "approval", "multi-turn", "chat"] },
  { id: "bulk-processing", label: "Bulk / Batch", group: "feature", keywords: ["batch", "many items", "list input", "high volume", "hundreds", "at scale"] },
  { id: "structured-output", label: "Structured Output", group: "feature", keywords: ["json", "schema", "typed output", "csv output", "api friendly", "machine readable"] },
  { id: "cited-sources", label: "Cites Sources", group: "feature", keywords: ["citations", "references", "links", "evidence", "verifiable", "sources"] },
  { id: "verified-results", label: "Verified Results", group: "feature", keywords: ["validated", "checked", "double checked", "accurate", "fact checked", "high precision"] },
  { id: "multi-language", label: "Multi-language", group: "feature", keywords: ["multilingual", "many languages", "hindi", "spanish", "global", "non-english"] },
  { id: "monitoring-alerts", label: "Monitoring & Alerts", group: "feature", keywords: ["scheduled", "recurring", "watch", "notify", "cron", "track changes"] },
  { id: "multi-agent", label: "Multi-agent", group: "feature", keywords: ["agent team", "subagents", "orchestrator", "swarm", "crew", "parallel agents"] },
];

// ─────────────────────────────────────────────────
//  Search
// ─────────────────────────────────────────────────

export interface TagMatch {
  tag: AgentTag;
  /** The keyword that matched when it was not the label itself (shown as a hint). */
  via?: string;
}

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

/**
 * Finds tags by label or sub-keyword. Every word typed must match somewhere in the tag,
 * so "cold email" finds Outreach and "pdf invoice" finds Data Extraction.
 * Ranking: label starts with query > label contains > keyword starts with > keyword contains.
 */
export function searchTags(query: string, tags: AgentTag[] = AGENT_TAGS): TagMatch[] {
  const q = norm(query);
  if (!q) return tags.map((tag) => ({ tag }));
  const words = q.split(" ");

  const scored: Array<TagMatch & { score: number }> = [];
  for (const tag of tags) {
    const label = norm(tag.label);
    const haystack = [label, ...tag.keywords.map(norm)].join(" | ");
    if (!words.every((w) => haystack.includes(w))) continue;

    let score = 0;
    let via: string | undefined;
    if (label.startsWith(q)) score = 4;
    else if (label.includes(q)) score = 3;
    else {
      const kw = tag.keywords.map(norm);
      const starts = kw.find((k) => k.startsWith(q));
      const contains = kw.find((k) => k.includes(q));
      if (starts) { score = 2; via = starts; }
      else if (contains) { score = 1; via = contains; }
      else {
        // multi-word query matched across label and keywords
        via = kw.find((k) => words.some((w) => k.includes(w)));
      }
    }
    scored.push({ tag, via: label.includes(q) ? undefined : via, score });
  }
  return scored.sort((a, b) => b.score - a.score).map(({ tag, via }) => ({ tag, via }));
}

export const tagById = (id: string): AgentTag | undefined => AGENT_TAGS.find((t) => t.id === id);

/** Valid when the count is within bounds and every id is a known tag. */
export function validateTags(ids: string[]): { ok: boolean; message?: string } {
  if (new Set(ids).size !== ids.length) return { ok: false, message: "Duplicate tags." };
  if (ids.some((id) => !tagById(id))) return { ok: false, message: "Unknown tag." };
  if (ids.length < MIN_TAGS) return { ok: false, message: `Pick at least ${MIN_TAGS} tags.` };
  if (ids.length > MAX_TAGS) return { ok: false, message: `Pick at most ${MAX_TAGS} tags.` };
  return { ok: true };
}
