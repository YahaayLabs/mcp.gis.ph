import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  anonymousClientKey,
  resolveAccess,
  upstreamAuth,
  upstreamParams,
  verifyAccessToken,
  wwwAuthenticate,
} from "../src/auth";
import { config } from "../src/config";

const SECRET = "test-secret-that-is-at-least-32-chars-long!!";
const SERVICE = "svc-test-key-not-real";
const cfg = config({ MCP_OAUTH_SECRET: SECRET, GISPH_MCP_SERVICE_KEY: SERVICE });

async function token(over: Record<string, unknown> = {}, opts: { secret?: string; iss?: string; aud?: string; exp?: number | string } = {}) {
  return new SignJWT({ typ: "mcp_access", clerk_id: "user_clerk_1", email: "a@example.com", scope: "mcp", ...over })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("u-1")
    .setIssuer(opts.iss ?? "https://api.gis.ph")
    .setAudience(opts.aud ?? "gisph-mcp")
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
    .sign(new TextEncoder().encode(opts.secret ?? SECRET));
}

const req = (url: string, headers: Record<string, string> = {}) => ({
  url,
  header: (n: string) => headers[n.toLowerCase()],
});

describe("config", () => {
  it("defaults and secret length rule", () => {
    const c = config({});
    expect(c.resource).toBe("https://mcp.gis.ph/mcp");
    expect(c.resourceMetadataUrl).toBe("https://mcp.gis.ph/.well-known/oauth-protected-resource");
    expect(c.issuer).toBe("https://api.gis.ph");
    expect(c.apiBase).toBe("https://api.gis.ph/v1");
    expect(c.oauthSecret).toBeNull();
    expect(config({ MCP_OAUTH_SECRET: "short" }).oauthSecret).toBeNull();
  });
  it("uses env overrides and ignores invalid URLs", () => {
    const c = config({ MCP_PUBLIC_BASE: "https://mcp.staging.example/", GISPH_API_BASE: "not a url", MCP_OAUTH_ISSUER: "javascript:alert(1)" });
    expect(c.resource).toBe("https://mcp.staging.example/mcp");
    expect(c.apiBase).toBe("https://api.gis.ph/v1");
    expect(c.issuer).toBe("https://api.gis.ph");
  });
});

describe("verifyAccessToken", () => {
  it("accepts a valid access token", async () => {
    expect(await verifyAccessToken(cfg, await token())).toEqual({ sub: "u-1", clerkId: "user_clerk_1", email: "a@example.com", scope: "mcp" });
  });
  it.each([
    ["wrong secret", { }, { secret: "another-secret-that-is-at-least-32-chars" }],
    ["wrong issuer", {}, { iss: "https://evil.example" }],
    ["wrong audience", {}, { aud: "other" }],
    ["expired beyond tolerance", {}, { exp: Math.floor(Date.now() / 1000) - 120 }],
    ["refresh token typ", { typ: "mcp_refresh" }, {}],
    ["auth code typ", { typ: "mcp_auth_code" }, {}],
    ["missing clerk_id", { clerk_id: null }, {}],
    ["missing mcp scope", { scope: "read" }, {}],
  ])("rejects %s", async (_n, claims, opts) => {
    expect(await verifyAccessToken(cfg, await token(claims, opts))).toBeNull();
  });
  it("rejects alg none and garbage", async () => {
    const h = btoa(JSON.stringify({ alg: "none" })).replace(/=+$/, "");
    const p = btoa(JSON.stringify({ typ: "mcp_access", sub: "u", iss: "https://api.gis.ph", aud: "gisph-mcp", exp: 9e9, clerk_id: "x", scope: "mcp" })).replace(/=+$/, "");
    expect(await verifyAccessToken(cfg, `${h}.${p}.`)).toBeNull();
    expect(await verifyAccessToken(cfg, "not.a.jwt")).toBeNull();
  });
  it("rejects everything when the secret is not configured", async () => {
    expect(await verifyAccessToken(config({}), await token())).toBeNull();
  });
});

describe("resolveAccess", () => {
  it("rejects ?key= even with a valid header key", async () => {
    const r = await resolveAccess(cfg, req("https://mcp.gis.ph/mcp?key=gis_sk_x", { "x-api-key": "gis_sk_y" }));
    expect(r).toMatchObject({ ok: false, status: 401, tokenPresented: true });
  });
  it("rejects an empty ?key=", async () => {
    expect(await resolveAccess(cfg, req("https://mcp.gis.ph/mcp?key="))).toMatchObject({ ok: false, status: 401 });
  });
  it("Bearer gis_sk_ is an API key", async () => {
    expect(await resolveAccess(cfg, req("https://mcp.gis.ph/mcp", { authorization: "Bearer gis_sk_abc" }))).toEqual({ ok: true, access: { kind: "api_key", apiKey: "gis_sk_abc" } });
  });
  it("x-api-key is an API key", async () => {
    expect(await resolveAccess(cfg, req("https://mcp.gis.ph/mcp", { "x-api-key": " gis_sk_h " }))).toEqual({ ok: true, access: { kind: "api_key", apiKey: "gis_sk_h" } });
  });
  it("valid OAuth bearer", async () => {
    const r = await resolveAccess(cfg, req("https://mcp.gis.ph/mcp", { authorization: `Bearer ${await token()}` }));
    expect(r).toMatchObject({ ok: true, access: { kind: "oauth", clerkId: "user_clerk_1" } });
  });
  it("invalid bearer is 401 invalid_token, not anonymous", async () => {
    expect(await resolveAccess(cfg, req("https://mcp.gis.ph/mcp", { authorization: "Bearer nope" }))).toMatchObject({ ok: false, status: 401, tokenPresented: true });
  });
  it("non-Bearer Authorization is rejected", async () => {
    expect(await resolveAccess(cfg, req("https://mcp.gis.ph/mcp", { authorization: "Basic abc" }))).toMatchObject({ ok: false, status: 401 });
  });
  it("OAuth fails closed without the service key", async () => {
    const c = config({ MCP_OAUTH_SECRET: SECRET });
    expect(await resolveAccess(c, req("https://mcp.gis.ph/mcp", { authorization: `Bearer ${await token()}` }))).toMatchObject({ ok: false, status: 401 });
  });
  it("no credential is anonymous", async () => {
    expect(await resolveAccess(cfg, req("https://mcp.gis.ph/mcp"))).toEqual({ ok: true, access: { kind: "anonymous" } });
  });
});

describe("wwwAuthenticate", () => {
  it("challenge without a token has no error", () => {
    const h = wwwAuthenticate(cfg, { tokenPresented: false, description: "x" });
    expect(h).toBe('Bearer realm="gisph", resource_metadata="https://mcp.gis.ph/.well-known/oauth-protected-resource", scope="mcp"');
  });
  it("invalid token adds error and a sanitised description", () => {
    const h = wwwAuthenticate(cfg, { tokenPresented: true, description: 'bad "token"\r\n' });
    expect(h).toContain('error="invalid_token"');
    expect(h).toContain('error_description="bad token"');
  });
});

describe("upstream credentials", () => {
  it("API key goes upstream as Bearer", async () => {
    expect((await upstreamAuth(cfg, { kind: "api_key", apiKey: "gis_sk_1" }, "192.0.2.4"))!.headers).toEqual({ Authorization: "Bearer gis_sk_1" });
  });
  it("OAuth uses the service key and Clerk headers, never the MCP token", async () => {
    const u = await upstreamAuth(cfg, { kind: "oauth", sub: "u", clerkId: "c1", email: null, scope: "mcp" }, undefined);
    expect(u!.headers).toEqual({ Authorization: `Bearer ${SERVICE}`, "X-Clerk-Id": "c1" });
  });
  it("anonymous uses the service key and an opaque client key", async () => {
    const u = await upstreamAuth(cfg, { kind: "anonymous" }, "203.0.113.9");
    expect(u!.headers.Authorization).toBe(`Bearer ${SERVICE}`);
    const k = u!.headers["X-MCP-Client-Key"]!;
    expect(k).toMatch(/^mcp1-[0-9a-f]{40}$/);
    expect(k).not.toContain("203");
    expect(k).toMatch(/^[A-Za-z0-9_\-:.]{8,128}$/); // api.gis.ph#195 format
  });
  it("client key is stable per IP and differs across IPs and service keys", async () => {
    expect(await anonymousClientKey(SERVICE, "192.0.2.1")).toBe(await anonymousClientKey(SERVICE, "192.0.2.1"));
    expect(await anonymousClientKey(SERVICE, "192.0.2.1")).not.toBe(await anonymousClientKey(SERVICE, "192.0.2.2"));
    expect(await anonymousClientKey(SERVICE, "192.0.2.1")).not.toBe(await anonymousClientKey("other", "192.0.2.1"));
  });
  it("returns null for OAuth/anonymous without a service key", async () => {
    const c = config({});
    expect(await upstreamAuth(c, { kind: "anonymous" }, "192.0.2.1")).toBeNull();
    expect(await upstreamAuth(c, { kind: "oauth", sub: "u", clerkId: "c", email: null, scope: "mcp" }, undefined)).toBeNull();
  });
  it("strips geometry params for anonymous only", async () => {
    const anon = (await upstreamAuth(cfg, { kind: "anonymous" }, "192.0.2.1"))!;
    const key = (await upstreamAuth(cfg, { kind: "api_key", apiKey: "k" }, undefined))!;
    const p = { geometry: "true", output: "geojson", format: "geojson", page: "2" };
    expect(upstreamParams(anon, p)).toEqual({ page: "2" });
    expect(upstreamParams(anon, { format: "json" })).toEqual({ format: "json" });
    expect(upstreamParams(key, p)).toEqual(p);
  });
});
