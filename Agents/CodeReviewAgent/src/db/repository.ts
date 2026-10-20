import { pool } from "./pool.js";
import type { ReviewJob, ReviewResult, Severity } from "../agent/types.js";

export interface ReviewRow {
  id: number;
  mode: "paste" | "upload" | "repo";
  language: string | null;
  context: string | null;
  repo_url: string | null;
  file_count: number;
  overall_score: number;
  verdict: string;
  summary: string;
  created_at: string;
}

export interface ReviewIssueRow {
  id: number;
  review_id: number;
  severity: Severity;
  category: string;
  file: string | null;
  line: number | null;
  title: string;
  description: string;
  suggestion: string | null;
  code_snippet: string | null;
}

export interface ReviewFileRow {
  id: number;
  review_id: number;
  filename: string;
  language: string | null;
  size_bytes: number;
  content: string | null;
}

export interface SavedReview {
  review: ReviewRow;
  issues: ReviewIssueRow[];
  files: ReviewFileRow[];
}

/**
 * Persist a completed review (header + files + issues) inside one transaction.
 * Returns null when the database is unavailable so the API still answers the user.
 */
export async function saveReview(
  job: ReviewJob,
  result: ReviewResult,
): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const reviewRes = await client.query<ReviewRow>(
      `INSERT INTO reviews (mode, language, context, repo_url, file_count, overall_score, verdict, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [job.mode, job.language, job.context, job.repoUrl ?? null, job.files.length, result.score, result.verdict, result.summary],
    );
    const review = reviewRes.rows[0];

    for (const file of job.files) {
      await client.query(
        `INSERT INTO review_files (review_id, filename, language, size_bytes, content)
         VALUES ($1, $2, $3, $4, $5)`,
        [review.id, file.name, job.language, Buffer.byteLength(file.content, "utf8"), file.content],
      );
    }

    for (const issue of result.issues) {
      await client.query(
        `INSERT INTO review_issues (review_id, severity, category, file, line, title, description, suggestion, code_snippet)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          review.id,
          issue.severity,
          issue.category,
          issue.file,
          issue.line,
          issue.title,
          issue.description,
          issue.suggestion,
          issue.snippet,
        ],
      );
    }

    await client.query("COMMIT");
    return review.id;
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[db] saveReview failed:", err?.message);
    return null;
  } finally {
    client.release();
  }
}

export async function listReviews(limit = 25): Promise<ReviewRow[]> {
  const result = await pool.query<ReviewRow>(
    `SELECT * FROM reviews ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function getReviewById(id: number): Promise<SavedReview | null> {
  const reviewRes = await pool.query<ReviewRow>(`SELECT * FROM reviews WHERE id = $1`, [id]);
  const review = reviewRes.rows[0];
  if (!review) return null;

  const [issuesRes, filesRes] = await Promise.all([
    pool.query<ReviewIssueRow>(
      `SELECT * FROM review_issues WHERE review_id = $1
       ORDER BY CASE severity
         WHEN 'critical' THEN 0
         WHEN 'high' THEN 1
         WHEN 'medium' THEN 2
         WHEN 'low' THEN 3
         ELSE 4 END, id ASC`,
      [id],
    ),
    pool.query<ReviewFileRow>(`SELECT * FROM review_files WHERE review_id = $1 ORDER BY id ASC`, [id]),
  ]);

  return { review, issues: issuesRes.rows, files: filesRes.rows };
}
