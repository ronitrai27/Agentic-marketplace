import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { ENV } from "../config/env.js";
import { runCodeReview } from "../agent/reviewer.js";
import type { ReviewJob, SourceFile } from "../agent/types.js";
import { getReviewById, listReviews, saveReview } from "../db/repository.js";
import { scanPublicRepo, cleanupScan, normaliseRepoUrl } from "../services/repo.js";

export const reviewRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ENV.MAX_FILE_BYTES, files: ENV.MAX_FILES },
});

const pasteSchema = z.object({
  code: z.string().min(1, "Code is required").max(ENV.MAX_CODE_CHARS, "Code is too large"),
  language: z.string().max(50).optional().nullable(),
  context: z.string().max(2000).optional().nullable(),
  filename: z.string().max(200).optional().nullable(),
});

const repoSchema = z.object({
  url: z.string().min(1, "Repository URL is required").max(500, "URL is too long"),
  context: z.string().max(2000).optional().nullable(),
});

// POST /api/review/paste — review a single pasted snippet
reviewRouter.post("/review/paste", async (req, res) => {
  const parsed = pasteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  const { code, language, context, filename } = parsed.data;
  const file: SourceFile = { name: filename?.trim() || `pasted.${language?.trim() || "txt"}`, content: code };

  const job: ReviewJob = {
    mode: "paste",
    language: language?.trim() || null,
    context: context?.trim() || null,
    files: [file],
  };

  try {
    const result = await runCodeReview(job);
    const savedId = await saveReview(job, result);
    res.json({ id: savedId, mode: job.mode, result });
  } catch (err: any) {
    console.error("[review/paste] error:", err);
    res.status(500).json({ error: err?.message ?? "Code review failed" });
  }
});

// POST /api/review/files — review 1..MAX_FILES uploaded source files
reviewRouter.post("/review/files", upload.array("files", ENV.MAX_FILES), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: "Upload at least one file (max 10)." });
    return;
  }
  if (files.length > ENV.MAX_FILES) {
    res.status(400).json({ error: `You can upload at most ${ENV.MAX_FILES} files.` });
    return;
  }

  const body = req.body as { context?: string };
  const sourceFiles: SourceFile[] = files.map((f) => ({
    name: f.originalname,
    content: f.buffer.toString("utf8"),
  }));

  const job: ReviewJob = {
    mode: "upload",
    language: null,
    context: body.context?.trim() || null,
    files: sourceFiles,
  };

  try {
    const result = await runCodeReview(job);
    const savedId = await saveReview(job, result);
    res.json({ id: savedId, mode: job.mode, result });
  } catch (err: any) {
    console.error("[review/files] error:", err);
    res.status(500).json({ error: err?.message ?? "Code review failed" });
  }
});

// POST /api/review/repo — shallow-clone a public repo, select files, review
reviewRouter.post("/review/repo", async (req, res) => {
  const parsed = repoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  const { url, context } = parsed.data;

  // Fail fast on a bad host before we spend time cloning.
  let canonicalUrl: string;
  try {
    canonicalUrl = normaliseRepoUrl(url);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Invalid repository URL" });
    return;
  }

  let dir = "";
  try {
    const scan = await scanPublicRepo(url);
    dir = scan.dir;

    const job: ReviewJob = {
      mode: "repo",
      language: null,
      context: context?.trim() || null,
      repoUrl: canonicalUrl,
      files: scan.files,
    };

    const result = await runCodeReview(job);
    const savedId = await saveReview(job, result);
    res.json({ id: savedId, mode: job.mode, repo: scan.repoName, fileCount: scan.files.length, result });
  } catch (err: any) {
    console.error("[review/repo] error:", err);
    res.status(500).json({ error: err?.message ?? "Repository review failed" });
  } finally {
    if (dir) void cleanupScan(dir);
  }
});

// GET /api/reviews — recent review history
reviewRouter.get("/reviews", async (_req, res) => {
  try {
    const reviews = await listReviews(25);
    res.json({ reviews });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Could not load review history (is the database running?)" });
  }
});

// GET /api/reviews/:id — one persisted review with its issues and files
reviewRouter.get("/reviews/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid review id" });
    return;
  }
  try {
    const saved = await getReviewById(id);
    if (!saved) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    res.json(saved);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Could not load review" });
  }
});
