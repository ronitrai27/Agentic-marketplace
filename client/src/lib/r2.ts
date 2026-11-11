import { AwsClient } from "aws4fetch";

/** Server-only Cloudflare R2 helper (S3-compatible API). */
function config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    throw new Error("R2 storage is not configured.");
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

export async function uploadToR2(
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const c = config();
  const client = new AwsClient({
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const res = await client.fetch(
    `https://${c.accountId}.r2.cloudflarestorage.com/${c.bucket}/${key}`,
    {
      method: "PUT",
      body,
      headers: {
        "content-type": contentType,
        // R2 rejects chunked uploads (411), so send the length explicitly
        "content-length": String(body.byteLength),
        "cache-control": "public, max-age=31536000, immutable",
      },
    },
  );
  if (!res.ok) throw new Error(`R2 upload failed (${res.status}).`);
  return `${c.publicUrl}/${key}`;
}
