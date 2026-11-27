import { z } from "zod";
import {
  DATASET_DATA_TYPES,
  DATASET_VISIBILITIES,
  FORMATS,
  GEOMETRY_LEVELS,
  MAX_LIST_LIMIT,
  MUNICITY_PARENT_REQUIRED,
  MUNICITY_SCOPES,
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
    .describe("Boundary resolution. With json, omit to exclude geometry; with geojson, defaults to 'simple'"),
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

export const municitiesShape = {
  province_code: z.string().optional()
    .describe("Province PSGC code (preferred). Required unless province is given; wins if both are set"),
  province: z.string().optional()
    .describe("Exact province name, case-insensitive. Required unless province_code is given"),
  scope: z.enum(MUNICITY_SCOPES).optional().describe(
    "'geographic' (API default) includes HUC/ICC cities hosted in the province; 'admin' only LGUs whose admin parent is the province"
  ),
  name: z.string().optional().describe("City/municipality name, starts-with match"),
  ...geoOutputShape,
  ...pagingShape,
};

/** GET /v1/municities requires province_code and/or province. */
export const municitiesInput = z
  .object(municitiesShape)
  .refine(hasMunicityParent, { message: MUNICITY_PARENT_REQUIRED, path: ["province_code"] });

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
