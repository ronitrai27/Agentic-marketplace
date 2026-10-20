import { pool } from "./pool.js";

/**
 * Idempotent, additive migrations applied on every boot.
 *
 * The SQL files under /database only run when the Docker volume is first
 * created, so any column added later has to be applied to the live DB too.
 * Everything here is safe to run repeatedly (IF NOT EXISTS).
 */
export async function runMigrations(): Promise<void> {
  const statements = [
    `ALTER TABLE reviews     ADD COLUMN IF NOT EXISTS context TEXT`,
    `ALTER TABLE review_files ADD COLUMN IF NOT EXISTS content TEXT`,
    `ALTER TABLE reviews     ADD COLUMN IF NOT EXISTS repo_url TEXT`,
    // Widen mode CHECK to allow 'repo' (constraints can't be widened in place).
    `ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_mode_check`,
    `ALTER TABLE reviews ADD CONSTRAINT reviews_mode_check
       CHECK (mode IN ('paste', 'upload', 'repo'))`,
  ];

  for (const sql of statements) {
    try {
      await pool.query(sql);
    } catch (err: any) {
      // A failure here (e.g. DB offline) must not crash the server — the API
      // degrades gracefully and reports the DB as offline.
      console.warn(`[db] migration skipped: ${err?.message ?? err}`);
    }
  }
}
