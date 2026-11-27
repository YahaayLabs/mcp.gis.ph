/**
 * HTTP layer for OAuth on mcp.gis.ph (mcp.gis.ph#5): protected-resource
 * metadata, 401 + WWW-Authenticate challenges, and per-request upstream auth.
 */
import type { Context, Hono } from "hono";

import { resolveAccess, upstreamAuth, wwwAuthenticate, type UpstreamAuth } from "./auth";
import { config, type McpEnv } from "./config";
import { protectedResourceDocument } from "./oauth-metadata";
import { calledTools, requiresSignIn } from "./tool-policy";

export type { UpstreamAuth };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHono = Hono<any>;

export function registerAuthRoutes(app: AnyHono) {
  const prm = (c: Context) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(protectedResourceDocument(config(c.env as McpEnv)));
  };
  // RFC 9728 §3.1: root form and the path-suffixed form for resource /mcp.
  app.get("/.well-known/oauth-protected-resource", prm);
  app.get("/.well-known/oauth-protected-resource/mcp", prm);
}

export function discoveryAuth(env: McpEnv) {
  const cfg = config(env);
  return {
    endpoint: cfg.resource,
    auth: {
      oauth: {
        resource_metadata: cfg.resourceMetadataUrl,
        authorization_server: cfg.issuer,
        note: "Add the endpoint as a custom connector in Claude or Cursor and sign in with your gis.ph account.",
      },
      api_key: "Send a gis.ph API key in the x-api-key header or as Authorization: Bearer gis_sk_… (the ?key= URL parameter is no longer accepted).",
      anonymous: "Boundary metadata tools work without sign-in (JSON only, rate limited).",
    },
  };
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: id ?? null };
}

function firstId(body: unknown): unknown {
  const m = Array.isArray(body) ? body[0] : body;
  return m && typeof m === "object" ? (m as { id?: unknown }).id : null;
}

function challenge(c: Context, env: McpEnv, opts: { tokenPresented: boolean; message: string; id?: unknown }) {
  c.header("WWW-Authenticate", wwwAuthenticate(config(env), { tokenPresented: opts.tokenPresented, description: opts.message }));
  c.header("Cache-Control", "no-store");
  return c.json(rpcError(opts.id, -32001, opts.message), 401);
}

/**
 * Gate POST/GET/DELETE /mcp, then hand the resolved upstream credential to `run`.
 */
export async function handleMcp(c: Context, run: (upstream: UpstreamAuth) => Promise<Response | undefined>) {
  const env = c.env as McpEnv;
  const cfg = config(env);

  // Plain GET (browser / health check) → public discovery; SSE GETs go to the transport.
  if (c.req.method === "GET" && !(c.req.header("accept") ?? "").includes("text/event-stream")) {
    return c.json({ name: "gis.ph MCP Server", ...discoveryAuth(env) });
  }

  const auth = await resolveAccess(cfg, { url: c.req.url, header: (n) => c.req.header(n) });
  if (!auth.ok) {
    if (auth.status === 401) return challenge(c, env, { tokenPresented: auth.tokenPresented, message: auth.message });
    return c.json(rpcError(null, -32603, auth.message), 503);
  }
  const { access } = auth;

  if (access.kind === "anonymous" && c.req.method === "POST") {
    let body: unknown;
    try {
      body = await c.req.json(); // cached by Hono; the transport re-reads it
    } catch {
      body = undefined; // let the transport return its parse error
    }
    const gated = calledTools(body).find((name) => requiresSignIn(access, name));
    if (gated) {
      return challenge(c, env, {
        tokenPresented: false,
        message: `Sign in to gis.ph to use ${gated}. Boundary tools (regions, provinces, municities, barangays) work without sign-in.`,
        id: firstId(body),
      });
    }
  }

  const upstream = await upstreamAuth(cfg, access, c.req.header("cf-connecting-ip"));
  if (!upstream) {
    // Only reachable for anonymous: OAuth without a service key already failed closed in resolveAccess.
    return c.json(rpcError(null, -32603, "Anonymous access is not configured on this server; connect with OAuth or an API key."), 503);
  }
  return (await run(upstream)) ?? c.body(null, 204);
}
