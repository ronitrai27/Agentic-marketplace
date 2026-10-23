import { createHash } from "node:crypto";

export interface VerifyKeyOptions {
  clientIp?: string;
  region?: string;
}

export interface VerificationResult {
  valid: boolean;
  userId?: string;
  rateLimitPerMin?: number;
  error?: "INVALID_KEY" | "KEY_EXPIRED" | "KEY_REVOKED" | "IP_FORBIDDEN" | "REGION_RESTRICTED" | "INVALID_FORMAT";
  message?: string;
}

/**
 * Computes salted SHA-256 hash in lowercase hex
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey.trim()).digest("hex");
}

/**
 * Gateway Verification Helper for incoming SDK requests
 * 
 * Extracts Bearer token, hashes it, and verifies it against Convex database:
 * 1. Verifies prefix (`cat_sec_live_` or `cat_pub_live_`)
 * 2. Computes SHA-256 hash
 * 3. Calls verification handler
 */
export async function verifyIncomingRequest(
  authHeader: string | null | undefined,
  options: VerifyKeyOptions = {},
  verifyFn: (params: { keyHash: string; clientIp?: string; region?: string }) => Promise<VerificationResult>
): Promise<VerificationResult> {
  if (!authHeader) {
    return {
      valid: false,
      error: "INVALID_FORMAT",
      message: "Missing Authorization header",
    };
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token.startsWith("cat_sec_live_") && !token.startsWith("cat_pub_live_")) {
    return {
      valid: false,
      error: "INVALID_FORMAT",
      message: "Invalid API key format. Expected cat_sec_live_... or cat_pub_live_...",
    };
  }

  // Hash key
  const keyHash = hashApiKey(token);

  // Call database verification
  return await verifyFn({
    keyHash,
    clientIp: options.clientIp,
    region: options.region,
  });
}
