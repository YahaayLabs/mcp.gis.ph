/**
 * Tool access policy at launch (mcp.gis.ph#5, decisions 3 and 5 on #4).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Access } from "./auth";

/** Free boundary metadata tools: work without sign-in (anonymous 30 rpm upstream). */
export const ANONYMOUS_TOOLS = [
  "get_regions", "get_region",
  "get_provinces", "get_province",
  "get_municities", "get_municity",
  "get_barangays", "get_barangay",
  "search_municities", "search_barangays",
] as const;

/** Read-only tools that need OAuth sign-in or an API key. */
export const SIGNED_IN_TOOLS = [
  "list_datasets", "get_dataset",
  "list_features", "get_feature", "get_features_by_dataset",
  "search_regions_by_ids", "search_provinces_by_codes",
  "search_municities_by_codes", "search_barangays_by_codes",
  "reverse_geocode",
] as const;

/** Write tools disabled for this launch for everyone (the API also 403s them for MCP). */
export const DISABLED_TOOLS = ["create_dataset", "update_dataset", "create_feature"] as const;

export type ToolName = (typeof ANONYMOUS_TOOLS)[number] | (typeof SIGNED_IN_TOOLS)[number] | (typeof DISABLED_TOOLS)[number];

const anonymous = new Set<string>(ANONYMOUS_TOOLS);
const disabled = new Set<string>(DISABLED_TOOLS);

export function isToolDisabled(name: string): boolean {
  return disabled.has(name);
}

/** True when this caller must sign in before calling `name`. */
export function requiresSignIn(access: Access, name: string): boolean {
  return access.kind === "anonymous" && !anonymous.has(name) && !disabled.has(name);
}

type Handle = { disable(): void };

/**
 * Wrap `server.tool` so registrations are tracked, then disable write tools
 * after registration (they disappear from tools/list and calls return
 * "Tool … disabled"). Keeps tool definitions in index.ts untouched.
 */
export function trackTools(server: McpServer) {
  const handles = new Map<string, Handle>();
  const original = server.tool.bind(server) as (...args: unknown[]) => Handle;
  (server as unknown as { tool: (...args: unknown[]) => Handle }).tool = (...args: unknown[]) => {
    const handle = original(...args);
    handles.set(String(args[0]), handle);
    return handle;
  };
  return {
    apply() {
      for (const [name, handle] of handles) if (isToolDisabled(name)) handle.disable();
    },
    names: () => [...handles.keys()],
  };
}

type JsonRpcMessage = { method?: unknown; params?: { name?: unknown } };

/** Names of tools called in a JSON-RPC message or batch. */
export function calledTools(body: unknown): string[] {
  const msgs = Array.isArray(body) ? body : [body];
  const out: string[] = [];
  for (const m of msgs as JsonRpcMessage[]) {
    if (m && typeof m === "object" && m.method === "tools/call" && typeof m.params?.name === "string") out.push(m.params.name);
  }
  return out;
}
