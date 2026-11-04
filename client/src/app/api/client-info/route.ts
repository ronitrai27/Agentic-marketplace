import { NextResponse } from "next/server";

/** The caller's IP and region as seen by our edge, so run traces can record them for browser-started runs. */
export async function GET(request: Request) {
  const h = request.headers;
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const country = h.get("x-vercel-ip-country") || h.get("cf-ipcountry");
  const city = h.get("x-vercel-ip-city");
  const region = [city && decodeURIComponent(city), country].filter(Boolean).join(", ") || null;
  return NextResponse.json({ ip, region }, { headers: { "Cache-Control": "no-store" } });
}
