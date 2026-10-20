import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ErrorCode } from "./types.js";

export interface SecurityOptions {
  secret?: string;
  maxTimestampDriftMs?: number; // default: 5 * 60 * 1000 (5 mins)
  nonceTtlMs?: number; // default: 5 * 60 * 1000 (5 mins)
}

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

export class SecurityManager {
  private secret?: string;
  private maxTimestampDriftMs: number;
  private nonceTtlMs: number;
  private seenNonces = new Map<string, number>();
  private activeRunIds = new Set<string>();
  private completedRunIds = new Map<string, number>();

  constructor(options: SecurityOptions = {}) {
    this.secret = options.secret;
    this.maxTimestampDriftMs = options.maxTimestampDriftMs ?? 300_000; // 5 minutes
    this.nonceTtlMs = options.nonceTtlMs ?? 300_000; // 5 minutes
  }

  public setSecret(secret: string): void {
    this.secret = secret;
  }

  public getSecret(): string | undefined {
    return this.secret;
  }

  /**
   * Computes SHA-256 hash in lowercase hex of request body
   */
  public computeBodyHash(rawBody: string | Buffer): string {
    return createHash("sha256").update(rawBody).digest("hex");
  }

  /**
   * Constructs the canonical string according to MAPS 1.0.0:
   * METHOD\nPATH\nTIMESTAMP\nNONCE\nRUN_ID\nBodyHash
   */
  public buildCanonicalString(
    method: string,
    path: string,
    timestamp: string | number,
    nonce: string,
    runId: string,
    bodyHash: string
  ): string {
    const normalizedMethod = method.toUpperCase();
    const normalizedPath = path.split("?")[0] || "/";
    return `${normalizedMethod}\n${normalizedPath}\n${timestamp}\n${nonce}\n${runId}\n${bodyHash}`;
  }

  /**
   * Calculates HMAC-SHA256 signature in lowercase hex
   */
  public calculateSignature(canonicalString: string, secret: string): string {
    return createHmac("sha256", secret).update(canonicalString).digest("hex");
  }

  /**
   * Verifies headers, timestamp, nonce, and HMAC-SHA256 signature.
   */
  public verifyRequest(params: {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    rawBody: string | Buffer;
  }): { runId: string; nonce: string; timestamp: number } {
    this.cleanupOldEntries();

    // If no secret configured, skip HMAC check (e.g. local dev / unauthenticated mode)
    if (!this.secret) {
      const runId = (params.headers["x-marketplace-run-id"] as string) || "dev-run-id";
      const nonce = (params.headers["x-marketplace-nonce"] as string) || "dev-nonce";
      const timestamp = Date.now();
      return { runId, nonce, timestamp };
    }

    const timestampHeader = params.headers["x-marketplace-timestamp"] as string | undefined;
    const nonceHeader = params.headers["x-marketplace-nonce"] as string | undefined;
    const runIdHeader = params.headers["x-marketplace-run-id"] as string | undefined;
    const signatureHeader = params.headers["x-marketplace-signature"] as string | undefined;

    if (!timestampHeader || !nonceHeader || !runIdHeader || !signatureHeader) {
      throw new SecurityVerificationError(
        "AUTH_INVALID_SIGNATURE",
        "Missing required marketplace authentication headers",
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

    // 1. Timestamp Bounds: Reject if |CurrentTime - Timestamp| > 5 minutes
    const now = Date.now();
    if (Math.abs(now - timestamp) > this.maxTimestampDriftMs) {
      throw new SecurityVerificationError(
        "AUTH_TIMESTAMP_OUT_OF_BOUNDS",
        `Timestamp out of allowable bounds (clock drift > ${this.maxTimestampDriftMs}ms)`,
        401
      );
    }

    // 2. Nonce Uniqueness: Sliding cache
    if (this.seenNonces.has(nonceHeader)) {
      throw new SecurityVerificationError(
        "AUTH_REPLAY_DETECTED",
        "Duplicate nonce detected (replay attack guard)",
        401
      );
    }

    // 3. Run ID Idempotency: Duplicate active or completed run
    if (this.activeRunIds.has(runIdHeader) || this.completedRunIds.has(runIdHeader)) {
      throw new SecurityVerificationError(
        "AUTH_REPLAY_DETECTED",
        `Run ID ${runIdHeader} is currently executing or has already been completed`,
        401
      );
    }

    // 4. Verify HMAC signature
    const bodyHash = this.computeBodyHash(params.rawBody);
    const canonicalString = this.buildCanonicalString(
      params.method,
      params.path,
      timestampHeader,
      nonceHeader,
      runIdHeader,
      bodyHash
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

    // Mark nonce as seen
    this.seenNonces.set(nonceHeader, now);

    return {
      runId: runIdHeader,
      nonce: nonceHeader,
      timestamp,
    };
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
      if (time < expiry) {
        this.seenNonces.delete(nonce);
      }
    }

    for (const [runId, time] of this.completedRunIds.entries()) {
      if (time < expiry) {
        this.completedRunIds.delete(runId);
      }
    }
  }
}
