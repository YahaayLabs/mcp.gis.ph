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
