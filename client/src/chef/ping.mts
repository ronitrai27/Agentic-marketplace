// Latency check: Postgres round trips and one Jev guard call. Run: pnpm chef:ping
import pg from "pg";
import { askJev } from "./guard/jev";
import { GUARD_QUESTIONS } from "./guard/questions";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const time = async <T,>(label: string, f: () => Promise<T>) => {
  const t = performance.now();
  await f();
  console.log(label.padEnd(28), Math.round(performance.now() - t), "ms");
};
await time("postgres connect + SELECT 1", () => pool.query("select 1"));
for (let i = 1; i <= 4; i++) await time(`postgres SELECT 1 (warm #${i})`, () => pool.query("select 1"));
for (let i = 1; i <= 3; i++)
  await time(`jev guard call #${i}`, () => askJev({ message: "hello", phase: "understand", last_assistant_message: "" }, GUARD_QUESTIONS));
await pool.end();
