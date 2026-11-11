/**
 * Key capabilities: short bullet points a creator adds after registering, shown in the agent sheet.
 * Suggestions come from the agent's tags (keyed by tag id in agent-tags.ts).
 */

export const MAX_CAPABILITIES = 12;
export const MAX_CAPABILITY_CHARS = 80;

export const TAG_CAPABILITY_SUGGESTIONS: Record<string, string[]> = {
  "research": ["Multi-source web research", "Extracts and synthesizes key insights", "Generates structured reports"],
  "deep-research": ["Cross-checks many sources", "Writes long, cited reports", "Supports custom depth & instructions"],
  "competitor-analysis": ["Profiles competitors side by side", "Builds SWOT summaries", "Spots positioning gaps"],
  "market-research": ["Estimates market size & trends", "Summarizes industry reports", "Analyzes customer segments"],
  "fact-checking": ["Verifies claims against sources", "Flags misinformation", "Returns evidence links"],
  "summarization": ["Condenses long documents", "Extracts key points", "Adjustable summary length"],
  "text-classification": ["Classifies text into categories", "Detects sentiment & intent", "Batch labeling support"],
  "plagiarism-check": ["Detects duplicate content", "Scores originality", "Flags AI-written text"],
  "rewriting": ["Rephrases in any tone", "Simplifies complex text", "Shortens or expands copy"],
  "translation": ["Translates between many languages", "Keeps tone and formatting", "Handles localization"],
  "content-writing": ["Writes blogs & articles", "Drafts stories and scripts", "Matches your brand voice"],
  "proofreading": ["Fixes grammar & spelling", "Improves clarity & style", "Highlights every change"],
  "lead-generation": ["Finds leads matching your ICP", "Returns verified contacts", "Builds prospect lists"],
  "b2b-sales": ["Researches target accounts", "Identifies decision makers", "Supports pipeline building"],
  "data-enrichment": ["Enriches company & contact data", "Appends firmographics", "Dedupes records"],
  "outreach": ["Writes personalized cold emails", "Drafts follow-up sequences", "Crafts LinkedIn messages"],
  "email-marketing": ["Writes campaign emails", "Generates subject lines", "Plans drip sequences"],
  "social-media": ["Writes platform-ready posts", "Plans content calendars", "Generates captions & threads"],
  "ad-copy": ["Writes ad headlines & copy", "Tailors copy per platform", "Drafts landing page copy"],
  "seo": ["Audits on-page & technical SEO", "Finds keyword opportunities", "Builds content briefs"],
  "ai-search-geo": ["Checks AI search visibility", "Finds citation opportunities", "Suggests GEO fixes"],
  "web-audit": ["Crawls and audits websites", "Finds broken links", "Reports performance issues"],
  "code-review": ["Reviews pull requests", "Finds bugs & code smells", "Suggests refactors"],
  "ui-ux-testing": ["Tests user flows", "Checks accessibility", "Captures screenshots of issues"],
  "qa-testing": ["Generates test cases", "Writes unit & e2e tests", "Produces bug reports"],
  "security-scan": ["Scans for vulnerabilities", "Audits dependencies", "Detects leaked secrets"],
  "documentation": ["Generates READMEs & API docs", "Writes changelogs", "Explains code clearly"],
  "jobs-careers": ["Matches jobs to your profile", "Improves resumes", "Preps interview answers"],
  "recruiting": ["Screens candidates", "Writes job descriptions", "Builds shortlists"],
  "data-extraction": ["Extracts data from PDFs & pages", "Parses invoices & receipts", "Returns structured output"],
  "spreadsheets-data": ["Cleans messy data", "Analyzes CSV & Excel files", "Builds charts & pivots"],
  "ecommerce": ["Writes product listings", "Organizes catalogs", "Optimizes store content"],
  "price-monitoring": ["Tracks competitor prices", "Sends change alerts", "Finds deals"],
  "finance": ["Summarizes financial reports", "Categorizes expenses", "Helps reconcile accounts"],
  "legal-compliance": ["Reviews contracts", "Flags risky clauses", "Checks policy compliance"],
  "customer-support": ["Triages support tickets", "Drafts helpful replies", "Answers from your knowledge base"],
  "crm-sales-ops": ["Syncs and cleans CRM data", "Tracks deals & pipeline", "Assists forecasting"],
  "meetings-transcripts": ["Transcribes audio", "Writes meeting notes", "Extracts action items"],
  "design-creative": ["Generates creative concepts", "Drafts brand ideas", "Writes video scripts"],
  "education": ["Explains topics step by step", "Creates quizzes & flashcards", "Plans lessons"],
  "travel-real-estate": ["Plans trip itineraries", "Compares listings", "Finds options by budget"],
  "personal-productivity": ["Automates repetitive workflows", "Triages email & tasks", "Helps schedule your day"],

  "instant-response": ["Responds in seconds"],
  "long-running": ["Handles long background jobs"],
  "deep-agent": ["Plans and runs multi-step tasks"],
  "heavy-tool-use": ["Calls many tools & APIs"],
  "live-web-data": ["Uses live, up-to-date web data"],
  "browser-automation": ["Automates real browser actions"],
  "file-upload": ["Accepts file inputs"],
  "human-in-the-loop": ["Asks clarifying follow-ups"],
  "bulk-processing": ["Processes items in bulk"],
  "structured-output": ["Returns clean structured JSON"],
  "cited-sources": ["Cites sources for every claim"],
  "verified-results": ["Verifies results before returning"],
  "multi-language": ["Works across multiple languages"],
  "monitoring-alerts": ["Monitors and sends alerts"],
  "multi-agent": ["Coordinates multiple sub-agents"],
};

/** Suggestions for an agent's tags, de-duplicated, minus what is already added. */
export function suggestCapabilities(tagIds: string[], existing: string[] = []): string[] {
  const have = new Set(existing.map((s) => s.toLowerCase()));
  const out: string[] = [];
  for (const id of tagIds) {
    for (const s of TAG_CAPABILITY_SUGGESTIONS[id] ?? []) {
      const key = s.toLowerCase();
      if (have.has(key)) continue;
      have.add(key);
      out.push(s);
    }
  }
  return out;
}

/** Trims, drops blanks and duplicates, and enforces length/count limits. */
export function cleanCapabilities(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.trim().slice(0, MAX_CAPABILITY_CHARS);
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, MAX_CAPABILITIES);
}
