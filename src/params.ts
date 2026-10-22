/** Default and max page size sent to api.gis.ph list endpoints (API default is 10, max 100). */
export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 100;

export interface PagingInput {
  limit?: number;
  page?: number;
}

/** Paging params for api.gis.ph. Always sends a limit so lists are not cut at the API default of 10. */
export function pagingParams({ limit, page }: PagingInput): Record<string, string> {
  const l = Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
  const p = Math.max(Math.trunc(page ?? 1), 1);
  return { limit: String(l), page: String(p) };
}

export interface BarangayFilterInput extends PagingInput {
  municipality_code?: string;
  /** Deprecated alias kept so existing callers keep working. */
  municity_code?: string;
  province_code?: string;
}

/**
 * Build query params for GET /v1/barangays. The API filter is `municipality_code`
 * (not `municity_code`, which the API ignores). `province_code` is passed through
 * when known; callers resolve it from the municity when it is missing.
 */
export function barangayParams(input: BarangayFilterInput, resolvedProvinceCode?: string): Record<string, string> {
  const params: Record<string, string> = { ...pagingParams(input) };
  const municipality = input.municipality_code ?? input.municity_code;
  if (municipality) params.municipality_code = municipality;
  const province = input.province_code ?? resolvedProvinceCode;
  if (province) params.province_code = province;
  return params;
}

/** Pull the province code out of a GET /v1/municities/{code} response. */
export function provinceCodeFromMunicity(body: unknown): string | undefined {
  const data = (body as { data?: Record<string, unknown> } | null)?.data ?? (body as Record<string, unknown> | null);
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;
  const code = d.host_province_code ?? d.p_code ?? d.province_code;
  return typeof code === "string" && code ? code : undefined;
}
