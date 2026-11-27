# GIS.PH MCP Server

MCP (Model Context Protocol) server for [gis.ph](https://gis.ph) — the Philippines Geographic Information System API.

Deployed at **https://mcp.gis.ph**

---

## Tools

| Tool | Description |
|---|---|
| `get_regions` / `get_region` | All regions / one region by code |
| `get_provinces` | Provinces (paginated: `limit` 1-100, default 100; `page`) |
| `get_province` | Single province by code |
| `get_municities` | Cities/municipalities, filterable by `province_code` (paginated) |
| `get_municity` | Single city/municipality by code |
| `get_barangays` | Barangays by `municipality_code` and/or `province_code` (paginated). Province is looked up from the city when omitted. `municity_code` is accepted as a deprecated alias. |
| `get_barangay` | Single barangay by code |
| `list_datasets` / `get_dataset` / `create_dataset` / `update_dataset` | Your gis.ph datasets |
| `list_features` / `get_feature` / `get_features_by_dataset` / `create_feature` | Features in your datasets |

List tools return the api.gis.ph envelope; use `meta.total` and `meta.next` to fetch further pages.
There are no search, reverse-geocode or demographics tools yet.

---|---|
| `get_provinces` | All 81 provinces |
| `get_province` | Single province by code |
| `get_cities` | Cities/municipalities, filterable by province |
| `get_city` | Single city by code |
| `get_barangays` | Barangays, filterable by city or province |
| `get_barangay` | Single barangay by code |
| `search_location` | Search any location by name |
| `reverse_geocode` | Find location from lat/lng coordinates |
| `get_demographics` | Population and demographic data |

---

## Development

### Prerequisites
- Node.js 18+
- Cloudflare account with Workers enabled
- gis.ph API key

### Setup

```bash
pnpm install
pnpm test        # unit tests (vitest)
pnpm typecheck   # tsc --noEmit
```

### Local dev

```bash
pnpm dev   # wrangler dev
```

## Authentication

`/mcp` is an OAuth 2.1 protected resource (RFC 9728). The authorization server is
api.gis.ph; sign-in and consent happen on dashboard.gis.ph with your gis.ph account.

| Caller | How | What works |
|---|---|---|
| Signed in (OAuth) | `Authorization: Bearer <access token>` from api.gis.ph | All read-only tools, 300 rpm per user |
| API key | `x-api-key: gis_sk_…` or `Authorization: Bearer gis_sk_…` | Read-only tools under the key's own limits and scopes |
| Anonymous | No credential | Boundary metadata tools only (regions, provinces, municities, barangays), JSON without geometry, 30 rpm per client |

- **`?key=` in the URL is no longer accepted** (returns 401). Keys in URLs leak into logs and connector settings.
- Write tools (`create_dataset`, `update_dataset`, `create_feature`) are disabled for this launch.
- Anonymous calls to a signed-in tool get `401` with `WWW-Authenticate: Bearer realm="gisph", resource_metadata="…", scope="mcp"`, which starts the client's OAuth flow. An invalid or expired token adds `error="invalid_token"`.
- Protected-resource metadata: `/.well-known/oauth-protected-resource` (and `/.well-known/oauth-protected-resource/mcp`).
- OAuth users and anonymous callers reach api.gis.ph with the dedicated MCP service key plus the user's Clerk id (or an opaque per-client key, an HMAC of the client IP; the raw IP is never sent). The MCP access token is never forwarded upstream and no `gis_sk_` keys are minted.
- Revoking a sign-in on api.gis.ph stops refresh immediately; an already-issued access token keeps working until it expires (1 h by default), because this Worker does not share the refresh store.

### Configuration

Non-secret values are `[vars]` in `wrangler.toml` (`MCP_OAUTH_ISSUER`, `MCP_OAUTH_AUDIENCE`,
`MCP_PUBLIC_BASE`, `GISPH_API_BASE`). Secrets, set with `wrangler secret put` and never committed:

- `MCP_OAUTH_SECRET`: same value as on api.gis.ph (HS256, at least 32 characters). Without it, OAuth tokens are rejected.
- `GISPH_MCP_SERVICE_KEY`: same value as on api.gis.ph. Without it, OAuth tokens are rejected and anonymous calls return 503; API keys still work.

This release must ship together with the api.gis.ph authorization server (api.gis.ph#194, #195) and the dashboard consent page (dashboard.gis.ph#63).

### Deploy to mcp.gis.ph

```bash
pnpm deploy
```

---

## Connecting to Claude

### claude.ai / Claude Desktop (custom connector)

Add a custom connector with the URL `https://mcp.gis.ph/mcp` and sign in with your gis.ph account when prompted.

### Claude Code (CLI)

```bash
claude mcp add --transport http gis-ph https://mcp.gis.ph/mcp            # OAuth sign-in (/mcp in Claude Code)
claude mcp add --transport http gis-ph https://mcp.gis.ph/mcp --header "x-api-key: YOUR_KEY"   # or an API key
```

---

## Endpoints

| Endpoint | Transport | Use |
|---|---|---|
| `https://mcp.gis.ph/mcp` | Streamable HTTP | All MCP clients (OAuth, API key header, or anonymous boundary tools) |
| `https://mcp.gis.ph/` | JSON | Health check / tool list |
| `https://mcp.gis.ph/.well-known/oauth-protected-resource` | JSON | OAuth protected-resource metadata |
