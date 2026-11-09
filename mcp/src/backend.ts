import { config } from "./config.js";

/** POSTs to a Convex `/mcp/*` route with the shared server-to-server secret. */
export async function callBackend<T>(path: string, body: unknown): Promise<T> {
  if (!config.convexSiteUrl || !config.backendSecret) {
    throw new Error("CONVEX_SITE_URL and MCP_BACKEND_SECRET must be set");
  }
  const res = await fetch(`${config.convexSiteUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.backendSecret}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Backend ${path} returned ${res.status}`);
  return (await res.json()) as T;
}
