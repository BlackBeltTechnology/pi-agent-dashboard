/**
 * E14/E18 (test-plan expand-mcp-tiered-surface) — manifest invariants.
 *
 * See change: expand-mcp-tiered-surface (D6/D7).
 */
import { rank, type Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import { describe, expect, it } from "vitest";
import { GENERATED_TOOLS } from "../generated/tools.js";
import { MANIFEST, type ToolRow } from "../tools.manifest.js";

const EMPTY = { readOnlyHint: false, destructiveHint: false } as const;

/** Does a row's route pattern imply it targets one session? */
function impliesSessionTarget(row: ToolRow): boolean {
  return row.bind.kind === "rest" && /:(id|sessionId)\b/.test(row.bind.path);
}

/** The flag invariant: a session-targeting route MUST set the flag. */
function checkSessionFlag(row: ToolRow): boolean {
  return !impliesSessionTarget(row) || row.sessionTargeting === true;
}

describe("E14 — annotation and tier invariants", () => {
  it("every observe tool is read-only", () => {
    for (const t of GENERATED_TOOLS.filter((t) => t.tier === "observe")) {
      expect(t.annotations.readOnlyHint, t.name).toBe(true);
    }
  });

  it("no destructive tool is observe-tier", () => {
    for (const t of GENERATED_TOOLS.filter((t) => t.annotations.destructiveHint)) {
      expect(t.tier, t.name).not.toBe("observe");
    }
  });

  it("force_kill is operate + destructive", () => {
    const kill = GENERATED_TOOLS.find((t) => t.name === "force_kill");
    expect(kill?.tier).toBe("operate");
    expect(kill?.annotations.destructiveHint).toBe(true);
  });

  it("descriptions are ≤ 120 chars", () => {
    for (const t of GENERATED_TOOLS) {
      expect(t.description.length, t.name).toBeLessThanOrEqual(120);
    }
  });

  it("tool names are unique", () => {
    const names = GENERATED_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every rest row's tier is at or above its route's tier", () => {
    for (const row of MANIFEST) {
      if (row.bind.kind !== "rest") continue;
      const route = routeTier(row.bind.method, row.bind.path) as Tier;
      const effective = GENERATED_TOOLS.find((t) => t.name === row.name)?.tier as Tier;
      expect(rank(effective), `${row.name} (${effective} vs route ${route})`).toBeGreaterThanOrEqual(
        rank(route),
      );
    }
  });

  it("the two destructive lifecycle rows declare operate over their control route", () => {
    for (const name of ["force_kill", "kill_process"]) {
      const row = MANIFEST.find((r) => r.name === name);
      expect(row?.tier).toBe("operate");
      if (row?.bind.kind === "rest") {
        expect(routeTier(row.bind.method, row.bind.path)).toBe("control");
      }
    }
  });
});

describe("E18 — session-targeting coverage", () => {
  it("every row whose route implies a session target sets the flag", () => {
    for (const row of MANIFEST) expect(checkSessionFlag(row), row.name).toBe(true);
  });

  it("the check is NOT vacuous — a :id route without the flag fails", () => {
    const rogue: ToolRow = {
      name: "rogue_session_tool",
      description: "fixture",
      annotations: { ...EMPTY },
      input: "ToolJsonBody",
      bind: { kind: "rest", method: "POST", path: "/api/session/:id/x" },
    };
    expect(checkSessionFlag(rogue)).toBe(false);
  });

  it("a sessionId path parameter is exposed as `sessionId` on every such row", () => {
    for (const t of GENERATED_TOOLS) {
      if (t.paramSplit.path.some((p) => p.param === "id")) {
        expect(t.paramSplit.path.some((p) => p.arg === "sessionId"), t.name).toBe(true);
      }
    }
  });
});
