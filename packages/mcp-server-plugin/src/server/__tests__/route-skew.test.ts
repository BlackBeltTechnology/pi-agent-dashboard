/**
 * E30 (test-plan expand-mcp-tiered-surface) — route-skew guard (design D4).
 */
import { describe, expect, it } from "vitest";
import { GENERATED_TOOLS } from "../generated/tools.js";
import { filterToolsByRoute } from "../route-skew.js";

describe("E30 — a manifest row whose route is unregistered is dropped", () => {
  it("keeps registered rows, drops the missing one, logs once, keeps non-rest rows", () => {
    const warnings: string[] = [];
    const present = new Set(["GET /api/health"]);
    const filtered = filterToolsByRoute(
      GENERATED_TOOLS,
      (method, url) => present.has(`${method} ${url}`),
      (m) => warnings.push(m),
    );

    expect(filtered.some((t) => t.name === "get_health")).toBe(true);
    expect(filtered.some((t) => t.name === "restart_server")).toBe(false);
    // Non-REST rows survive regardless of the host's routes.
    expect(filtered.some((t) => t.name === "list_sessions")).toBe(true);
    const missing = warnings.filter((w) => w.includes("mcp.manifest_route_missing"));
    expect(missing.some((w) => w.includes("restart_server"))).toBe(true);
    // Exactly one warning per dropped row.
    expect(warnings.filter((w) => w.includes("restart_server"))).toHaveLength(1);
  });
});
