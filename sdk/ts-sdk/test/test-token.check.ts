// Quick end-to-end check: mint a test token like the marketplace does, verify it with the SDK.
// Run: npx tsx test/test-token.check.ts  (signing key from CATELOG_SIGNING_KEY or client/.env.local)
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { SecurityManager } from "../src/security.js";

const b64u = (v: string | Buffer) => Buffer.from(v).toString("base64url");
const raw =
  process.env.CATELOG_SIGNING_KEY ??
  /CATELOG_SIGNING_KEY="([\s\S]*?)"/.exec(
    readFileSync(new URL("../../../client/.env.local", import.meta.url), "utf8"),
  )![1];
const pem = raw.replace(/\\n/g, "\n");
const PUB = "cat_pub_live_testcreator";

function mint(sub: string, ttl: number, iatOffset = 0) {
  const iat = Math.floor(Date.now() / 1000) + iatOffset;
  const h = b64u(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: "k1" }));
  const p = b64u(JSON.stringify({ iss: "catelog", sub, scope: "test", iat, exp: iat + ttl, jti: randomUUID() }));
  return `cat_test_${h}.${p}.${b64u(sign(null, Buffer.from(`${h}.${p}`), createPrivateKey(pem)))}`;
}

const sec = new SecurityManager({ secret: "cat_sec_live_x", publicKey: PUB });
const auth = (token: string) =>
  sec.authenticateRequest({ method: "POST", path: "/execute", headers: { authorization: `Bearer ${token}` }, rawBody: "{}" });

const cases: Array<[string, string, boolean]> = [
  ["valid token", mint(PUB, 60), true],
  ["other creator", mint("cat_pub_live_someoneelse", 60), false],
  ["expired", mint(PUB, 60, -600), false],
  ["ttl too long", mint(PUB, 3600), false],
  ["tampered", mint(PUB, 60).slice(0, -3) + "AAA", false],
];

let failed = 0;
for (const [name, token, shouldPass] of cases) {
  let ok = false;
  let msg = "";
  try {
    ok = auth(token).authMode === "test";
  } catch (e) {
    msg = (e as Error).message;
  }
  const good = ok === shouldPass;
  if (!good) failed++;
  console.log(`${good ? "PASS" : "FAIL"}  ${name}${msg ? `  (${msg})` : ""}`);
}
process.exit(failed ? 1 : 0);
