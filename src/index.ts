import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import {
  BATCH_BARANGAY_CODES_MAX,
  BATCH_MUNICITY_CODES_MAX,
  BATCH_PROVINCE_CODES_MAX,
  BATCH_REGION_IDS_MAX,
  barangayParams,
  batchSearchBody,
  datasetListParams,
  downloadLinkParams,
  geoOutputParams,
  municityListParams,
  nameSearchParams,
  provinceGetParams,
  provinceListParams,
  regionListParams,
  reverseGeocodeParams,
} from "./params";
import {
  barangaysShape,
  dataTypeSchema,
  geoOutputShape,
  listDatasetsShape,
  municitiesInput,
  nameSearchShape,
  provinceShape,
  provincesShape,
  regionsShape,
  searchBarangaysByCodesShape,
  searchMunicitiesByCodesShape,
  searchProvincesByCodesShape,
  searchRegionsByIdsShape,
  reverseGeocodeShape,
  downloadLinkShape,
} from "./schemas";
import { handleMcp, registerAuthRoutes, discoveryAuth, type UpstreamAuth } from "./http";
import { config, type McpEnv } from "./config";
import { DEFAULT_MAX_RESPONSE_BYTES, toolResult } from "./response-budget";
import { trackTools, ANONYMOUS_TOOLS, SIGNED_IN_TOOLS } from "./tool-policy";
import { upstreamParams } from "./auth";

export interface Env extends McpEnv {
  MCP_OBJECT: DurableObjectNamespace;
}

/** `apiKey` is the resolved upstream credential (API key, OAuth user or anonymous); see src/auth.ts. */
async function gisApi(
  path: string,
  apiKey: UpstreamAuth,
  options?: { params?: Record<string, string>; method?: string; body?: unknown }
): Promise<unknown> {
  const url = new URL(apiKey.baseUrl + path);
  const params = upstreamParams(apiKey, options?.params);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url.toString(), {
    method: options?.method ?? "GET",
    headers: {
      ...apiKey.headers,
      "Content-Type": "application/json",
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`gis.ph API error ${response.status}: ${error}`);
  }
  return response.json();
}

function buildMcpServer(apiKey: UpstreamAuth, maxResponseBytes: number = DEFAULT_MAX_RESPONSE_BYTES): McpServer {
  const server = new McpServer({ name: "gis-ph", version: "1.0.0" });
  /** Compact JSON, or a summary with hints when over the MCP response budget (src/response-budget.ts). */
  const json = (data: unknown) => toolResult(data, maxResponseBytes);
  const tools = trackTools(server);

  // ── Regions ────────────────────────────────────────────────────────────
  server.tool(
    "get_regions",
    "Get all regions in the Philippines (paginated, default limit 100 so they fit on one page)",
    regionsShape,
    async (input) => json(await gisApi("/regions", apiKey, { params: regionListParams(input) }))
  );

  server.tool(
    "get_region",
    "Get details of a specific region by its code",
    { region_code: z.string().describe("Region PSGC code"), ...geoOutputShape },
    async ({ region_code, ...rest }) =>
      json(await gisApi(`/regions/${encodeURIComponent(region_code)}`, apiKey, { params: geoOutputParams(rest) }))
  );

  // ── Provinces ──────────────────────────────────────────────────────────
  server.tool(
    "get_provinces",
    "Get provinces, optionally filtered by region (paginated; response meta has total and next page)",
    provincesShape,
    async (input) => json(await gisApi("/provinces", apiKey, { params: provinceListParams(input) }))
  );

  server.tool(
    "get_province",
    "Get details of a specific province by its PSGC code",
    provinceShape,
    async ({ province_code, ...rest }) =>
      json(await gisApi(`/provinces/${encodeURIComponent(province_code)}`, apiKey, { params: provinceGetParams(rest) }))
  );

  // ── Municities ─────────────────────────────────────────────────────────
  // registerTool (not tool()) so a Zod union is accepted and advertised in tools/list.
  server.registerTool(
    "get_municities",
    {
      description: "Get cities and municipalities in a province. Requires province_code (preferred) or province (exact name). Paginated; response meta has total and next page",
      inputSchema: municitiesInput,
    },
    async (input) => json(await gisApi("/municities", apiKey, { params: municityListParams(input) })),
  );

  server.tool(
    "get_municity",
    "Get details of a specific city or municipality by its PSGC code",
    { municity_code: z.string().describe("City or municipality PSGC code"), ...geoOutputShape },
    async ({ municity_code, ...rest }) =>
      json(await gisApi(`/municities/${encodeURIComponent(municity_code)}`, apiKey, { params: geoOutputParams(rest) }))
  );

  // ── Barangays ──────────────────────────────────────────────────────────
  server.tool(
    "get_barangays",
    "Get barangays filtered by city/municipality and/or province (paginated; response meta has total and next page). municipality_code alone is enough.",
    barangaysShape,
    async (input) => json(await gisApi("/barangays", apiKey, { params: barangayParams(input) }))
  );

  server.tool(
    "get_barangay",
    "Get details of a specific barangay by its PSGC code",
    { barangay_code: z.string().describe("Barangay PSGC code"), ...geoOutputShape },
    async ({ barangay_code, ...rest }) =>
      json(await gisApi(`/barangays/${encodeURIComponent(barangay_code)}`, apiKey, { params: geoOutputParams(rest) }))
  );

  // ── Name search (anonymous free-tier JSON) ─────────────────────────────
  server.tool(
    "search_municities",
    "Search cities and municipalities by name across all provinces (GET /v1/municities/search). Anonymous free-tier tool.",
    nameSearchShape,
    async (input) => json(await gisApi("/municities/search", apiKey, { params: nameSearchParams(input) })),
  );

  server.tool(
    "search_barangays",
    "Search barangays by name across all provinces (GET /v1/barangays/search). Multi-word queries are tokenized on spaces and commas; every token must match. Anonymous free-tier tool.",
    nameSearchShape,
    async (input) => json(await gisApi("/barangays/search", apiKey, { params: nameSearchParams(input) })),
  );


  // ── Batch lookup by ids/codes (API requires a key; 401 anonymously) ────
  server.tool(
    "search_regions_by_ids",
    "Look up regions by ID in one request (POST /v1/regions/search). The body uses `ids`, not `codes`. Max 100. The live API requires a key (401 without one), which /mcp already forwards.",
    searchRegionsByIdsShape,
    async (input) =>
      json(await gisApi("/regions/search", apiKey, {
        method: "POST",
        body: batchSearchBody("ids", input.ids, BATCH_REGION_IDS_MAX, "id", input),
      })),
  );

  server.tool(
    "search_provinces_by_codes",
    "Look up provinces by PSGC code in one request (POST /v1/provinces/search). Max 100 codes. The live API requires a key (401 without one), which /mcp already forwards.",
    searchProvincesByCodesShape,
    async (input) =>
      json(await gisApi("/provinces/search", apiKey, {
        method: "POST",
        body: batchSearchBody("codes", input.codes, BATCH_PROVINCE_CODES_MAX, "code", input),
      })),
  );

  server.tool(
    "search_municities_by_codes",
    "Look up cities and municipalities by PSGC code in one request (POST /v1/municities/search). Max 1000 codes. The live API requires a key (401 without one), which /mcp already forwards.",
    searchMunicitiesByCodesShape,
    async (input) =>
      json(await gisApi("/municities/search", apiKey, {
        method: "POST",
        body: batchSearchBody("codes", input.codes, BATCH_MUNICITY_CODES_MAX, "code", input),
      })),
  );

  server.tool(
    "search_barangays_by_codes",
    "Look up barangays by PSGC code in one request (POST /v1/barangays/search). Max 500 codes. The live API requires a key (401 without one), which /mcp already forwards.",
    searchBarangaysByCodesShape,
    async (input) =>
      json(await gisApi("/barangays/search", apiKey, {
        method: "POST",
        body: batchSearchBody("codes", input.codes, BATCH_BARANGAY_CODES_MAX, "code", input),
      })),
  );


  // ── Reverse geocode (signed-in, read-only) ─────────────────────────────
  server.tool(
    "reverse_geocode",
    "Reverse geocode a WGS84 point to the admin hierarchy (GET /v1/geocode/reverse). Signed-in, read-only; not anonymous. Requires OAuth or an API key (read:boundaries on the API).",
    reverseGeocodeShape,
    async (input) => json(await gisApi("/geocode/reverse", apiKey, { params: reverseGeocodeParams(input) })),
  );

  // ── Download links (signed-in) ─────────────────────────────────────────
  server.tool(
    "get_download_link",
    "Get a short-lived download link (15 minutes) for boundary GeoJSON that is too large to return here " +
      "(GET /v1/downloads/link). Takes the same filters as the list tools; for a city or municipality with its barangays, use resource=municities, id and barangays=true. Returns url (plain .geojson), " +
      "zip_url, bytes, feature_count and bbox. Give the link to the user; QGIS can open the url directly. Signed-in only.",
    downloadLinkShape,
    async (input) => {
      const res = (await gisApi("/downloads/link", apiKey, { params: downloadLinkParams(input) })) as {
        data?: Record<string, unknown> & { url?: string; zip_url?: string };
      };
      const data = res?.data ?? {};
      return json({ ...data, link: input.zip ? data.zip_url : data.url });
    },
  );

  // ── Datasets ───────────────────────────────────────────────────────────
  server.tool(
    "list_datasets",
    "List datasets (yours by default; see visibility), optionally including their features. Paginated",
    listDatasetsShape,
    async (input) => json(await gisApi("/datasets", apiKey, { params: datasetListParams(input) }))
  );

  server.tool(
    "get_dataset",
    "Get a single dataset by its ID",
    { dataset_id: z.string().describe("Dataset UUID") },
    async ({ dataset_id }) => json(await gisApi(`/datasets/${encodeURIComponent(dataset_id)}`, apiKey))
  );

  server.tool(
    "create_dataset",
    "Create a new dataset",
    {
      name: z.string().describe("Dataset name"),
      description: z.string().optional().describe("Dataset description"),
      data_type: dataTypeSchema.optional().describe("Data type: vector, raster or data"),
      geometry_type: z.enum(["POINT", "LINESTRING", "POLYGON", "MULTIPOINT", "MULTILINESTRING", "MULTIPOLYGON"]).optional().describe("Geometry type"),
      srid: z.number().optional().describe("Spatial reference ID, default 4326"),
    },
    async ({ name, description, data_type, geometry_type, srid }) => {
      const body: Record<string, unknown> = { name };
      if (description) body.description = description;
      if (data_type) body.data_type = data_type;
      if (geometry_type) body.geometry_type = geometry_type;
      if (srid) body.srid = srid;
      return json(await gisApi("/datasets", apiKey, { method: "POST", body }));
    }
  );

  server.tool(
    "update_dataset",
    "Update an existing dataset",
    {
      dataset_id: z.string().describe("Dataset UUID"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
    },
    async ({ dataset_id, name, description }) => {
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (description) body.description = description;
      return json(await gisApi(`/datasets/${encodeURIComponent(dataset_id)}`, apiKey, { method: "PATCH", body }));
    }
  );

  // ── Features ───────────────────────────────────────────────────────────
  server.tool("list_features", "List all features", {}, async () => json(await gisApi("/features", apiKey)));

  server.tool(
    "get_feature",
    "Get a single feature by its ID",
    { feature_id: z.string().describe("Feature ID") },
    async ({ feature_id }) => json(await gisApi(`/features/${encodeURIComponent(feature_id)}`, apiKey))
  );

  server.tool(
    "get_features_by_dataset",
    "Get all features belonging to a dataset",
    { dataset_id: z.string().describe("Dataset UUID") },
    async ({ dataset_id }) => json(await gisApi(`/features/dataset/${encodeURIComponent(dataset_id)}`, apiKey))
  );

  server.tool(
    "create_feature",
    "Create a new feature in a dataset",
    {
      dataset_id: z.string().describe("Dataset UUID"),
      geometry: z.object({
        type: z.string().describe("GeoJSON geometry type e.g. Point, Polygon"),
        coordinates: z.array(z.unknown()).describe("GeoJSON coordinates"),
      }).describe("GeoJSON geometry object"),
      properties: z.record(z.unknown()).optional().describe("Feature properties as key-value pairs"),
    },
    async ({ dataset_id, geometry, properties }) => {
      const body: Record<string, unknown> = { dataset_id, geometry };
      if (properties) body.properties = properties;
      return json(await gisApi("/features", apiKey, { method: "POST", body }));
    }
  );

  tools.apply();
  return server;
}

const app = new Hono<{ Bindings: Env }>();

registerAuthRoutes(app);

app.get("/", (c) =>
  c.json({
    name: "gis.ph MCP Server",
    version: "1.0.0",
    ...discoveryAuth(c.env),
    tools: { anonymous: ANONYMOUS_TOOLS, signed_in: SIGNED_IN_TOOLS },
  })
);

app.all("/mcp", (c) =>
  handleMcp(c, async (upstream) => {
    const server = buildMcpServer(upstream, config(c.env).maxResponseBytes);
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(c);
  })
);

export default app;
