/**
 * Response size budget for MCP tool results.
 *
 * api.gis.ph can return GeoJSON far larger than an MCP client accepts (the
 * national regions collection at geometry=detailed is ~70 MB) or than Claude
 * can usefully read. Every tool result goes through `toolResult`, which sends
 * compact JSON when it fits and, when it does not, a short summary with hints
 * for narrowing the request instead.
 *
 * This only shapes what mcp.gis.ph returns to MCP clients. api.gis.ph and its
 * REST consumers (QGIS, apps) are not affected.
 */

/** Default cap on a tool result's text, in bytes (UTF-8). Override with MCP_MAX_RESPONSE_BYTES. */
export const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

/** Parse MCP_MAX_RESPONSE_BYTES; anything that is not a positive integer falls back to the default. */
export function parseMaxResponseBytes(raw: string | undefined): number {
  const v = (raw ?? "").trim();
  if (!/^\d+$/.test(v)) return DEFAULT_MAX_RESPONSE_BYTES;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_MAX_RESPONSE_BYTES;
}

export type ToolResult = { content: { type: "text"; text: string }[] };

type Bbox = [number, number, number, number];

const encoder = new TextEncoder();

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Grow `box` with every [x, y, ...] position found under `coords`. */
function extend(box: Bbox | null, coords: unknown): Bbox | null {
  if (!Array.isArray(coords)) return box;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    const [x, y] = coords as number[];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return box;
    if (!box) return [x, y, x, y];
    return [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
  }
  for (const c of coords) box = extend(box, c);
  return box;
}

function geometryBbox(box: Bbox | null, geometry: unknown): Bbox | null {
  if (!isObject(geometry)) return box;
  if (geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
    for (const g of geometry.geometries) box = geometryBbox(box, g);
    return box;
  }
  return extend(box, geometry.coordinates);
}

function round(box: Bbox | null): Bbox | null {
  return box ? (box.map((n) => Math.round(n * 1e6) / 1e6) as Bbox) : null;
}

function isFeature(v: unknown): v is Record<string, unknown> {
  return isObject(v) && v.type === "Feature";
}

function isFeatureCollection(v: unknown): v is { type: "FeatureCollection"; features: unknown[] } {
  return isObject(v) && v.type === "FeatureCollection" && Array.isArray(v.features);
}

/** Describe features without their geometry: count, bbox, geometry types and property names. */
function describeFeatures(features: unknown[]) {
  let box: Bbox | null = null;
  const geometryTypes = new Set<string>();
  const propertyKeys = new Set<string>();
  for (const f of features) {
    if (!isObject(f)) continue;
    box = geometryBbox(box, f.geometry);
    if (isObject(f.geometry) && typeof f.geometry.type === "string") geometryTypes.add(f.geometry.type);
    if (isObject(f.properties)) for (const k of Object.keys(f.properties)) if (propertyKeys.size < 50) propertyKeys.add(k);
  }
  return {
    feature_count: features.length,
    bbox: round(box),
    geometry_types: [...geometryTypes],
    property_keys: [...propertyKeys],
  };
}

const GEOJSON_HINTS = [
  "Use geometry=simple (smallest boundaries) instead of medium or detailed.",
  "Use format=json and omit geometry to get attributes only.",
  "Narrow the area, e.g. one province_code or municipality_code instead of a whole region.",
  "For the full file, call get_download_link with the same filters and give the user the link.",
];

const LIST_HINTS = [
  "Use a smaller limit and fetch further pages with page (see meta.total).",
  "Omit geometry, or use geometry=simple, to drop boundary coordinates.",
  "Add a filter (parent code or name) to return fewer rows.",
];

/** Summary sent in place of a result that is over budget. Never includes geometry. */
export function summarize(data: unknown): { summary: Record<string, unknown>; hints: string[] } {
  if (isFeatureCollection(data)) {
    return { summary: { type: "FeatureCollection", ...describeFeatures(data.features) }, hints: GEOJSON_HINTS };
  }
  if (isFeature(data)) {
    const { property_keys, ...rest } = describeFeatures([data]);
    return {
      summary: { type: "Feature", id: data.id, ...rest, property_keys },
      hints: GEOJSON_HINTS.filter((h) => !h.startsWith("Narrow")),
    };
  }
  if (isObject(data) && "data" in data) {
    const rows = data.data;
    const summary: Record<string, unknown> = { type: "envelope" };
    if (Array.isArray(rows)) {
      summary.row_count = rows.length;
      const withFeatures = rows.filter(isFeature);
      if (withFeatures.length) Object.assign(summary, describeFeatures(withFeatures));
    }
    if (data.meta !== undefined) summary.meta = data.meta;
    return { summary, hints: LIST_HINTS };
  }
  if (Array.isArray(data)) {
    return { summary: { type: "array", row_count: data.length }, hints: LIST_HINTS };
  }
  return { summary: { type: typeof data }, hints: LIST_HINTS };
}

/**
 * Build the MCP tool result for `data`: compact JSON when it fits in
 * `maxBytes`, otherwise a small JSON summary that says why and how to narrow.
 */
export function toolResult(data: unknown, maxBytes: number = DEFAULT_MAX_RESPONSE_BYTES): ToolResult {
  const text = JSON.stringify(data) ?? "null";
  const bytes = byteLength(text);
  if (bytes <= maxBytes) return { content: [{ type: "text", text }] };

  const { summary, hints } = summarize(data);
  const body = {
    response_too_large: true,
    message: `The result is ${formatBytes(bytes)}, over this server's ${formatBytes(maxBytes)} limit for MCP responses, so only a summary is returned. Narrow the request using the hints below.`,
    bytes,
    max_bytes: maxBytes,
    summary,
    hints,
  };
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}
