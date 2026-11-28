import { z } from "zod";
import {
  BATCH_BARANGAY_CODES_MAX,
  BATCH_MUNICITY_CODES_MAX,
  BATCH_PROVINCE_CODES_MAX,
  BATCH_REGION_IDS_MAX,
  DATASET_DATA_TYPES,
  DATASET_VISIBILITIES,
  FORMATS,
  GEOMETRY_LEVELS,
  MAX_LIST_LIMIT,
  MUNICITY_PARENT_REQUIRED,
  MUNICITY_SCOPES,
  NAME_SEARCH_Q_MIN,
  PROVINCE_EXTENTS,
  hasMunicityParent,
} from "./params";

/** MCP tool input shapes. Names match the api.gis.ph query params they are sent as. */

export const pagingShape = {
  limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional()
    .describe("Rows per page, 1-100 (default 100). Check meta.total and meta.next for more pages."),
  page: z.number().int().min(1).optional().describe("Page number, starting at 1 (default 1)"),
};

export const geoOutputShape = {
  format: z.enum(FORMATS).optional()
    .describe("Response format: 'json' (default, { data, meta, error } envelope) or 'geojson' (bare GeoJSON)"),
  geometry: z.enum(GEOMETRY_LEVELS).optional()
    .describe("Boundary resolution. With json, omit to exclude geometry; with geojson, defaults to 'simple'. Prefer 'simple': results over the MCP size limit (1 MB by default) come back as a summary instead of data"),
};

export const regionsShape = {
  search: z.string().optional().describe("Filter regions by name (case-insensitive partial match)"),
  ...geoOutputShape,
  ...pagingShape,
};

const extentShape = {
  extent: z.enum(PROVINCE_EXTENTS).optional().describe(
    "'administrative' (API default): component LGUs only. 'geographic': also HUC/ICC cities hosted by the province"
  ),
};

export const provincesShape = {
  region: z.string().optional().describe("Filter by parent region code or exact region name"),
  ...extentShape,
  ...geoOutputShape,
  ...pagingShape,
};

export const provinceShape = {
  province_code: z.string().describe("Province PSGC code e.g. '0702200000'"),
  ...extentShape,
  ...geoOutputShape,
};

const municityFilters = {
  scope: z.enum(MUNICITY_SCOPES).optional().describe(
    "'geographic' (API default) includes HUC/ICC cities hosted in the province; 'admin' only LGUs whose admin parent is the province"
  ),
  name: z.string().optional().describe("City/municipality name, starts-with match"),
  ...geoOutputShape,
  ...pagingShape,
};

/** Shared shape for docs and for the SDK advertisement helper below. */
export const municitiesShape = {
  province_code: z.string().optional()
    .describe("Province PSGC code (preferred). Required unless province is given; wins if both are set"),
  province: z.string().optional()
    .describe("Exact province name, case-insensitive. Required unless province_code is given"),
  ...municityFilters,
};

/**
 * The MCP SDK's tools/list only advertises schemas that look like a Zod object
 * (`normalizeObjectSchema` requires `.shape`). Unions and `.refine()` effects
 * would otherwise be published as an empty object. Tag the schema with the
 * shared property shape so the union's anyOf (required province_code | province)
 * is what clients see.
 */
function advertiseMcpObjectSchema<T extends z.ZodTypeAny>(schema: T, shape: Record<string, z.ZodTypeAny>): T {
  if (!("shape" in schema) || (schema as { shape?: unknown }).shape === undefined) {
    Object.defineProperty(schema, "shape", { value: shape, enumerable: false });
  }
  return schema;
}

const municitiesByCode = z.object({
  province_code: z.string().describe("Province PSGC code (preferred). Wins if both province_code and province are set"),
  province: z.string().optional().describe("Exact province name, case-insensitive"),
  ...municityFilters,
});

const municitiesByName = z.object({
  province: z.string().describe("Exact province name, case-insensitive. Use this when province_code is not available"),
  province_code: z.string().optional().describe("Province PSGC code (preferred when known; wins if both are set)"),
  ...municityFilters,
});

/** GET /v1/municities requires province_code and/or province. Advertised as a JSON Schema anyOf. */
export const municitiesInput = advertiseMcpObjectSchema(
  z.union([municitiesByCode, municitiesByName]).describe(MUNICITY_PARENT_REQUIRED),
  municitiesShape,
);

export const barangaysShape = {
  municipality_code: z.string().optional()
    .describe("City/municipality PSGC code (preferred). Enough on its own: the API derives the province"),
  municity_code: z.string().optional().describe("Deprecated alias of municipality_code"),
  municipality: z.string().optional().describe("City/municipality name, starts-with match"),
  province_code: z.string().optional().describe("Province PSGC code (preferred over province)"),
  province: z.string().optional().describe("Exact province name, case-insensitive"),
  name: z.string().optional().describe("Barangay name, starts-with match"),
  ...geoOutputShape,
  ...pagingShape,
};

export const listDatasetsShape = {
  include_features: z.boolean().optional().describe("Include features in each dataset"),
  visibility: z.enum(DATASET_VISIBILITIES).optional().describe(
    "'mine' (default): your datasets; 'private': your non-public ones; 'all': yours plus every public dataset; 'public': public catalog only"
  ),
  ...pagingShape,
};

export const dataTypeSchema = z.enum(DATASET_DATA_TYPES);

export const nameSearchShape = {
  q: z.string().trim().min(NAME_SEARCH_Q_MIN)
    .describe("Search query (min 2 characters). For barangays, spaces and commas split tokens and every token must match."),
  limit: z.number().int().min(1).optional()
    .describe("Max results to return (API default 20)"),
};

export const searchRegionsByIdsShape = {
  ids: z.array(z.string().trim().min(1)).min(1).max(BATCH_REGION_IDS_MAX)
    .describe("Region identifiers (PSGC codes). This endpoint uses `ids`, not `codes`. Max 100."),
  ...geoOutputShape,
};

export const searchProvincesByCodesShape = {
  codes: z.array(z.string().trim().min(1)).min(1).max(BATCH_PROVINCE_CODES_MAX)
    .describe("Province PSGC codes. Max 100."),
  ...geoOutputShape,
};

export const searchMunicitiesByCodesShape = {
  codes: z.array(z.string().trim().min(1)).min(1).max(BATCH_MUNICITY_CODES_MAX)
    .describe("City/municipality PSGC codes. Max 1000."),
  ...geoOutputShape,
};

export const searchBarangaysByCodesShape = {
  codes: z.array(z.string().trim().min(1)).min(1).max(BATCH_BARANGAY_CODES_MAX)
    .describe("Barangay PSGC codes. Max 500."),
  ...geoOutputShape,
};

export const reverseGeocodeShape = {
  lat: z.number().min(-90).max(90).describe("WGS84 latitude"),
  lng: z.number().min(-180).max(180).describe("WGS84 longitude"),
  levels: z.string().optional().describe(
    "Comma-separated admin levels to return: region, province, municity, barangay. Default: all levels.",
  ),
  geometry: z.enum(GEOMETRY_LEVELS).optional().describe(
    "Boundary resolution used for point-in-polygon (simple is fastest; API default simple)",
  ),
};

