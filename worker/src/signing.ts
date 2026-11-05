import { constants, createHash, createHmac, createPrivateKey, privateDecrypt, randomUUID } from "node:crypto";

/** Opens the agent's signing key, sealed by Convex to our RSA public key. Only this worker holds the private half. */
export function openSealedSecret(sealed: string): string {
  const der = process.env.RUN_SECRET_PRIVATE_KEY;
  if (!der) throw new Error("RUN_SECRET_PRIVATE_KEY is not set");
  const key = createPrivateKey({ key: Buffer.from(der, "base64"), format: "der", type: "pkcs8" });
  return privateDecrypt(
    { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(sealed, "base64"),
  ).toString("utf8");
}

/**
 * Headers the Catelog SDK's HMAC mode expects (sdk/ts-sdk/src/security.ts):
 * signature = HMAC-SHA256(secret, METHOD \n path \n timestamp \n nonce \n runId \n sha256(body)).
 */
export function signRequest(opts: { method: string; path: string; body: string; runId: string; secret: string }) {
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(opts.body).digest("hex");
  const canonical = `${opts.method.toUpperCase()}\n${opts.path}\n${timestamp}\n${nonce}\n${opts.runId}\n${bodyHash}`;
  const signature = createHmac("sha256", opts.secret).update(canonical).digest("hex");
  return {
    "X-Marketplace-Signature": signature,
    "X-Marketplace-Timestamp": timestamp,
    "X-Marketplace-Nonce": nonce,
    "X-Marketplace-Run-Id": opts.runId,
  };
}
