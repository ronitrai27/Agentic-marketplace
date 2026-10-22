export interface PageLinkEntry {
  url: string;
  internalLinks: string[];
}

export interface LinkGraphResult {
  totalPages: number;
  orphanPages: string[];
  deepPages: { url: string; depth: number }[];
  pageRankScores: Record<string, number>;
}

/**
 * Pillar 5: Internal Link Graph & PageRank Engine
 * Minimal, zero-dependency, high-speed in-memory graph processor.
 */
export async function linkGraphActivity(input: {
  rootUrl: string;
  pages: PageLinkEntry[];
}): Promise<LinkGraphResult> {
  const { rootUrl, pages } = input;
  const allUrls = Array.from(new Set([rootUrl, ...pages.map((p) => p.url)]));
  const N = allUrls.length;

  if (N === 0) {
    return { totalPages: 0, orphanPages: [], deepPages: [], pageRankScores: {} };
  }

  // 1. Build adjacency maps
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  for (const url of allUrls) {
    outgoing.set(url, new Set());
    incoming.set(url, new Set());
  }

  for (const entry of pages) {
    for (const target of entry.internalLinks) {
      if (outgoing.has(target)) {
        outgoing.get(entry.url)?.add(target);
        incoming.get(target)?.add(entry.url);
      }
    }
  }

  // 2. Identify Orphan Pages (0 inbound links, excluding homepage root)
  const orphanPages: string[] = [];
  for (const [url, inLinks] of incoming.entries()) {
    if (inLinks.size === 0 && url !== rootUrl) {
      orphanPages.push(url);
    }
  }

  // 3. Compute Crawl Depth via BFS from rootUrl
  const depthMap = new Map<string, number>();
  depthMap.set(rootUrl, 0);

  const queue: string[] = [rootUrl];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depthMap.get(current)!;

    const neighbors = outgoing.get(current) || new Set();
    for (const next of neighbors) {
      if (!depthMap.has(next)) {
        depthMap.set(next, currentDepth + 1);
        queue.push(next);
      }
    }
  }

  const deepPages: { url: string; depth: number }[] = [];
  for (const [url, depth] of depthMap.entries()) {
    if (depth > 3) {
      deepPages.push({ url, depth });
    }
  }

  // 4. In-Memory PageRank Algorithm (Power Iteration, 20 rounds, damping = 0.85)
  const d = 0.85;
  let ranks: Record<string, number> = {};
  for (const url of allUrls) {
    ranks[url] = 1 / N;
  }

  for (let iter = 0; iter < 20; iter++) {
    const nextRanks: Record<string, number> = {};
    for (const url of allUrls) {
      nextRanks[url] = (1 - d) / N;
    }

    for (const url of allUrls) {
      const outList = outgoing.get(url)!;
      const share = outList.size > 0 ? (d * ranks[url]!) / outList.size : 0;
      for (const target of outList) {
        nextRanks[target] = (nextRanks[target] || 0) + share;
      }
    }

    ranks = nextRanks;
  }

  // Format scores rounded to 4 decimals
  const formattedRanks: Record<string, number> = {};
  for (const [url, score] of Object.entries(ranks)) {
    formattedRanks[url] = parseFloat(score.toFixed(4));
  }

  return {
    totalPages: N,
    orphanPages,
    deepPages,
    pageRankScores: formattedRanks,
  };
}
