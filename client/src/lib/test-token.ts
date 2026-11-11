import { createPrivateKey, randomUUID, sign } from "node:crypto";

export const TEST_TOKEN_TTLS = [60, 90, 180, 300] as const;
export type TestTokenTtl = (typeof TEST_TOKEN_TTLS)[number];

const b64u = (v: string | Buffer) => Buffer.from(v).toString("base64url");

/**
 * Mints a short-lived Ed25519 test token for a creator.
 * Format: cat_test_<header>.<payload>.<signature>. The agent SDK verifies it
 * with Catelog's public key and checks `sub` against its CATELOG_PUBLIC_KEY.
 */
export function mintTestToken(creatorPublicKey: string, ttlSec: TestTokenTtl) {
  const pem = process.env.CATELOG_SIGNING_KEY?.replace(/\\n/g, "\n");
  const kid = process.env.CATELOG_SIGNING_KID || "k1";
  if (!pem) throw new Error("Test token signing is not configured.");

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSec;
  const header = b64u(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid }));
  const payload = b64u(
    JSON.stringify({
      iss: "catelog",
      sub: creatorPublicKey,
      scope: "test",
      iat,
      exp,
      jti: randomUUID(),
    }),
  );
  const signature = sign(
    null,
    Buffer.from(`${header}.${payload}`),
    createPrivateKey(pem),
  );

  return {
    token: `cat_test_${header}.${payload}.${b64u(signature)}`,
    expiresAt: exp * 1000,
    ttlSec,
  };
}
