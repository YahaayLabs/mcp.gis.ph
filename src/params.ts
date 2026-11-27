/**
 * Query-param builders for api.gis.ph. Kept free of network calls so the exact
 * query names sent to the API are unit-tested (see test/params.test.ts).
 * Contract: https://api.gis.ph/doc
 */

/** Default and max page size sent to api.gis.ph list endpoints (API default is 10, max 100). */
export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 100;

export const FORMATS = ["json", "geojson"] as const;
export const GEOMETRY_LEVELS = ["simple", "medium", "detailed"] as const;
export const PROVINCE_EXTENTS = ["administrative", "geographic"] as const;
export const MUNICITY_SCOPES = ["geographic", "admin"] as const;
export const DATASET_VISIBILITIES = ["public", "private", "all", "mine"] as const;
export const DATASET_DATA_TYPES = ["vector", "raster", "data"] as const;

export type Format = (typeof FORMATS)[number];
export type GeometryLevel = (typeof GEOMETRY_LEVELS)[number];

type Params = Record<string, string>;

/** Copy only the keys whose value is a non-empty string. */
function defined(input: Record<string, string | undefined>): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(input)) if (v) out[k] = v;
  return out;
}

export interface PagingInput {
  limit?: number;
  page?: number;
}

/** Paging params for api.gis.ph. Always sends a limit so lists are not cut at the API default of 10. */
export function pagingParams({ limit, page }: PagingInput): Params {
  const l = Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
  const p = Math.max(Math.trunc(page ?? 1), 1);
  return { limit: String(l), page: String(p) };
}

export interface GeoOutputInput {
  format?: Format;
  geometry?: GeometryLevel;
}

/**
 * `format` / `geometry` for geography routes. Only sent when the caller set them, so the
 * default stays plain JSON without geometry. Never sends the deprecated `output` alias.
 */
export function geoOutputParams({ format, geometry }: GeoOutputInput): Params {
  return defined({ format, geometry });
}

export interface RegionListInput extends PagingInput, GeoOutputInput {
  search?: string;
}

/** GET /v1/regions */
export function regionListParams(input: RegionListInput): Params {
  return { ...pagingParams(input), ...geoOutputParams(input), ...defined({ search: input.search }) };
}

export interface ProvinceGetInput extends GeoOutputInput {
  extent?: (typeof PROVINCE_EXTENTS)[number];
}

/** GET /v1/provinces/{id}. Uses `extent`, not the `scope` alias. */
export function provinceGetParams(input: ProvinceGetInput): Params {
  return { ...geoOutputParams(input), ...defined({ extent: input.extent }) };
}

export interface ProvinceListInput extends PagingInput, ProvinceGetInput {
  /** Region code or exact region name. */
  region?: string;
}

/** GET /v1/provinces */
export function provinceListParams(input: ProvinceListInput): Params {
  return { ...pagingParams(input), ...provinceGetParams(input), ...defined({ region: input.region }) };
}

export interface MunicityListInput extends PagingInput, GeoOutputInput {
  /** Province PSGC code (preferred; the API uses it over `province` when both are set). */
  province_code?: string;
  /** Exact province name, case-insensitive. */
  province?: string;
  scope?: (typeof MUNICITY_SCOPES)[number];
  /** City/municipality name, starts-with. */
  name?: string;
}

export const MUNICITY_PARENT_REQUIRED =
  "get_municities needs a parent province: pass province_code (PSGC, preferred) or province (exact name).";

/** True when a municities query names a parent province, as GET /v1/municities requires. */
export function hasMunicityParent(input: Pick<MunicityListInput, "province" | "province_code">): boolean {
  return Boolean(input.province_code?.trim() || input.province?.trim());
}

/**
 * GET /v1/municities. Requires `province_code` and/or `province`; each is sent under its
 * own name exactly as given (a name is never turned into a code, or vice versa).
 */
export function municityListParams(input: MunicityListInput): Params {
  if (!hasMunicityParent(input)) throw new Error(MUNICITY_PARENT_REQUIRED);
  return {
    ...pagingParams(input),
    ...geoOutputParams(input),
    ...defined({
      province_code: input.province_code?.trim(),
      province: input.province?.trim(),
      scope: input.scope,
      name: input.name,
    }),
  };
}

export interface BarangayFilterInput extends PagingInput, GeoOutputInput {
  /** City/municipality PSGC code (preferred). */
  municipality_code?: string;
  /** Deprecated tool input kept for existing callers; sent to the API as `municipality_code`. */
  municity_code?: string;
  /** City/municipality name, starts-with. */
  municipality?: string;
  province_code?: string;
  /** Exact province name, case-insensitive. */
  province?: string;
  /** Barangay name, starts-with. */
  name?: string;
}

export const BARANGAY_GEOJSON_NEEDS_MUNICIPALITY =
  "get_barangays with format=geojson needs municipality_code or municipality.";

/**
 * GET /v1/barangays. The API rejects unknown query params with 400, so only documented
 * names are sent. The legacy `municity_code` input is sent as `municipality_code`
 * (which wins if both are given). `municipality_code` alone is enough: the API derives
 * the province from it.
 */
export function barangayParams(input: BarangayFilterInput): Params {
  const municipality_code = input.municipality_code ?? input.municity_code;
  if (input.format === "geojson" && !municipality_code && !input.municipality) {
    throw new Error(BARANGAY_GEOJSON_NEEDS_MUNICIPALITY);
  }
  return {
    ...pagingParams(input),
    ...geoOutputParams(input),
    ...defined({
      municipality_code,
      municipality: input.municipality,
      province_code: input.province_code,
      province: input.province,
      name: input.name,
    }),
  };
}

export interface DatasetListInput extends PagingInput {
  include_features?: boolean;
  visibility?: (typeof DATASET_VISIBILITIES)[number];
}

/** GET /v1/datasets. `include_features` maps to the API's camelCase `includeFeatures`. */
export function datasetListParams(input: DatasetListInput): Params {
  return {
    ...pagingParams(input),
    ...defined({ includeFeatures: input.include_features ? "true" : undefined, visibility: input.visibility }),
  };
}

export const NAME_SEARCH_Q_MIN = 2;
export const NAME_SEARCH_Q_REQUIRED = "q must be at least 2 characters.";

export interface NameSearchInput {
  q: string;
  limit?: number;
}

/**
 * Query params for GET /v1/municities/search and GET /v1/barangays/search.
 * `q` is required (min 2 chars). `limit` is sent only when the caller sets it,
 * so the API default (20) applies otherwise. No invented max.
 */
export function nameSearchParams(input: NameSearchInput): Params {
  const q = input.q?.trim() ?? "";
  if (q.length < NAME_SEARCH_Q_MIN) throw new Error(NAME_SEARCH_Q_REQUIRED);
  const params: Params = { q };
  if (input.limit !== undefined) {
    const n = Math.max(Math.trunc(input.limit), 1);
    params.limit = String(n);
  }
  return params;
}

export const BATCH_LIST_MIN = 1;
/** POST /v1/regions/search `ids` max. */
export const BATCH_REGION_IDS_MAX = 100;
/** POST /v1/provinces/search `codes` max. */
export const BATCH_PROVINCE_CODES_MAX = 100;
/** POST /v1/municities/search `codes` max. */
export const BATCH_MUNICITY_CODES_MAX = 1000;
/** POST /v1/barangays/search `codes` max. */
export const BATCH_BARANGAY_CODES_MAX = 500;

export function batchListEmptyMessage(noun: string): string {
  return `Provide at least ${BATCH_LIST_MIN} non-empty ${noun}.`;
}

export function batchListMaxMessage(noun: string, max: number): string {
  return `At most ${max} ${noun}s are allowed.`;
}

export function batchListItemMessage(noun: string): string {
  return `Each ${noun} must be a non-empty string.`;
}

/**
 * Trim and validate a batch of ids or codes. Empty items are rejected, not dropped.
 */
export function normalizeBatchList(values: string[] | undefined, max: number, noun: string): string[] {
  const list: string[] = [];
  for (const v of values ?? []) {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) throw new Error(batchListItemMessage(noun));
    list.push(s);
  }
  if (list.length < BATCH_LIST_MIN) throw new Error(batchListEmptyMessage(noun));
  if (list.length > max) throw new Error(batchListMaxMessage(noun, max));
  return list;
}

export interface BatchSearchInput extends GeoOutputInput {
  ids?: string[];
  codes?: string[];
}

/**
 * JSON body for POST /v1/{regions,provinces,municities,barangays}/search.
 * Regions use `ids` (not `codes`). format and geometry are sent only when set.
 * Never sends the deprecated `output` alias. The live API returns 401 without a key,
 * even for format=json and omitted geometry.
 */
export function batchSearchBody(
  field: "ids" | "codes",
  values: string[] | undefined,
  max: number,
  noun: string,
  output: GeoOutputInput = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = { [field]: normalizeBatchList(values, max, noun) };
  if (output.format) body.format = output.format;
  if (output.geometry) body.geometry = output.geometry;
  return body;
}

export const REVERSE_GEOCODE_LEVELS = ["region", "province", "municity", "barangay"] as const;
export type ReverseGeocodeLevel = (typeof REVERSE_GEOCODE_LEVELS)[number];

export const REVERSE_GEOCODE_LATLNG_REQUIRED = "reverse_geocode requires lat and lng.";
export const REVERSE_GEOCODE_LAT_RANGE = "lat must be between -90 and 90.";
export const REVERSE_GEOCODE_LNG_RANGE = "lng must be between -180 and 180.";
export const REVERSE_GEOCODE_LEVELS_INVALID =
  "levels must be a comma-separated list of region, province, municity, barangay.";

export interface ReverseGeocodeInput {
  lat: number;
  lng: number;
  /** Comma-separated: region,province,municity,barangay. Omit for all levels. */
  levels?: string;
  /** PIP boundary resolution; API default is simple. */
  geometry?: GeometryLevel;
}

/**
 * Query params for GET /v1/geocode/reverse.
 * lat and lng are required in the MCP tool (OpenAPI leaves them optional).
 * levels and geometry are sent only when set. There is no `format` or `output` param.
 */
export function reverseGeocodeParams(input: ReverseGeocodeInput): Params {
  if (typeof input.lat !== "number" || Number.isNaN(input.lat) || typeof input.lng !== "number" || Number.isNaN(input.lng)) {
    throw new Error(REVERSE_GEOCODE_LATLNG_REQUIRED);
  }
  if (input.lat < -90 || input.lat > 90) throw new Error(REVERSE_GEOCODE_LAT_RANGE);
  if (input.lng < -180 || input.lng > 180) throw new Error(REVERSE_GEOCODE_LNG_RANGE);
  const params: Params = { lat: String(input.lat), lng: String(input.lng) };
  if (input.levels !== undefined) {
    const parts = input.levels.split(",").map((s) => s.trim()).filter(Boolean);
    const allowed = new Set<string>(REVERSE_GEOCODE_LEVELS);
    if (parts.length === 0 || parts.some((p) => !allowed.has(p))) {
      throw new Error(REVERSE_GEOCODE_LEVELS_INVALID);
    }
    params.levels = parts.join(",");
  }
  if (input.geometry) params.geometry = input.geometry;
  return params;
}
