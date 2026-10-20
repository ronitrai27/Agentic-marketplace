import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { ENV } from "../config/env.js";
import type { SourceFile } from "../agent/types.js";

const execFileAsync = promisify(execFile);

/**
 * Public git hosts a scan URL is allowed to point at. This allowlist is the
 * SSRF guard: it stops `git clone` being aimed at localhost, link-local or
 * internal metadata addresses (e.g. 169.254.169.254) via a crafted URL.
 */
const ALLOWED_HOSTS = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "codeberg.org",
  "gitea.com",
  "git.sr.ht",
]);

/** Directories never worth reviewing — dependencies, build output, VCS, caches. */
const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", "coverage",
  "vendor", "third_party", "third-party", ".next", ".nuxt", ".svelte-kit",
  ".venv", "venv", "env", "__pycache__", ".pytest_cache", "target", "bin", "obj",
  ".idea", ".vscode", ".turbo", ".cache", "bower_components",
]);

/** Lockfiles are huge, generated and low-signal. */
const IGNORE_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "npm-shrinkwrap.json",
  "composer.lock", "poetry.lock", "Pipfile.lock", "Cargo.lock", "go.sum",
  "Gemfile.lock", "bun.lockb",
]);

/** Extensions considered reviewable source/config. */
const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".svelte",
  ".py", ".go", ".java", ".kt", ".kts", ".rb", ".php", ".cs",
  ".c", ".h", ".cpp", ".cc", ".hpp", ".rs", ".swift", ".scala",
  ".ex", ".exs", ".clj", ".dart", ".r", ".jl", ".lua", ".sh",
  ".sql", ".html", ".css", ".scss", ".json", ".yml", ".yaml",
  ".toml", ".xml", ".md", ".gradle", ".tf", ".proto",
]);

/** Prefer real source over tests/examples/config when we must trim. */
const SOURCE_BONUS = /(^|\/)(src|lib|app|server|backend|api|core)\//i;
const LOW_VALUE = /(^|\/)(test|tests|__tests__|spec|specs|examples?|fixtures|mocks?|docs?|vendor|third[-_]?party)\//i;

/**
 * How many top-ranked candidates to fetch blobs for. Only ~MAX_FILES files are
 * ultimately reviewed; this is a small headroom above that so a too-large or
 * empty file does not drop us below a useful count. Keep it close to MAX_FILES
 * — every extra candidate is another network round-trip on a partial clone.
 */
const FETCH_CANDIDATES = ENV.MAX_FILES + 2;
/** Leave headroom under MAX_CODE_CHARS for the per-file headers in the prompt. */
const CONTENT_BUDGET = Math.max(4_000, Math.floor(ENV.MAX_CODE_CHARS * 0.9));

export interface RepoScan {
  files: SourceFile[];
  repoName: string;
  dir: string;
}

/** Normalise a pasted URL and reject anything that is not a public https git host. */
export function normaliseRepoUrl(raw: string): string {
  let value = raw.trim();
  if (!value) throw new Error("Repository URL is required.");
  if (value.startsWith("git@")) {
    throw new Error("Use an https:// repository URL, not an SSH one.");
  }
  // Allow "github.com/owner/repo" without a scheme.
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  // Upgrade plain http to https for allowlisted hosts.
  value = value.replace(/^http:\/\//i, "https://");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("That does not look like a valid repository URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only https:// repository URLs are supported.");
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      `Unsupported host "${parsed.hostname}". Allowed: ${[...ALLOWED_HOSTS].join(", ")}.`,
    );
  }
  // Drop query/hash; keep the path (owner/repo).
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

/** "https://github.com/owner/repo" -> "owner/repo" */
function repoNameFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1].replace(/\.git$/i, "")}`;
    return pathname.replace(/^\/+|\/+$/g, "") || url;
  } catch {
    return url;
  }
}

function friendlyCloneError(stderr: string, message: string): Error {
  const s = `${stderr ?? ""} ${message ?? ""}`.toLowerCase();
  if (s.includes("maxbuffer") || s.includes("out of memory")) {
    return new Error("That repository is too large to scan in one go. Try a smaller repo, or paste the specific files instead.");
  }
  if (s.includes("repository not found") || s.includes("not found")) {
    return new Error("Repository not found, or it is private. Only public repos can be scanned.");
  }
  if (s.includes("could not resolve host") || s.includes("unable to access")) {
    return new Error("Could not reach that git host. Check the URL and your connection.");
  }
  if (s.includes("killed") || s.includes("timed out")) {
    return new Error("Clone timed out — that repository is probably too large.");
  }
  return new Error(`Could not clone repository: ${stderr?.trim() || message}`);
}

/** How much of git's stderr tail to keep for error reporting. */
const STDERR_TAIL_BYTES = 16 * 1024;

/**
 * PARTIAL-clone `url` into `dir` — fetch only commit/tree objects, not blobs,
 * and skip the checkout entirely.
 *
 * A full clone of a large repo (tens of thousands of files) is slow and emits
 * unbounded per-file checkout progress to stderr that no `maxBuffer` can
 * reliably absorb (execFile would kill the clone mid-way). With
 * `--filter=blob:none --no-checkout` the download is tiny and fast even for
 * huge repos (vscode: ~9s instead of >300s), the working tree stays empty, and
 * there is no checkout progress to flood stderr. We then read the file LIST
 * from the tree objects and fetch only the few blobs we actually review.
 *
 * stderr still goes to a temp FILE (not memory) as a belt-and-suspenders guard
 * against any verbose output; we read only its tail when reporting errors.
 */
function partialClone(url: string, dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const logPath = path.join(
      os.tmpdir(),
      `git-clone-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
    );
    const out = fsSync.createWriteStream(logPath);

    const child = spawn(
      "git",
      [
        "clone",
        "--depth", "1",
        "--filter=blob:none",  // fetch trees only; blobs pulled on demand later
        "--no-checkout",       // leave the working tree empty — we read via ls-tree
        "--single-branch",
        "--no-tags",
        "--no-progress",
        "--",                  // everything after is a path/URL, never an option
        url,
        dir,
      ],
      {
        // Discard stdout (clone prints little there); pipe stderr to our file.
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
      },
    );

    child.stderr?.pipe(out);

    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      out.end();
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      killTree(child.pid);
      finish(new Error("timed out"));
    }, ENV.REPO_CLONE_TIMEOUT_MS);

    child.on("error", (err) => finish(err));
    child.on("close", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      // Give the write stream a beat to flush, then read the tail for a message.
      out.end(async () => {
        const tail = await readTail(logPath);
        await fs.rm(logPath, { force: true }).catch(() => undefined);
        const msg = signal === "SIGKILL" ? "timed out" : `exit code ${code}`;
        finish(friendlyCloneError(tail, msg));
      });
    });
  });
}

/**
 * Kill a spawned git process AND its children.
 *
 * `child.kill()` only signals the immediate parent. git spawns helpers
 * (git-remote-https, index-pack) that would otherwise survive, keep their
 * handles on the temp clone dir, and block `rm -rf` — leaving stale
 * code-review-* dirs behind. On Windows `taskkill /T` kills the tree.
 */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    }).on("error", () => undefined);
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { /* process gone */ }
    try { process.kill(pid, "SIGKILL"); } catch { /* process gone */ }
  }
}

/** Read up to the last STDERR_TAIL_BYTES of a file (best-effort). */
async function readTail(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    const start = Math.max(0, stat.size - STDERR_TAIL_BYTES);
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(stat.size - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

interface TreeEntry {
  sha: string;
  rel: string;
  depth: number;
  score: number;
}

/**
 * List every tracked file in the (partial) clone from its tree objects — no
 * blobs are downloaded for this, so it is fast even on huge repos. Uses
 * `ls-tree -r -z` with core.quotePath=false so paths with spaces/UTF-8 come
 * through unquoted and parse cleanly.
 */
async function listTree(dir: string): Promise<TreeEntry[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["-c", "core.quotePath=false", "ls-tree", "-r", "-z", "HEAD"],
    { cwd: dir, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
  );

  const out: TreeEntry[] = [];
  for (const rec of stdout.split("\0")) {
    if (!rec) continue; // trailing separator
    // Format: "<mode> blob <sha>\t<path>"
    const tab = rec.indexOf("\t");
    if (tab === -1) continue;
    const meta = rec.slice(0, tab).split(" ");
    const rel = rec.slice(tab + 1);
    if (meta[1] !== "blob" || !rel) continue;

    const segments = rel.split("/");
    const filename = segments[segments.length - 1];
    if (IGNORE_FILES.has(filename)) continue;
    // Any parent directory on the ignore list => skip the whole path.
    if (segments.slice(0, -1).some((s) => IGNORE_DIRS.has(s))) continue;

    const ext = path.extname(filename).toLowerCase();
    if (!CODE_EXTENSIONS.has(ext)) continue;

    const depth = segments.length;
    let score = depth <= 2 ? 3 : depth <= 4 ? 1 : -depth;
    if (SOURCE_BONUS.test(rel)) score += 3;
    if (LOW_VALUE.test(rel)) score -= 4;

    out.push({ sha: meta[2], rel, depth, score });
  }
  return out;
}

/**
 * Fetch many blobs in ONE `git cat-file --batch` call.
 *
 * With a partial clone, cat-file pulls every missing blob in a single promisor
 * fetch — so 10 files cost one network round-trip, not ten. Returns a map of
 * repo-relative path -> content for the blobs that were fetched successfully.
 */
async function fetchBlobsBatch(
  dir: string,
  wanted: { sha: string; rel: string }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (wanted.length === 0) return result;

  const bySha = new Map(wanted.map((w) => [w.sha, w.rel]));

  return new Promise((resolve) => {
    const child = spawn("git", ["cat-file", "--batch"], {
      cwd: dir,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });

    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));

    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("error", () => { clearTimeout(timer); resolve(result); });
    child.on("close", () => {
      clearTimeout(timer);
      parseCatFileBatch(Buffer.concat(chunks), bySha, result);
      resolve(result);
    });

    // One SHA per line, then close stdin to signal we're done.
    for (const w of wanted) child.stdin.write(`${w.sha}\n`);
    child.stdin.end();
  });
}

/**
 * Parse `git cat-file --batch` output: repeated
 * `<sha> <type> <size>\n<content bytes>\n`. Content length is BYTE-exact, so
 * we slice by byte offsets rather than splitting a decoded string (multi-byte
 * UTF-8 would otherwise desync the stream).
 */
function parseCatFileBatch(
  buf: Buffer,
  bySha: Map<string, string>,
  out: Map<string, string>,
): void {
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) break; // no header line
    const header = buf.toString("utf8", pos, nl).trim();
    pos = nl + 1;

    const parts = header.split(" ");
    if (parts.length < 3) continue; // "missing" or malformed
    const [sha, type, sizeStr] = parts;
    const size = Number.parseInt(sizeStr, 10);
    if (type !== "blob" || !Number.isFinite(size) || size < 0) continue;

    const content = buf.subarray(pos, pos + size);
    pos += size + 1; // content + trailing newline

    const rel = bySha.get(sha);
    if (rel !== undefined) out.set(rel, content.toString("utf8"));
  }
}

/**
 * Partial-clone a public repo, pick the most relevant source files, and fetch
 * just those blobs — bounded by MAX_FILES / MAX_FILE_BYTES / content budget.
 * The caller MUST run `cleanupScan(dir)` when done (success or failure).
 */
export async function scanPublicRepo(rawUrl: string): Promise<RepoScan> {
  const url = normaliseRepoUrl(rawUrl);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-review-"));

  try {
    await partialClone(url, dir);

    const entries = await listTree(dir);
    if (entries.length === 0) {
      throw new Error("No reviewable source files found in that repository.");
    }

    // Best-first: highest score, then shallowest. Cap the candidate set so a
    // 20k-file repo still costs ~FETCH_CANDIDATES blob reads.
    entries.sort((a, b) => b.score - a.score || a.depth - b.depth);
    const candidates = entries.slice(0, FETCH_CANDIDATES);

    // Fetch all wanted blobs in ONE round-trip.
    const contentByPath = await fetchBlobsBatch(dir, candidates);

    const files: SourceFile[] = [];
    let spent = 0;
    for (const entry of candidates) {
      if (files.length >= ENV.MAX_FILES) break;

      const content = contentByPath.get(entry.rel);
      if (content === undefined) continue;

      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes === 0 || bytes > ENV.MAX_FILE_BYTES) continue;
      if (spent + bytes > CONTENT_BUDGET) continue;

      files.push({ name: entry.rel, content });
      spent += bytes;
    }

    if (files.length === 0) {
      throw new Error("No reviewable source files found in that repository.");
    }
    // Present in repo order so the review reads top-to-bottom.
    files.sort((a, b) => a.name.localeCompare(b.name));

    return { files, repoName: repoNameFromUrl(url), dir };
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Remove the temp clone dir, retrying briefly.
 *
 * A child git process may hold the dir for a moment after we kill the tree; a
 * single rm can fail on Windows with EPERM/EBUSY. Retry a few times so we do
 * not leak code-review-* dirs into TEMP.
 */
export async function cleanupScan(dir: string): Promise<void> {
  if (!dir) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (err: any) {
      const retriable = err?.code === "EPERM" || err?.code === "EBUSY" || err?.code === "ENOTEMPTY";
      if (!retriable || attempt === 2) return;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}
