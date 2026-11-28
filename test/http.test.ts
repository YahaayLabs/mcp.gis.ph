import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import app from "../src/index";

const SECRET = "test-secret-that-is-at-least-32-chars-long!!";
const SERVICE = "svc-test-key-not-real";
const ENV = { MCP_OAUTH_SECRET: SECRET, GISPH_MCP_SERVICE_KEY: SERVICE, MCP_OBJECT: {} as never };

async function accessToken(claims: Record<string, unknown> = {}) {
  return new SignJWT({ typ: "mcp_access", clerk_id: "user_clerk_1", email: "a@example.com", scope: "mcp", ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("u-1")
    .setIssuer("https://api.gis.ph")
    .setAudience("gisph-mcp")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

let upstream: { url: string; headers: Record<string, string> }[] = [];
const realFetch = globalThis.fetch;
beforeEach(() => {
  upstream = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    upstream.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) } });
    return new Response(JSON.stringify({ data: [{ code: "01" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const rpc = (method: string, params: unknown = {}, id: number | string = 1) => ({ jsonrpc: "2.0", id, method, params });
const init = rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
const call = (name: string, args: Record<string, unknown> = {}, id = 2) => rpc("tools/call", { name, arguments: args }, id);

async function post(body: unknown, headers: Record<string, string> = {}, env: Record<string, unknown> = ENV, path = "/mcp") {
  return app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "cf-connecting-ip": "198.51.100.7", ...headers },
      body: JSON.stringify(body),
    },
    env,
  );
}

/** Parse a JSON or SSE MCP response into JSON-RPC messages. */
async function messages(res: Response): Promise<any[]> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
  }
  const j = JSON.parse(text);
  return Array.isArray(j) ? j : [j];
}

describe("discovery", () => {
  it("serves protected-resource metadata at both well-known paths", async () => {
    for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await app.request(p, {}, ENV);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        resource: "https://mcp.gis.ph/mcp",
        authorization_servers: ["https://api.gis.ph"],
        scopes_supported: ["mcp"],
        bearer_methods_supported: ["header"],
        resource_documentation: "https://mcp.gis.ph/mcp",
      });
    }
  });
  it("metadata follows env config", async () => {
    const res = await app.request("/.well-known/oauth-protected-resource", {}, { ...ENV, MCP_PUBLIC_BASE: "https://mcp.staging.example", MCP_OAUTH_ISSUER: "https://api.staging.example" });
    expect(await res.json()).toMatchObject({ resource: "https://mcp.staging.example/mcp", authorization_servers: ["https://api.staging.example"] });
  });
  it("GET / and plain GET /mcp no longer advertise ?key=", async () => {
    for (const p of ["/", "/mcp"]) {
      const res = await app.request(p, {}, ENV);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).not.toContain("?key=YOUR");
      expect(JSON.parse(body).endpoint).toBe("https://mcp.gis.ph/mcp");
    }
  });
});

describe("?key= removal", () => {
  it("POST /mcp?key= is 401 invalid_token and nothing is forwarded", async () => {
    const res = await post(call("get_regions"), {}, ENV, "/mcp?key=gis_sk_test");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(res.headers.get("www-authenticate")).toContain('resource_metadata="https://mcp.gis.ph/.well-known/oauth-protected-resource"');
    expect(upstream).toHaveLength(0);
  });
});

describe("anonymous", () => {
  it("initialize works without credentials", async () => {
    const res = await post(init);
    expect(res.status).toBe(200);
    expect((await messages(res))[0].result.serverInfo.name).toBe("gis-ph");
  });
  it("tools/list hides write tools", async () => {
    const res = await post(rpc("tools/list"));
    const names = (await messages(res))[0].result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("get_provinces");
    expect(names).toContain("search_municities");
    expect(names).toContain("search_barangays");
    expect(names).toContain("search_regions_by_ids");
    expect(names).toContain("search_provinces_by_codes");
    expect(names).toContain("search_municities_by_codes");
    expect(names).toContain("search_barangays_by_codes");
    expect(names).toContain("reverse_geocode");
    expect(names).toContain("list_datasets");
    for (const w of ["create_dataset", "update_dataset", "create_feature"]) expect(names).not.toContain(w);
  });
  it.each(["search_municities", "search_barangays"])(
    "%s works anonymously (free-tier name search)",
    async (name) => {
      const res = await post(call(name, { q: "cebu" }));
      expect(res.status).toBe(200);
      const [m] = await messages(res);
      expect(m.result.isError).toBeFalsy();
      expect(upstream).toHaveLength(1);
      expect(upstream[0]!.url).toContain(name === "search_municities" ? "/v1/municities/search" : "/v1/barangays/search");
      expect(upstream[0]!.headers.Authorization).toBe(`Bearer ${SERVICE}`);
    },
  );
  it("get_provinces works and goes upstream with service key + opaque client key", async () => {
    const res = await post(call("get_provinces"));
    expect(res.status).toBe(200);
    const [m] = await messages(res);
    expect(m.result.isError).toBeFalsy();
    expect(upstream).toHaveLength(1);
    expect(upstream[0]!.url.startsWith("https://api.gis.ph/v1/provinces")).toBe(true);
    expect(upstream[0]!.headers.Authorization).toBe(`Bearer ${SERVICE}`);
    expect(upstream[0]!.headers["X-MCP-Client-Key"]).toMatch(/^mcp1-[0-9a-f]{40}$/);
    expect(JSON.stringify(upstream[0])).not.toContain("198.51.100.7");
  });
  it.each([
    "list_datasets", "get_dataset", "list_features", "get_feature", "get_features_by_dataset",
    "search_regions_by_ids", "search_provinces_by_codes", "search_municities_by_codes", "search_barangays_by_codes",
    "reverse_geocode", "get_download_link",
  ])(
    "%s needs sign-in: 401 + challenge without error=",
    async (name) => {
      const res = await post(call(name, { id: "x", ids: ["01"], codes: ["133900000"] }));
      expect(res.status).toBe(401);
      const h = res.headers.get("www-authenticate")!;
      expect(h).toMatch(/^Bearer /);
      expect(h).toContain('resource_metadata="https://mcp.gis.ph/.well-known/oauth-protected-resource"');
      expect(h).not.toContain("error=");
      expect((await res.json()).error.message).toContain("Sign in");
      expect(upstream).toHaveLength(0);
    },
  );
  it("a batch with one signed-in tool is challenged", async () => {
    const res = await post([call("get_regions", {}, 1), call("list_datasets", {}, 2)]);
    expect(res.status).toBe(401);
    expect(upstream).toHaveLength(0);
  });
  it("geometry / GeoJSON params from the #6 tool schemas are stripped for anonymous callers", async () => {
    await messages(await post(call("get_provinces", { format: "geojson", geometry: "simple" })));
    expect(upstream).toHaveLength(1);
    const u = new URL(upstream[0]!.url);
    expect(u.searchParams.has("geometry")).toBe(false);
    expect(u.searchParams.has("format")).toBe(false);
  });
  it("API-key callers keep geometry / GeoJSON params", async () => {
    await messages(await post(call("get_provinces", { format: "geojson", geometry: "simple" }), { "x-api-key": "gis_sk_header" }));
    const u = new URL(upstream[0]!.url);
    expect(u.searchParams.get("geometry")).toBe("simple");
    expect(u.searchParams.get("format")).toBe("geojson");
  });
  it("is 503 (not silently keyless) when the service key is missing", async () => {
    const res = await post(call("get_regions"), {}, { MCP_OBJECT: {} });
    expect(res.status).toBe(503);
    expect(upstream).toHaveLength(0);
  });
});

describe("OAuth bearer", () => {
  it("signed-in tool works; upstream gets service key + Clerk headers, never the MCP token", async () => {
    const tok = await accessToken();
    const res = await post(call("list_datasets"), { authorization: `Bearer ${tok}` });
    expect(res.status).toBe(200);
    expect((await messages(res))[0].result.isError).toBeFalsy();
    expect(upstream).toHaveLength(1);
    expect(upstream[0]!.headers).toMatchObject({ Authorization: `Bearer ${SERVICE}`, "X-Clerk-Id": "user_clerk_1", "X-Clerk-Email": "a@example.com" });
    expect(JSON.stringify(upstream)).not.toContain(tok);
  });
  it("invalid token is 401 invalid_token", async () => {
    const res = await post(init, { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.bad" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
  it("expired token is 401 invalid_token", async () => {
    const tok = await new SignJWT({ typ: "mcp_access", clerk_id: "c", scope: "mcp" })
      .setProtectedHeader({ alg: "HS256" }).setSubject("u").setIssuer("https://api.gis.ph").setAudience("gisph-mcp")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 300).sign(new TextEncoder().encode(SECRET));
    const res = await post(init, { authorization: `Bearer ${tok}` });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });
  it("refresh token cannot be used as an access token", async () => {
    const res = await post(init, { authorization: `Bearer ${await accessToken({ typ: "mcp_refresh" })}` });
    expect(res.status).toBe(401);
  });
  it("write tools are disabled even when signed in", async () => {
    const res = await post(call("create_dataset", { name: "x" }), { authorization: `Bearer ${await accessToken()}` });
    const [m] = await messages(res);
    expect(JSON.stringify(m)).toMatch(/disabled/i);
    expect(upstream).toHaveLength(0);
  });
});

describe("API key (unchanged path)", () => {
  it("x-api-key is forwarded as Bearer", async () => {
    const res = await post(call("list_datasets"), { "x-api-key": "gis_sk_header" });
    expect(res.status).toBe(200);
    await messages(res);
    expect(upstream[0]!.headers.Authorization).toBe("Bearer gis_sk_header");
    expect(upstream[0]!.headers["X-Clerk-Id"]).toBeUndefined();
  });
  it("Authorization: Bearer gis_sk_ is forwarded and works without OAuth config", async () => {
    const res = await post(call("list_datasets"), { authorization: "Bearer gis_sk_bearer" }, { MCP_OBJECT: {} });
    expect(res.status).toBe(200);
    await messages(res);
    expect(upstream[0]!.headers.Authorization).toBe("Bearer gis_sk_bearer");
  });
  it("boundary tools work with an API key too", async () => {
    await messages(await post(call("get_province", { province_code: "0128" }), { "x-api-key": "gis_sk_header" }));
    expect(upstream).toHaveLength(1);
    expect(upstream[0]!.headers["X-MCP-Client-Key"]).toBeUndefined();
  });
});

describe("response size budget", () => {
  const bigFc = {
    type: "FeatureCollection",
    features: Array.from({ length: 50 }, (_, i) => ({
      type: "Feature",
      properties: { code: String(i) },
      geometry: { type: "Polygon", coordinates: [[[120 + i, 10], [121 + i, 10], [121 + i, 11], [120 + i, 10]]] },
    })),
  };
  const respondWith = (body: unknown) => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  };

  it("results are compact JSON (no pretty-printing)", async () => {
    const [m] = await messages(await post(call("get_provinces")));
    expect(m.result.content[0].text).toBe('{"data":[{"code":"01"}]}');
  });

  it("over MCP_MAX_RESPONSE_BYTES, a summary is returned instead of the data", async () => {
    respondWith(bigFc);
    const res = await post(call("get_regions", { format: "geojson" }), { "x-api-key": "gis_sk_test" }, { ...ENV, MCP_MAX_RESPONSE_BYTES: "1000" });
    const [m] = await messages(res);
    expect(m.result.isError).toBeFalsy();
    const body = JSON.parse(m.result.content[0].text);
    expect(body.response_too_large).toBe(true);
    expect(body.max_bytes).toBe(1000);
    expect(body.summary).toMatchObject({ type: "FeatureCollection", feature_count: 50, bbox: [120, 10, 170, 11] });
  });

  it("the default 1 MB budget lets normal results through", async () => {
    respondWith(bigFc);
    const res = await post(call("get_regions", { format: "geojson" }), { "x-api-key": "gis_sk_test" });
    const [m] = await messages(res);
    expect(JSON.parse(m.result.content[0].text)).toEqual(bigFc);
  });
});

describe("get_download_link", () => {
  it("calls GET /v1/downloads/link with the filters and returns the link", async () => {
    const data = { url: "https://api.gis.ph/downloads/x/a.geojson?exp=1&sig=s", zip_url: "https://api.gis.ph/downloads/x/a.geojson?exp=1&sig=s&zip=true", bytes: 9, feature_count: 2, bbox: [1, 2, 3, 4] };
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ data, error: null }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const res = await post(call("get_download_link", { resource: "municities", province_code: "0102800000", geometry: "detailed", zip: true }), { "x-api-key": "gis_sk_test" });
    const [m] = await messages(res);
    expect(m.result.isError).toBeFalsy();
    const u = new URL(seen[0]!);
    expect(u.pathname).toBe("/v1/downloads/link");
    expect(u.searchParams.get("resource")).toBe("municities");
    expect(u.searchParams.get("province_code")).toBe("0102800000");
    expect(u.searchParams.get("geometry")).toBe("detailed");
    expect(u.searchParams.has("zip")).toBe(false);
    const body = JSON.parse(m.result.content[0].text);
    expect(body).toMatchObject({ ...data, link: data.zip_url });
  });
});

