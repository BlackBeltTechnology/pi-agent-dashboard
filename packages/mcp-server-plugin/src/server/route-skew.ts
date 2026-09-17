/**
 * Route-skew guard (change: expand-mcp-tiered-surface, D4).
 *
 * `mcp-server-plugin` is published separately from the host, so a newer plugin
 * may carry manifest rows for REST routes an older host does not have. At
 * activation the plugin drops those rows from the advertised surface with one
 * `mcp.manifest_route_missing` warning each, rather than advertising a tool
 * that would 404.
 *
 * Extracted so the behaviour is unit-testable without booting the plugin.
 */
import type { GeneratedTool } from "./generated/tools.js";

export function filterToolsByRoute(
  tools: readonly GeneratedTool[],
  hasRoute: (method: string, url: string) => boolean,
  warn: (message: string) => void,
): GeneratedTool[] {
  return tools.filter((t) => {
    if (t.bind.kind !== "rest") return true;
    const present = hasRoute(t.bind.method, t.bind.path);
    if (!present) {
      warn(`mcp-server: mcp.manifest_route_missing tool=${t.name} route=${t.bind.method} ${t.bind.path}`);
    }
    return present;
  });
}
