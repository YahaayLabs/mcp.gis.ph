# GIS.PH MCP Server

MCP (Model Context Protocol) server for [gis.ph](https://gis.ph) — the Philippines Geographic Information System API.

Deployed at **https://mcp.gis.ph**

---

## Tools

Tool parameters use the same names as the [api.gis.ph](https://api.gis.ph/reference) query params they map to.

| Tool | API route | Parameters |
|---|---|---|
| `get_regions` | `GET /v1/regions` | `search` (name, partial match), `format`, `geometry`, `limit`, `page` |
| `get_region` | `GET /v1/regions/{id}` | `region_code` (required), `format`, `geometry` |
| `get_provinces` | `GET /v1/provinces` | `region` (code or exact name), `extent`, `format`, `geometry`, `limit`, `page` |
| `get_province` | `GET /v1/provinces/{id}` | `province_code` (required), `extent`, `format`, `geometry` |
| `get_municities` | `GET /v1/municities` | **`province_code` or `province` required** (code preferred; name is exact, case-insensitive), `scope` (`geographic` default \| `admin`), `name` (starts-with), `format`, `geometry`, `limit`, `page` |
| `get_municity` | `GET /v1/municities/{id}` | `municity_code` (required), `format`, `geometry` |
| `get_barangays` | `GET /v1/barangays` | `municipality_code` (enough on its own), `municipality` (name, starts-with), `province_code`, `province` (exact name), `name` (barangay, starts-with), `format`, `geometry`, `limit`, `page`. `municity_code` is a deprecated alias of `municipality_code`. `format=geojson` needs `municipality_code` or `municipality`. |
| `get_barangay` | `GET /v1/barangays/{id}` | `barangay_code` (required), `format`, `geometry` |
| `search_municities` | `GET /v1/municities/search` | `q` (required, min 2 chars), `limit` (API default 20). Anonymous free-tier tool. |
| `search_barangays` | `GET /v1/barangays/search` | `q` (required, min 2 chars; tokens split on spaces/commas), `limit` (API default 20). Anonymous free-tier tool. |
| `search_regions_by_ids` | `POST /v1/regions/search` | **`ids` required** (not `codes`; max 100), `format`, `geometry`. Live API returns 401 without a key. |
| `search_provinces_by_codes` | `POST /v1/provinces/search` | **`codes` required** (max 100), `format`, `geometry`. Live API returns 401 without a key. |
| `search_municities_by_codes` | `POST /v1/municities/search` | **`codes` required** (max 1000), `format`, `geometry`. Live API returns 401 without a key. |
| `search_barangays_by_codes` | `POST /v1/barangays/search` | **`codes` required** (max 500), `format`, `geometry`. Live API returns 401 without a key. |
| `reverse_geocode` | `GET /v1/geocode/reverse` | **`lat` and `lng` required** (WGS84), `levels` (comma-separated: region,province,municity,barangay; default all), `geometry` (PIP resolution; API default simple). Signed-in, read-only; not anonymous. Later: OAuth `read:boundaries`. |
| `list_datasets` | `GET /v1/datasets` | `visibility` (`mine` default \| `private` \| `all` \| `public`), `include_features`, `limit`, `page` |
| `get_dataset` | `GET /v1/datasets/{id}` | `dataset_id` (required) |
| `create_dataset` | `POST /v1/datasets` | `name` (required), `description`, `data_type` (`vector` \| `raster` \| `data`), `geometry_type`, `srid` |
| `update_dataset` | `PATCH /v1/datasets/{id}` | `dataset_id` (required), `name`, `description` |
| `list_features` | `GET /v1/features` | — |
| `get_feature` | `GET /v1/features/{id}` | `feature_id` (required) |
| `get_features_by_dataset` | `GET /v1/features/dataset/{datasetId}` | `dataset_id` (required) |
| `create_feature` | `POST /v1/features` | `dataset_id` (required), `geometry` (GeoJSON), `properties` |

Shared options:

- `limit` 1-100 (default 100) and `page` (default 1). List tools return the api.gis.ph envelope; use `meta.total` and `meta.next` to fetch further pages.
- `format`: `json` (default) or `geojson` (bare GeoJSON FeatureCollection/Feature; geography lists are then unpaginated).
- `geometry`: `simple` \| `medium` \| `detailed`. Omitted by default, so JSON responses carry no boundaries.
- `extent` (provinces): `administrative` (API default, component LGUs only) or `geographic` (also HUC/ICC cities hosted by the province).
- **Response size:** tool results are compact JSON, capped at 1 MB by default (`MCP_MAX_RESPONSE_BYTES` in `wrangler.toml`). A larger result comes back as a summary instead of the data: `response_too_large: true`, its size, feature or row count, bbox, property names and hints for narrowing the request (`geometry=simple`, JSON without geometry, a smaller parent area, `limit`/`page`). This only applies to MCP; api.gis.ph REST responses (QGIS, apps) are unchanged.

Name search (`search_municities`, `search_barangays`) is in the anonymous free-tier set. Batch lookup by ids/codes requires a key: the live API returns 401 without one, even for `format=json` and omitted geometry. `reverse_geocode` is a signed-in, read-only tool (not anonymous); today it checks for a forwarded API key or Bearer, and later it will require the OAuth `read:boundaries` scope. There are no places, politicians or demographics tools yet.

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
