import { routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import { describe, expect, it } from "vitest";
import { MANIFEST } from "../tools.manifest.js";

// Plugin-side half of add-openspec-change-dependencies test-plan #X7: the dependencies routes are
// exposed as reviewed MCP tools whose effective tier (the route tier; REST rows carry none of their own) is as declared. (The server-side half lives in
// packages/server/src/__tests__/openspec-dependencies-routes.test.ts; a core test must not import
// this plugin — scripts/check-plugin-boundary.mjs.)
describe("openspec dependencies MCP tools (#X7)", () => {
  const URL = "/api/openspec/dependencies";
  const rows = [
    { method: "GET", name: "get_openspec_dependencies", tier: "observe", readOnly: true },
    { method: "PUT", name: "openspec_dependencies", tier: "control", readOnly: false },
  ] as const;

  for (const { method, name, tier, readOnly } of rows) {
    it(`${method} ${URL} is bound by ${name} at tier ${tier}`, () => {
      const row = MANIFEST.find((r) => r.bind.kind === "rest" && r.bind.method === method && r.bind.path === URL);
      expect(row?.name).toBe(name);
      expect(row?.annotations.readOnlyHint).toBe(readOnly);
      expect(routeTier(method, URL)).toBe(tier);
    });
  }
});
