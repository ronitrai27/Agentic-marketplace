import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { config } from "./config.js";

/**
 * Checks the OAuth access token the MCP client received after the user clicked
 * "Allow" on the Catelog consent page. better-auth issues opaque tokens, so we
 * ask Convex who owns the token (token introspection) instead of verifying a JWT.
 */
export function createVerifier(): OAuthTokenVerifier {
  if (config.convexSiteUrl && config.backendSecret) {
    return {
      async verifyAccessToken(token) {
        const res = await fetch(`${config.convexSiteUrl}/mcp/introspect`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.backendSecret}`,
          },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          throw new OAuthError(OAuthErrorCode.ServerError, "Token check failed");
        }
        const t = (await res.json()) as {
          active: boolean;
          userId?: string;
          clientId?: string;
          scope?: string;
          exp?: number;
        };
        if (!t.active || !t.userId || !t.exp) {
          throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid or expired token");
        }
        return {
          token,
          clientId: t.clientId ?? "unknown",
          scopes: (t.scope ?? "").split(/[ ,]+/).filter(Boolean),
          expiresAt: t.exp,
          extra: { userId: t.userId },
        };
      },
    };
  }

  throw new Error("Set CONVEX_SITE_URL and MCP_BACKEND_SECRET.");
}
