/**
 * Resource-server auth for mcp.gis.ph (mcp.gis.ph#5, plan #4).
 *
 * Resolution order for POST /mcp:
 * 1. `?key=` anywhere in the URL → 401 (removed in the OAuth release; use OAuth
 *    or a header / Bearer API key). Checked first so a URL key is never forwarded.
 * 2. `Authorization: Bearer gis_sk_*` → API key, forwarded upstream as-is.
 * 3. `Authorization: Bearer <JWT>` → MCP access token issued by api.gis.ph:
 *    HS256 with MCP_OAUTH_SECRET, iss/aud/typ=mcp_access/exp checked.
 * 4. `x-api-key: <key>` → API key, forwarded upstream as Bearer (unchanged).
 * 5. Nothing → anonymous (boundary metadata tools only).
 *
 * Any presented but unusable credential → 401 + WWW-Authenticate with
 * error="invalid_token". No credential on a signed-in tool → 401 without error.
 *
 * Revocation: this Worker has no access to api.gis.ph's refresh-family store,
 * so a revoked sign-in's access token stays valid until it expires (≤ 1 h by
 * default). Introspection / shared store is a follow-up.
 */
import { jwtVerify } from "jose";

import type { McpConfig } from "./config";

export type Access =
  | { kind: "oauth"; sub: string; clerkId: string; email: string | null; scope: string }
  | { kind: "api_key"; apiKey: string }
  | { kind: "anonymous" };

export type AuthResult =
  | { ok: true; access: Access }
  | { ok: false; status: 401; tokenPresented: boolean; message: string }
  | { ok: false; status: 503; message: string };

const ACCESS_TYP = "mcp_access";
const CLOCK_TOLERANCE_SEC = 30;

export type VerifiedAccessToken = { sub: string; clerkId: string; email: string | null; scope: string };

export async function verifyAccessToken(cfg: McpConfig, token: string): Promise<VerifiedAccessToken | null> {
  if (!cfg.oauthSecret || !token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(cfg.oauthSecret), {
      issuer: cfg.issuer,
      audience: cfg.audience,
      algorithms: ["HS256"],
      clockTolerance: CLOCK_TOLERANCE_SEC,
      requiredClaims: ["exp", "sub"],
    });
    if (payload.typ !== ACCESS_TYP || typeof payload.sub !== "string" || !payload.sub) return null;
    // The upstream user is identified by Clerk id (decision 2); a token without one is unusable.
    if (typeof payload.clerk_id !== "string" || !payload.clerk_id) return null;
    const scope = typeof payload.scope === "string" ? payload.scope : "";
    if (!scope.split(/\s+/).includes("mcp")) return null;
    return {
      sub: payload.sub,
      clerkId: payload.clerk_id,
      email: typeof payload.email === "string" && payload.email ? payload.email : null,
      scope,
    };
  } catch {
    return null;
  }
}

function bearer(header: string | undefined | null): { present: boolean; token: string | null } {
  if (header == null || header.trim() === "") return { present: false, token: null };
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return { present: true, token: m ? m[1]! : null };
}

export async function resolveAccess(
  cfg: McpConfig,
  req: { url: string; header(name: string): string | undefined },
): Promise<AuthResult> {
  if (new URL(req.url).searchParams.has("key")) {
    return {
      ok: false,
      status: 401,
      tokenPresented: true,
      message:
        "API keys in the URL (?key=) are no longer accepted. Connect with OAuth, or send the key in the x-api-key header or as Authorization: Bearer gis_sk_…",
    };
  }

  const auth = bearer(req.header("authorization"));
  if (auth.present) {
    if (!auth.token) {
      return { ok: false, status: 401, tokenPresented: true, message: "Unsupported Authorization header; use Bearer" };
    }
    if (auth.token.startsWith("gis_sk_")) return { ok: true, access: { kind: "api_key", apiKey: auth.token } };
    if (!cfg.oauthSecret || !cfg.serviceKey) {
      // Fail closed: cannot verify (no secret) or cannot call upstream for the user (no service key).
      return { ok: false, status: 401, tokenPresented: true, message: "OAuth sign-in is not available on this server" };
    }
    const claims = await verifyAccessToken(cfg, auth.token);
    if (!claims) return { ok: false, status: 401, tokenPresented: true, message: "Invalid or expired access token" };
    return { ok: true, access: { kind: "oauth", ...claims } };
  }

  const headerKey = req.header("x-api-key")?.trim();
  if (headerKey) return { ok: true, access: { kind: "api_key", apiKey: headerKey } };

  return { ok: true, access: { kind: "anonymous" } };
}

function quote(v: string): string {
  // Header values must be visible ASCII; drop quotes, backslashes and anything else.
  return `"${v.replace(/…/g, "...").replace(/[^\x20-\x7e]|["\\]/g, "")}"`;
}

/** RFC 6750 §3 + RFC 9728 §5.1. */
export function wwwAuthenticate(cfg: McpConfig, opts: { tokenPresented: boolean; description?: string }): string {
  const parts = [
    `realm=${quote("gisph")}`,
    `resource_metadata=${quote(cfg.resourceMetadataUrl)}`,
    `scope=${quote("mcp")}`,
  ];
  if (opts.tokenPresented) {
    parts.push(`error=${quote("invalid_token")}`);
    if (opts.description) parts.push(`error_description=${quote(opts.description)}`);
  }
  return `Bearer ${parts.join(", ")}`;
}

// ── Upstream (api.gis.ph) credentials ──────────────────────────────────

export type UpstreamAuth = {
  baseUrl: string;
  kind: Access["kind"];
  headers: Record<string, string>;
};

export const CLIENT_KEY_HEADER = "X-MCP-Client-Key";

async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stable anonymous client identifier for api.gis.ph's per-client 30 rpm bucket.
 * HMAC of the client IP keyed by the service key: not reversible to the IP and
 * not choosable by the client. The MCP session id is deliberately NOT mixed in,
 * because a client could rotate it to get unlimited buckets.
 */
export async function anonymousClientKey(serviceKey: string, clientIp: string | undefined): Promise<string> {
  return `mcp1-${(await hmacHex(serviceKey, `anon:${clientIp || "unknown"}`)).slice(0, 40)}`;
}

/**
 * Headers for calls to api.gis.ph. Never forwards the MCP access token; never
 * mints or stores gis_sk_ keys (decision 2).
 */
export async function upstreamAuth(
  cfg: McpConfig,
  access: Access,
  clientIp: string | undefined,
): Promise<UpstreamAuth | null> {
  const base = { baseUrl: cfg.apiBase, kind: access.kind };
  switch (access.kind) {
    case "api_key":
      return { ...base, headers: { Authorization: `Bearer ${access.apiKey}` } };
    case "oauth": {
      if (!cfg.serviceKey) return null;
      const headers: Record<string, string> = { Authorization: `Bearer ${cfg.serviceKey}`, "X-Clerk-Id": access.clerkId };
      if (access.email) headers["X-Clerk-Email"] = access.email;
      return { ...base, headers };
    }
    case "anonymous": {
      if (!cfg.serviceKey) return null;
      return {
        ...base,
        headers: {
          Authorization: `Bearer ${cfg.serviceKey}`,
          [CLIENT_KEY_HEADER]: await anonymousClientKey(cfg.serviceKey, clientIp),
        },
      };
    }
  }
}

const GEOMETRY_PARAMS = ["geometry", "output"];

/** Anonymous callers get JSON metadata only: drop geometry/GeoJSON params before calling upstream. */
export function upstreamParams(auth: UpstreamAuth, params: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!params || auth.kind !== "anonymous") return params;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (GEOMETRY_PARAMS.includes(k)) continue;
    if (k === "format" && v.toLowerCase() !== "json") continue;
    out[k] = v;
  }
  return out;
}
