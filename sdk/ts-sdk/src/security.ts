import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { ErrorCode } from "./types.js";

// ─────────────────────────────────────────────────
//  Security Options
// ─────────────────────────────────────────────────

export interface SecurityOptions {
  /** Secret key for HMAC verification (Gateway mode). Auto-reads CATELOG_SECRET_KEY. */
  secret?: string;
  /** Publishable key for public endpoint auth. Auto-reads CATELOG_PUBLIC_KEY. */
  publicKey?: string;
  /** Max clock drift for timestamp verification (default: 5min) */
  maxTimestampDriftMs?: number;
  /** TTL for nonce replay cache (default: 5min) */
  nonceTtlMs?: number;
}

// ─────────────────────────────────────────────────
//  Auth Mode Detection
// ─────────────────────────────────────────────────

export type AuthMode =
  | "hmac"          // Full HMAC-SHA256 (Gateway → Agent)
  | "bearer"        // Simple Bearer secret key (curl, Postman, internal)
  | "public"        // Publishable key (read-only endpoints)
  | "dev"           // No auth, permissive development mode
  | "none";         // No auth configured and not dev

// ─────────────────────────────────────────────────
//  Errors
// ─────────────────────────────────────────────────

export class SecurityVerificationError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number = 401
  ) {
    super(message);
    this.name = "SecurityVerificationError";
  }
}

// ─────────────────────────────────────────────────
//  SecurityManager
// ─────────────────────────────────────────────────

export class SecurityManager {
  private secret?: string;
  private publicKey?: string;
  private maxTimestampDriftMs: number;
  private nonceTtlMs: number;
  private seenNonces = new Map<string, number>();
  private activeRunIds = new Set<string>();
  private completedRunIds = new Map<string, number>();

  constructor(options: SecurityOptions = {}) {
    // Auto-discover keys from environment if not provided
    this.secret = options.secret || process.env.CATELOG_SECRET_KEY;
    this.publicKey = options.publicKey || process.env.CATELOG_PUBLIC_KEY;
    this.maxTimestampDriftMs = options.maxTimestampDriftMs ?? 300_000; // 5 minutes
    this.nonceTtlMs = options.nonceTtlMs ?? 300_000;
  }

  public getSecret(): string | undefined {
    return this.secret;
  }

  public getPublicKey(): string | undefined {
    return this.publicKey;
  }

  public setSecret(secret: string): void {
    this.secret = secret;
  }

  public setPublicKey(publicKey: string): void {
    this.publicKey = publicKey;
  }

  public isDevMode(): boolean {
    return !this.secret && process.env.NODE_ENV !== "production";
  }

  // ─────────────────────────────────────────────
  //  Dual-Mode Auth: Detects Bearer vs HMAC vs Dev
  // ─────────────────────────────────────────────

  /**
   * Authenticates an incoming request using the best available method:
   *
   * 1. HMAC headers present → full HMAC-SHA256 verification (Gateway traffic)
   * 2. Authorization: Bearer cat_sec_... → simple secret key match (curl/Postman)
   * 3. Authorization: Bearer cat_pub_... → public key match (read-only allowed)
   * 4. No auth + dev mode → permissive pass-through with warning
   * 5. No auth + production → rejected
   */
  public authenticateRequest(params: {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    rawBody: string | Buffer;
  }): { runId: string; nonce: string; timestamp: number; authMode: AuthMode } {
    this.cleanupOldEntries();

    const headers = params.headers;

    // ── Check for HMAC headers first (Gateway mode) ──
    const signatureHeader = headers["x-marketplace-signature"] as string | undefined;
    if (signatureHeader) {
      return this.verifyHmac(params, signatureHeader);
    }

    // ── Check for Bearer token (simple auth) ──
    const authHeader = (headers["authorization"] || headers["Authorization"]) as string | undefined;
    if (authHeader) {
      return this.verifyBearer(authHeader, headers);
    }

    // ── No auth provided ──
    if (this.isDevMode()) {
      const runId = (headers["x-marketplace-run-id"] as string) || `dev-${randomUUID().slice(0, 8)}`;
      const nonce = (headers["x-marketplace-nonce"] as string) || `dev-${randomUUID().slice(0, 8)}`;

      if (process.env.NODE_ENV !== "test") {
        console.warn(
          "\x1b[33m⚠ [catelog] Running in dev mode — no authentication required. " +
          "Set CATELOG_SECRET_KEY in production.\x1b[0m"
        );
      }

      return { runId, nonce, timestamp: Date.now(), authMode: "dev" };
    }

    // Production with no auth → reject
    throw new SecurityVerificationError(
      "AUTH_MISSING_KEY",
      "No authentication provided. Supply Authorization: Bearer <key> or HMAC signature headers.",
      401
    );
  }

  // ── Bearer Token Verification ──

  private verifyBearer(
    authHeader: string,
    headers: Record<string, string | string[] | undefined>
  ): { runId: string; nonce: string; timestamp: number; authMode: AuthMode } {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      throw new SecurityVerificationError(
        "AUTH_INVALID_KEY",
        "Empty Bearer token",
        401
      );
    }

    // Check secret key (cat_sec_live_...)
    if (token.startsWith("cat_sec_") && this.secret) {
      // Constant-time comparison
      const tokenBuf = Buffer.from(token, "utf8");
      const secretBuf = Buffer.from(this.secret, "utf8");

      if (tokenBuf.length !== secretBuf.length || !timingSafeEqual(tokenBuf, secretBuf)) {
        throw new SecurityVerificationError(
          "AUTH_INVALID_KEY",
          "Invalid secret key",
          401
        );
      }

      const runId = (headers["x-marketplace-run-id"] as string) || `run-${randomUUID().slice(0, 8)}`;
      const nonce = (headers["x-marketplace-nonce"] as string) || `nonce-${randomUUID().slice(0, 8)}`;
      return { runId, nonce, timestamp: Date.now(), authMode: "bearer" };
    }

    // Check public key (cat_pub_live_...)
    if (token.startsWith("cat_pub_") && this.publicKey) {
      const tokenBuf = Buffer.from(token, "utf8");
      const pubBuf = Buffer.from(this.publicKey, "utf8");

      if (tokenBuf.length !== pubBuf.length || !timingSafeEqual(tokenBuf, pubBuf)) {
        throw new SecurityVerificationError(
          "AUTH_INVALID_KEY",
          "Invalid public key",
          401
        );
      }

      const runId = (headers["x-marketplace-run-id"] as string) || `pub-${randomUUID().slice(0, 8)}`;
      const nonce = (headers["x-marketplace-nonce"] as string) || `pub-${randomUUID().slice(0, 8)}`;
      return { runId, nonce, timestamp: Date.now(), authMode: "public" };
    }

    // Dev mode fallback for any token
    if (this.isDevMode()) {
      const runId = (headers["x-marketplace-run-id"] as string) || `dev-${randomUUID().slice(0, 8)}`;
      const nonce = (headers["x-marketplace-nonce"] as string) || `dev-${randomUUID().slice(0, 8)}`;
      return { runId, nonce, timestamp: Date.now(), authMode: "dev" };
    }

    throw new SecurityVerificationError(
      "AUTH_INVALID_KEY",
      "Invalid API key format or key mismatch",
      401
    );
  }

  // ── HMAC-SHA256 Verification (Gateway traffic) ──

  private verifyHmac(
    params: {
      method: string;
      path: string;
      headers: Record<string, string | string[] | undefined>;
      rawBody: string | Buffer;
    },
    signatureHeader: string
  ): { runId: string; nonce: string; timestamp: number; authMode: AuthMode } {
    if (!this.secret) {
      // Dev mode: skip HMAC but warn
      if (this.isDevMode()) {
        const runId = (params.headers["x-marketplace-run-id"] as string) || `dev-${randomUUID().slice(0, 8)}`;
        const nonce = (params.headers["x-marketplace-nonce"] as string) || `dev-${randomUUID().slice(0, 8)}`;
        return { runId, nonce, timestamp: Date.now(), authMode: "dev" };
      }
      throw new SecurityVerificationError(
        "AUTH_MISSING_KEY",
        "HMAC signature provided but no secret key configured",
        401
      );
    }

    const headers = params.headers;
    const timestampHeader = headers["x-marketplace-timestamp"] as string | undefined;
    const nonceHeader = headers["x-marketplace-nonce"] as string | undefined;
    const runIdHeader = headers["x-marketplace-run-id"] as string | undefined;

    if (!timestampHeader || !nonceHeader || !runIdHeader) {
      throw new SecurityVerificationError(
        "AUTH_INVALID_SIGNATURE",
        "Missing required HMAC headers (timestamp, nonce, run-id)",
        401
      );
    }

    const timestamp = Number.parseInt(timestampHeader, 10);
    if (Number.isNaN(timestamp)) {
      throw new SecurityVerificationError(
        "AUTH_TIMESTAMP_OUT_OF_BOUNDS",
        "Malformed X-Marketplace-Timestamp header",
        401
      );
    }

    // 1. Timestamp bounds
    const now = Date.now();
    if (Math.abs(now - timestamp) > this.maxTimestampDriftMs) {
      throw new SecurityVerificationError(
        "AUTH_TIMESTAMP_OUT_OF_BOUNDS",
        `Timestamp drift exceeds ${this.maxTimestampDriftMs}ms`,
        401
      );
    }

    // 2. Nonce uniqueness
    if (this.seenNonces.has(nonceHeader)) {
      throw new SecurityVerificationError(
        "AUTH_REPLAY_DETECTED",
        "Duplicate nonce (replay guard)",
        401
      );
    }

    // 3. Run ID idempotency
    if (this.activeRunIds.has(runIdHeader) || this.completedRunIds.has(runIdHeader)) {
      throw new SecurityVerificationError(
        "AUTH_REPLAY_DETECTED",
        `Run ID ${runIdHeader} already active or completed`,
        401
      );
    }

    // 4. Verify signature
    const bodyHash = this.computeBodyHash(params.rawBody);
    const canonicalString = this.buildCanonicalString(
      params.method, params.path, timestampHeader, nonceHeader, runIdHeader, bodyHash
    );
    const expectedSignature = this.calculateSignature(canonicalString, this.secret);

    const sigBuf = Buffer.from(signatureHeader.toLowerCase(), "utf8");
    const expBuf = Buffer.from(expectedSignature.toLowerCase(), "utf8");

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new SecurityVerificationError(
        "AUTH_INVALID_SIGNATURE",
        "HMAC-SHA256 signature verification failed",
        401
      );
    }

    // Mark nonce seen
    this.seenNonces.set(nonceHeader, now);

    return { runId: runIdHeader, nonce: nonceHeader, timestamp, authMode: "hmac" };
  }

  // ── Public helpers ──

  public computeBodyHash(rawBody: string | Buffer): string {
    return createHash("sha256").update(rawBody).digest("hex");
  }

  public buildCanonicalString(
    method: string, path: string, timestamp: string | number,
    nonce: string, runId: string, bodyHash: string
  ): string {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = path.split("?")[0] || "/";
    return `${normalizedMethod}\n${normalizedPath}\n${timestamp}\n${nonce}\n${runId}\n${bodyHash}`;
  }

  public calculateSignature(canonicalString: string, secret: string): string {
    return createHmac("sha256", secret).update(canonicalString).digest("hex");
  }

  public markRunStarted(runId: string): void {
    this.activeRunIds.add(runId);
  }

  public markRunCompleted(runId: string): void {
    this.activeRunIds.delete(runId);
    this.completedRunIds.set(runId, Date.now());
  }

  private cleanupOldEntries(): void {
    const now = Date.now();
    const expiry = now - this.nonceTtlMs;
    for (const [nonce, time] of this.seenNonces.entries()) {
      if (time < expiry) this.seenNonces.delete(nonce);
    }
    for (const [runId, time] of this.completedRunIds.entries()) {
      if (time < expiry) this.completedRunIds.delete(runId);
    }
  }
}
