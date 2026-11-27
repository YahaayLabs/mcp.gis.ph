/** RFC 9728 protected-resource metadata (mcp.gis.ph#5). The AS is api.gis.ph. */
import type { McpConfig } from "./config";

export function protectedResourceDocument(cfg: McpConfig) {
  return {
    resource: cfg.resource,
    authorization_servers: [cfg.issuer],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
    resource_documentation: cfg.resource,
  };
}
