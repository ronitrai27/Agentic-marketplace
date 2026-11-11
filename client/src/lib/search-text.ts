/** Text helpers shared by the browser (instant search) and the server (meaning search). No server imports here. */

export const STOP = new Set(
  "a an the i me my we our you your need want find for to of and or who can that this best good great top agent agents please tell about it is in on with give show looking look some any one get help make do does".split(" "),
);

export const normalize = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The words of a query that carry meaning ("best report agents" -> ["report"]). */
export function tokensOf(q: string): string[] {
  return [...new Set(normalize(q).split(" ").filter((t) => t.length >= 2 && !STOP.has(t)))];
}

/** Edit distance, stopping early once it passes `max` (words are short, so this is cheap). */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
