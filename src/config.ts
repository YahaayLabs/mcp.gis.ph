/**
 * mcp.gis.ph runtime config (mcp.gis.ph#5). Non-secret defaults live in
 * wrangler.toml [vars]; secrets are Worker secrets (names only here).
 */
import { parseMaxResponseBytes } from "./response-budget";

export interface McpEnv {
  /** Secret. HS256 key shared with api.gis.ph (the authorization server). */
  MCP_OAUTH_SECRET?: string;
  /** Secret. Dedicated service key for upstream calls (api.gis.ph#195). */
  GISPH_MCP_SERVICE_KEY?: string;
  /** Token issuer = authorization server origin (default https://api.gis.ph). */
  MCP_OAUTH_ISSUER?: string;
  /** Token audience (default gisph-mcp). */
  MCP_OAUTH_AUDIENCE?: string;
  /** Public origin of this Worker (default https://mcp.gis.ph). */
  MCP_PUBLIC_BASE?: string;
  /** Upstream API base incl. version (default https://api.gis.ph/v1). */
  GISPH_API_BASE?: string;
  /** Max bytes of a tool result sent to MCP clients (default 1000000); larger results become a summary. */
  MCP_MAX_RESPONSE_BYTES?: string;
}

export const DEFAULTS = {
  issuer: "https://api.gis.ph",
  audience: "gisph-mcp",
  publicBase: "https://mcp.gis.ph",
  apiBase: "https://api.gis.ph/v1",
  clientId: "gisph-mcp",
} as const;

/** HS256 secrets shorter than this are treated as unset (same rule as api.gis.ph). */
export const MIN_SECRET_LENGTH = 32;

function origin(raw: string | undefined, fallback: string): string {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!v) return fallback;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" || u.protocol === "http:") return v;
  } catch {
    /* fall through */
  }
  return fallback;
}

export function config(env: McpEnv) {
  const publicBase = origin(env.MCP_PUBLIC_BASE, DEFAULTS.publicBase);
  const issuer = origin(env.MCP_OAUTH_ISSUER, DEFAULTS.issuer);
  const secret = env.MCP_OAUTH_SECRET ?? "";
  return {
    publicBase,
    resource: `${publicBase}/mcp`,
    resourceMetadataUrl: `${publicBase}/.well-known/oauth-protected-resource`,
    issuer,
    audience: (env.MCP_OAUTH_AUDIENCE ?? "").trim() || DEFAULTS.audience,
    apiBase: origin(env.GISPH_API_BASE, DEFAULTS.apiBase),
    oauthSecret: secret.length >= MIN_SECRET_LENGTH ? secret : null,
    serviceKey: env.GISPH_MCP_SERVICE_KEY ? env.GISPH_MCP_SERVICE_KEY : null,
    maxResponseBytes: parseMaxResponseBytes(env.MCP_MAX_RESPONSE_BYTES),
  };
}

export type McpConfig = ReturnType<typeof config>;
