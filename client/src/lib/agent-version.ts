/** Splits "v2.1.0-beta.1" into numeric parts; non-numeric parts count as 0. */
function parts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
}

/** Negative when a < b, positive when a > b, 0 when they order the same. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Only an exact match (ignoring a leading "v") counts as unchanged: "1.0" and "1.0.0" are different versions. */
export const sameVersion = (a: string, b: string) =>
  a.trim().replace(/^v/i, "") === b.trim().replace(/^v/i, "");

export const SAME_VERSION_MESSAGE =
  "You need to change the version in your agent code, then re-register.";
