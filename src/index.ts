import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import {
  barangayParams,
  datasetListParams,
  geoOutputParams,
  municityListParams,
  provinceGetParams,
  provinceListParams,
  regionListParams,
} from "./params";
import {
  barangaysShape,
  dataTypeSchema,
  geoOutputShape,
  listDatasetsShape,
  municitiesInput,
  provinceShape,
  provincesShape,
  regionsShape,
} from "./schemas";

export interface Env {
  MCP_OBJECT: DurableObjectNamespace;
}

const BASE_URL = "https://api.gis.ph/v1";

async function gisApi(
  path: string,
  apiKey: string,
  options?: { params?: Record<string, string>; method?: string; body?: unknown }
): Promise<unknown> {
  const url = new URL(BASE_URL + path);
  if (options?.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url.toString(), {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function buildMcpServer(apiKey: string): McpServer {
  const server = new McpServer({ name: "gis-ph", version: "1.0.0" });

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

  return server;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) =>
  c.json({
    name: "gis.ph MCP Server",
    version: "1.0.0",
    auth: "Pass your gis.ph API key via ?key= query param or x-api-key header",
    endpoint: "https://mcp.gis.ph/mcp?key=YOUR_KEY",
    tools: [
      "get_regions", "get_region",
      "get_provinces", "get_province",
      "get_municities", "get_municity",
      "get_barangays", "get_barangay",
      "list_datasets", "get_dataset", "create_dataset", "update_dataset",
      "list_features", "get_feature", "get_features_by_dataset", "create_feature",
    ],
  })
);

app.all("/mcp", async (c) => {
  const apiKey = c.req.query("key") ?? c.req.header("x-api-key") ?? "";

  if (!apiKey) {
    return c.json({ error: "Missing API key. Add ?key=YOUR_KEY to the URL." }, 401);
  }

  const server = buildMcpServer(apiKey);
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

export default app;