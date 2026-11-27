import { describe, expect, it } from "vitest";
import {
  BARANGAY_GEOJSON_NEEDS_MUNICIPALITY,
  MUNICITY_PARENT_REQUIRED,
  barangayParams,
  datasetListParams,
  geoOutputParams,
  municityListParams,
  pagingParams,
  provinceCodeFromMunicity,
  provinceGetParams,
  provinceListParams,
  regionListParams,
} from "../src/params";
import { dataTypeSchema, municitiesInput } from "../src/schemas";

// Public example PSGC codes from the api.gis.ph OpenAPI.
const MUNI = "0712370000"; // Tagbilaran
const PROV = "0701200000"; // Bohol

describe("pagingParams", () => {
  it("defaults to limit 100, page 1", () => {
    expect(pagingParams({})).toEqual({ limit: "100", page: "1" });
  });
  it("clamps limit to 1..100 and page to >= 1", () => {
    expect(pagingParams({ limit: 500, page: 0 })).toEqual({ limit: "100", page: "1" });
    expect(pagingParams({ limit: 0, page: 3 })).toEqual({ limit: "1", page: "3" });
  });
  it("truncates fractional values", () => {
    expect(pagingParams({ limit: 25.9, page: 2.5 })).toEqual({ limit: "25", page: "2" });
  });
});

describe("geoOutputParams", () => {
  it("sends nothing when format and geometry are omitted", () => {
    expect(geoOutputParams({})).toEqual({});
  });
  it("sends format and geometry under those names, never the deprecated output alias", () => {
    const p = geoOutputParams({ format: "geojson", geometry: "detailed" });
    expect(p).toEqual({ format: "geojson", geometry: "detailed" });
    expect(p).not.toHaveProperty("output");
  });
  it("sends only the field that was set", () => {
    expect(geoOutputParams({ geometry: "simple" })).toEqual({ geometry: "simple" });
    expect(geoOutputParams({ format: "json" })).toEqual({ format: "json" });
  });
});

describe("regionListParams", () => {
  it("always sends paging so all 17 regions fit (API default limit is 10)", () => {
    expect(regionListParams({})).toEqual({ limit: "100", page: "1" });
  });
  it("passes search, paging and output options", () => {
    expect(regionListParams({ search: "Luzon", limit: 5, page: 2, format: "geojson" })).toEqual({
      search: "Luzon",
      limit: "5",
      page: "2",
      format: "geojson",
    });
  });
});

describe("province params", () => {
  it("list: paging by default, nothing else", () => {
    expect(provinceListParams({})).toEqual({ limit: "100", page: "1" });
  });
  it("list: sends region, extent, format, geometry; never scope or output", () => {
    const p = provinceListParams({ region: "07", extent: "geographic", format: "geojson", geometry: "medium" });
    expect(p).toEqual({ limit: "100", page: "1", region: "07", extent: "geographic", format: "geojson", geometry: "medium" });
    expect(p).not.toHaveProperty("scope");
    expect(p).not.toHaveProperty("output");
  });
  it("get-one: empty by default, no paging", () => {
    expect(provinceGetParams({})).toEqual({});
    expect(provinceGetParams({ extent: "administrative" })).toEqual({ extent: "administrative" });
  });
});

describe("municityListParams", () => {
  it("throws when neither province nor province_code is given", () => {
    expect(() => municityListParams({})).toThrow(MUNICITY_PARENT_REQUIRED);
    expect(() => municityListParams({ name: "Tag", scope: "admin" })).toThrow(MUNICITY_PARENT_REQUIRED);
    expect(() => municityListParams({ province: "  ", province_code: "" })).toThrow(MUNICITY_PARENT_REQUIRED);
  });
  it("code only: sends province_code and never province", () => {
    const p = municityListParams({ province_code: PROV });
    expect(p).toEqual({ limit: "100", page: "1", province_code: PROV });
    expect(p).not.toHaveProperty("province");
  });
  it("name only: sends province and does not invent a province_code", () => {
    const p = municityListParams({ province: "Bohol" });
    expect(p).toEqual({ limit: "100", page: "1", province: "Bohol" });
    expect(p).not.toHaveProperty("province_code");
  });
  it("both: sends both under their exact names (API prefers the code)", () => {
    expect(municityListParams({ province: "Bohol", province_code: PROV })).toMatchObject({ province: "Bohol", province_code: PROV });
  });
  it("includes scope, name, format, geometry only when set", () => {
    const base = municityListParams({ province_code: PROV });
    for (const k of ["scope", "name", "format", "geometry", "output"]) expect(base).not.toHaveProperty(k);
    expect(
      municityListParams({ province_code: PROV, scope: "admin", name: "Tag", format: "geojson", geometry: "simple", limit: 20, page: 2 })
    ).toEqual({ province_code: PROV, scope: "admin", name: "Tag", format: "geojson", geometry: "simple", limit: "20", page: "2" });
  });
});

describe("municitiesInput (tool schema)", () => {
  it("rejects input with no parent province", () => {
    const r = municitiesInput.safeParse({ name: "Tag" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe(MUNICITY_PARENT_REQUIRED);
  });
  it("accepts province or province_code", () => {
    expect(municitiesInput.safeParse({ province: "Bohol" }).success).toBe(true);
    expect(municitiesInput.safeParse({ province_code: PROV }).success).toBe(true);
  });
  it("rejects an unknown scope value", () => {
    expect(municitiesInput.safeParse({ province_code: PROV, scope: "administrative" }).success).toBe(false);
  });
});

describe("barangayParams", () => {
  it("sends municipality_code, never municity_code", () => {
    const p = barangayParams({ municipality_code: MUNI, province_code: PROV });
    expect(p).toEqual({ limit: "100", page: "1", municipality_code: MUNI, province_code: PROV });
    expect(p).not.toHaveProperty("municity_code");
  });
  it("maps the legacy municity_code input to municipality_code", () => {
    const p = barangayParams({ municity_code: MUNI });
    expect(p).toEqual({ limit: "100", page: "1", municipality_code: MUNI });
    expect(p).not.toHaveProperty("municity_code");
  });
  it("municipality_code wins over the legacy municity_code input", () => {
    expect(barangayParams({ municipality_code: MUNI, municity_code: "0000000000" }).municipality_code).toBe(MUNI);
  });
  it("municipality_code alone is enough: no province is added", () => {
    const p = barangayParams({ municipality_code: MUNI });
    expect(p).not.toHaveProperty("province_code");
    expect(p).not.toHaveProperty("province");
  });
  it("sends the name filters under their API names", () => {
    expect(barangayParams({ province: "Bohol", municipality: "Tagbi", name: "Pob" })).toEqual({
      limit: "100",
      page: "1",
      province: "Bohol",
      municipality: "Tagbi",
      name: "Pob",
    });
  });
  it("only sends documented query names (API 400s on unknown params)", () => {
    const allowed = new Set(["page", "limit", "format", "geometry", "province", "province_code", "municipality", "municipality_code", "name"]);
    const p = barangayParams({
      municipality_code: MUNI,
      municity_code: MUNI,
      municipality: "Tag",
      province_code: PROV,
      province: "Bohol",
      name: "Pob",
      format: "json",
      geometry: "simple",
      limit: 10,
      page: 1,
    });
    for (const k of Object.keys(p)) expect(allowed.has(k)).toBe(true);
  });
  it("omits format/geometry unless set", () => {
    const p = barangayParams({ municipality_code: MUNI });
    expect(p).not.toHaveProperty("format");
    expect(p).not.toHaveProperty("geometry");
    expect(p).not.toHaveProperty("output");
  });
  it("geojson needs municipality_code or municipality", () => {
    expect(() => barangayParams({ province_code: PROV, format: "geojson" })).toThrow(BARANGAY_GEOJSON_NEEDS_MUNICIPALITY);
    expect(barangayParams({ municipality: "Tag", format: "geojson" })).toMatchObject({ municipality: "Tag", format: "geojson" });
    expect(barangayParams({ municity_code: MUNI, format: "geojson" })).toMatchObject({ municipality_code: MUNI, format: "geojson" });
  });
});

describe("datasetListParams", () => {
  it("defaults to paging only", () => {
    expect(datasetListParams({})).toEqual({ limit: "100", page: "1" });
  });
  it("maps include_features to includeFeatures and passes visibility", () => {
    const p = datasetListParams({ include_features: true, visibility: "all", limit: 20, page: 3 });
    expect(p).toEqual({ includeFeatures: "true", visibility: "all", limit: "20", page: "3" });
    expect(p).not.toHaveProperty("include_features");
  });
  it("does not send includeFeatures when false", () => {
    expect(datasetListParams({ include_features: false })).not.toHaveProperty("includeFeatures");
  });
});

describe("dataTypeSchema", () => {
  it("matches the API enum vector | raster | data", () => {
    for (const t of ["vector", "raster", "data"]) expect(dataTypeSchema.safeParse(t).success).toBe(true);
    expect(dataTypeSchema.safeParse("tabular").success).toBe(false);
  });
});

describe("provinceCodeFromMunicity", () => {
  it("prefers host_province_code, then p_code", () => {
    expect(provinceCodeFromMunicity({ data: { p_code: "A", host_province_code: "B" } })).toBe("B");
    expect(provinceCodeFromMunicity({ data: { p_code: "A", host_province_code: null } })).toBe("A");
    expect(provinceCodeFromMunicity({ p_code: "C" })).toBe("C");
    expect(provinceCodeFromMunicity(null)).toBeUndefined();
  });
});
