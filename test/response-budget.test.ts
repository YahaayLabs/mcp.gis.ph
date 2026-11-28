import { describe, expect, it } from "vitest";

import { DEFAULT_MAX_RESPONSE_BYTES, parseMaxResponseBytes, summarize, toolResult } from "../src/response-budget";

const square = (x: number, y: number, props: Record<string, unknown> = {}) => ({
  type: "Feature",
  properties: { code: `${x}${y}`, ...props },
  geometry: { type: "MultiPolygon", coordinates: [[[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]]] },
});

const fc = (n: number) => ({ type: "FeatureCollection", features: Array.from({ length: n }, (_, i) => square(120 + i, 10 + i, { name: "x".repeat(50) })) });

describe("parseMaxResponseBytes", () => {
  it("defaults to 1 MB", () => {
    expect(DEFAULT_MAX_RESPONSE_BYTES).toBe(1_000_000);
    expect(parseMaxResponseBytes(undefined)).toBe(1_000_000);
  });
  it("accepts positive integers", () => {
    expect(parseMaxResponseBytes("5000000")).toBe(5_000_000);
    expect(parseMaxResponseBytes(" 2048 ")).toBe(2048);
  });
  it.each(["", "0", "-1", "1.5", "1MB", "abc"])("falls back to the default for %j", (raw) => {
    expect(parseMaxResponseBytes(raw)).toBe(DEFAULT_MAX_RESPONSE_BYTES);
  });
});

describe("toolResult", () => {
  it("returns compact JSON when under the limit", () => {
    const data = { data: [{ code: "01" }], meta: { total: 1 } };
    const r = toolResult(data, 1000);
    expect(r.content).toHaveLength(1);
    expect(r.content[0]!.text).toBe('{"data":[{"code":"01"}],"meta":{"total":1}}');
    expect(JSON.parse(r.content[0]!.text)).toEqual(data);
  });

  it("returns exactly-at-limit results unchanged", () => {
    const data = { a: "b" };
    expect(toolResult(data, JSON.stringify(data).length).content[0]!.text).toBe('{"a":"b"}');
  });

  it("counts bytes as UTF-8, not string length", () => {
    const data = { name: "Ñ".repeat(10) }; // 2 bytes each
    const len = JSON.stringify(data).length;
    expect(JSON.parse(toolResult(data, len).content[0]!.text).response_too_large).toBe(true);
  });

  it("summarizes an over-limit FeatureCollection without geometry", () => {
    const data = fc(20);
    const r = toolResult(data, 500);
    const text = r.content[0]!.text;
    expect(text.length).toBeLessThan(JSON.stringify(data).length);
    const body = JSON.parse(text);
    expect(body.response_too_large).toBe(true);
    expect(body.max_bytes).toBe(500);
    expect(body.bytes).toBe(JSON.stringify(data).length);
    expect(body.message).toContain("limit");
    expect(body.summary).toEqual({
      type: "FeatureCollection",
      feature_count: 20,
      bbox: [120, 10, 140, 30],
      geometry_types: ["MultiPolygon"],
      property_keys: ["code", "name"],
    });
    expect(body.hints.join(" ")).toContain("geometry=simple");
    expect(text).not.toContain("coordinates");
  });

  it("summarizes an over-limit envelope with meta and paging hints", () => {
    const data = { data: Array.from({ length: 100 }, (_, i) => ({ code: String(i), name: "y".repeat(40) })), meta: { total: 1600, next: 2 }, error: null };
    const body = JSON.parse(toolResult(data, 200).content[0]!.text);
    expect(body.summary).toMatchObject({ type: "envelope", row_count: 100, meta: { total: 1600, next: 2 } });
    expect(body.hints.join(" ")).toContain("limit");
  });
});

describe("summarize", () => {
  it("handles a single Feature and GeometryCollection geometry", () => {
    const f = {
      type: "Feature",
      id: "0102800000",
      properties: { name: "A" },
      geometry: { type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [121.5, 14.6] }, { type: "Point", coordinates: [120.1, 15.2] }] },
    };
    const { summary, hints } = summarize(f);
    expect(summary).toMatchObject({ type: "Feature", id: "0102800000", feature_count: 1, bbox: [120.1, 14.6, 121.5, 15.2] });
    expect(hints.some((h) => h.startsWith("Narrow"))).toBe(false);
  });
  it("handles features without geometry", () => {
    const { summary } = summarize({ type: "FeatureCollection", features: [{ type: "Feature", properties: null, geometry: null }] });
    expect(summary).toMatchObject({ feature_count: 1, bbox: null, geometry_types: [] });
  });
  it("handles bare arrays and scalars", () => {
    expect(summarize([1, 2, 3]).summary).toEqual({ type: "array", row_count: 3 });
    expect(summarize("x").summary).toEqual({ type: "string" });
  });
});
