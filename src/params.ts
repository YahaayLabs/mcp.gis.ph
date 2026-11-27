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

