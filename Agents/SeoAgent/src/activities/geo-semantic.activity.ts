import { env } from "../config/env.js";

export interface GeoCitationResult {
  keyword: string;
  isDomainCited: boolean;
  aiEngine: string;
}

export interface CannibalizationIssue {
  urlA: string;
  urlB: string;
  similarityScore: number;
  reason: string;
}

export interface GeoSemanticResult {
  geoCitation?: GeoCitationResult;
  cannibalizationIssues: CannibalizationIssue[];
}

/**
 * Calculates Jaccard token similarity between two text strings (0.0 to 1.0).
 */
function calculateJaccardSimilarity(textA: string, textB: string): number {
  const setA = new Set(textA.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter((w) => w.length > 3));
  const setB = new Set(textB.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter((w) => w.length > 3));

  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : parseFloat((intersection / union).toFixed(3));
}

/**
 * Pillar 4: GEO & Semantic Cannibalization Activity
 * Minimal, clean, and direct.
 */
export async function geoSemanticActivity(input: {
  targetDomain: string;
  samplePages: { url: string; title: string; description?: string }[];
  testQuery?: string;
}): Promise<GeoSemanticResult> {
  const result: GeoSemanticResult = { cannibalizationIssues: [] };

  // 1. Topical Cannibalization (Pairwise keyword/intent similarity check)
  const pages = input.samplePages;
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const pageA = pages[i]!;
      const pageB = pages[j]!;

      const fullTextA = `${pageA.title} ${pageA.description || ""}`;
      const fullTextB = `${pageB.title} ${pageB.description || ""}`;

      const similarity = calculateJaccardSimilarity(fullTextA, fullTextB);
      if (similarity >= 0.65) {
        result.cannibalizationIssues.push({
          urlA: pageA.url,
          urlB: pageB.url,
          similarityScore: similarity,
          reason: `High semantic overlap (${Math.round(similarity * 100)}%) between "${pageA.title}" and "${pageB.title}".`,
        });
      }
    }
  }

  // 2. AI Search (GEO) Citation Check (via OpenRouter)
  if (env.OPENROUTER_JEV && input.testQuery) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Authorization": `Bearer ${env.OPENROUTER_JEV}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: `List top authoritative sources and websites for this topic: "${input.testQuery}". Return a concise list of sources.`,
            },
          ],
          temperature: 0.2,
          max_tokens: 150,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const answer = data.choices?.[0]?.message?.content || "";
        const cleanDomain = input.targetDomain.toLowerCase().replace(/^www\./, "");
        const isDomainCited = answer.toLowerCase().includes(cleanDomain);

        result.geoCitation = {
          keyword: input.testQuery,
          isDomainCited,
          aiEngine: "OpenRouter / GPT-4o-mini",
        };
      }
    } catch {
      // Non-fatal
    }
  }

  console.log(
    `🌐 [Temporal Activity: GEO Citations] ✅ Domain Cited in AI Engines: ${result.geoCitation?.isDomainCited ?? false} | Cannibalization Alerts: ${result.cannibalizationIssues.length}`
  );

  return result;
}
