import pg from "pg";
import { ENV } from "../config/env.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: ENV.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[db] unexpected pool error:", err.message);
});

export async function checkDatabase(): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    return { ok: true, message: `PostgreSQL connected at ${result.rows[0].now}` };
  } catch (err: any) {
    return { ok: false, message: err?.message || err?.code || "Unknown database error (is Postgres running?)" };
  }
}
