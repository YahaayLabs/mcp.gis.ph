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

The server holds no API key of its own: each client passes its gis.ph key per request
(`?key=YOUR_KEY` or the `x-api-key` header), and it is forwarded to api.gis.ph as a Bearer token.

### Deploy to mcp.gis.ph

```bash
pnpm deploy
```

---

## Connecting to Claude

### claude.ai / Claude Desktop (custom connector)

Add a custom connector with the URL `https://mcp.gis.ph/mcp?key=YOUR_KEY`.

### Claude Code (CLI)

```bash
claude mcp add --transport http gis-ph "https://mcp.gis.ph/mcp?key=YOUR_KEY"
```

---

## Endpoints

| Endpoint | Transport | Use |
|---|---|---|
| `https://mcp.gis.ph/mcp` | Streamable HTTP | All MCP clients (`?key=` or `x-api-key` required) |
| `https://mcp.gis.ph/` | JSON | Health check / tool list |
