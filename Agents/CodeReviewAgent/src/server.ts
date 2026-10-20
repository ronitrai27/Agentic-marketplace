import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { ENV } from "./config/env.js";
import { checkDatabase } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { reviewRouter } from "./routes/review.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// API
app.use("/api", reviewRouter);

app.get("/api/health", async (_req, res) => {
  const db = await checkDatabase();
  res.json({ ok: db.ok, database: db.message, model: ENV.OPENAI_MODEL, maxFiles: ENV.MAX_FILES });
});

// Multer / body-parser errors -> JSON instead of HTML stack traces
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    const hint =
      err.code === "LIMIT_FILE_SIZE"
        ? `Each file must be under ${Math.round(ENV.MAX_FILE_BYTES / 1024)} KB.`
        : err.code === "LIMIT_FILE_COUNT"
          ? `You can upload at most ${ENV.MAX_FILES} files.`
          : err.message;
    res.status(400).json({ error: `Upload error: ${hint}` });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: "Request body too large." });
    return;
  }
  console.error("[server] unhandled error:", err);
  res.status(500).json({ error: err?.message ?? "Internal server error" });
});

// Static frontend
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

app.get("*", (_req, res) => {
  const indexFile = path.join(PUBLIC_DIR, "index.html");
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).send("Not Found");
  }
});

app.listen(ENV.PORT, async () => {
  await runMigrations();
  const db = await checkDatabase();
  console.log(`\n======================================================`);
  console.log(` Code Review Agent running at: http://localhost:${ENV.PORT}`);
  console.log(` Model: ${ENV.OPENAI_MODEL}`);
  console.log(` Database: ${db.ok ? "OK" : "OFFLINE — " + db.message}`);
  console.log(`======================================================\n`);
});
