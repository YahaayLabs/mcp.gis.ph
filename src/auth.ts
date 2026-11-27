/**
 * Signed-in checks for tools that are not in the anonymous free-tier set.
 * Works with today's /mcp key (or x-api-key) forwarded as Authorization: Bearer.
 * When OAuth lands, the same check should require the documented scope
 * (reverse_geocode: read:boundaries) instead of only "a key is present".
 * Do not change the /mcp handler here; OAuth work on #5 owns that path.
 */
export const SIGNED_IN_REQUIRED =
  "This tool requires a signed-in user (API key or Bearer token). reverse_geocode will later require the OAuth read:boundaries scope.";

/** Return the trimmed key, or throw if none is present. */
export function requireSignedIn(apiKey: string | undefined | null): string {
  const key = apiKey?.trim() ?? "";
  if (!key) throw new Error(SIGNED_IN_REQUIRED);
  return key;
}
