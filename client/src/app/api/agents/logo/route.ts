import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth-server";
import { uploadToR2 } from "@/lib/r2";

// The browser resizes to a 256x256 PNG first, so anything larger is not ours.
const MAX_BYTES = 512 * 1024;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export async function POST(req: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Logo is too large." }, { status: 413 });
  }

  const bytes = await file.arrayBuffer();
  const head = new Uint8Array(bytes.slice(0, 4));
  if (!PNG_MAGIC.every((b, i) => head[i] === b)) {
    return NextResponse.json({ error: "Logo must be a PNG." }, { status: 415 });
  }

  try {
    const url = await uploadToR2(
      `agent-logos/${crypto.randomUUID()}.png`,
      bytes,
      "image/png",
    );
    return NextResponse.json({ url });
  } catch (e) {
    console.error("logo upload failed", e);
    return NextResponse.json({ error: "Upload failed." }, { status: 502 });
  }
}
