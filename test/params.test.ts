import { describe, expect, it } from "vitest";
import { barangayParams, pagingParams, provinceCodeFromMunicity } from "../src/params";

describe("pagingParams", () => {
  it("defaults to limit 100, page 1", () => {
    expect(pagingParams({})).toEqual({ limit: "100", page: "1" });
  });
  it("clamps limit to 1..100 and page to >= 1", () => {
    expect(pagingParams({ limit: 500, page: 0 })).toEqual({ limit: "100", page: "1" });
    expect(pagingParams({ limit: 0, page: 3 })).toEqual({ limit: "1", page: "3" });
  });
});

describe("barangayParams", () => {
  it("sends municipality_code, never municity_code", () => {
    const p = barangayParams({ municipality_code: "0730600000", province_code: "0702200000" });
    expect(p.municipality_code).toBe("0730600000");
    expect(p).not.toHaveProperty("municity_code");
    expect(p.province_code).toBe("0702200000");
  });
  it("maps the legacy municity_code input to municipality_code", () => {
    const p = barangayParams({ municity_code: "0730600000" }, "0702200000");
    expect(p).toMatchObject({ municipality_code: "0730600000", province_code: "0702200000", limit: "100" });
    expect(p).not.toHaveProperty("municity_code");
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
