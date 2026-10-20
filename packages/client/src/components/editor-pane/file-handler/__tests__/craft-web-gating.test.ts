/**
 * Test-plan #E4 (extend-craft-web-to-all-apps): an extension is claimed only after its verification. The
 * CADCraft `.dwg` fixture spike failed (the web build refuses DWG), so the REAL craft-web manifest lists
 * `.dxf` only: `plan.dwg` matches no CADCraft mode, `plan.dxf` matches "Edit in CADCraft".
 * Claims go through the loader's `validateManifest` and a real slot registry, then the pane's
 * `listFileHandlerClaims` → `claimsForPath`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../../../../dashboard-plugin-runtime/src/manifest-validator.js";
import { claimsForPath, listFileHandlerClaims } from "../file-handler-claims.js";

const pkgPath = path.resolve(__dirname, "../../../../../../craft-web-plugin/package.json");
const manifest = (JSON.parse(readFileSync(pkgPath, "utf8")) as { "pi-dashboard-plugin": unknown })["pi-dashboard-plugin"];

function registry() {
  const reg = createSlotRegistry();
  const validated = validateManifest(manifest, "craft-web");
  for (const c of validated.claims) {
    if (c.slot !== "editor-pane-file-handler") continue;
    const { slot, component, module, ...fileHandler } = c as Record<string, unknown>;
    reg.addClaim({ pluginId: "craft-web", priority: 400, slot, fileHandler, Component: () => null } as never);
  }
  return reg;
}

describe("E4 extension gated by verification (CADCraft .dwg)", () => {
  const claims = listFileHandlerClaims(registry());

  it("plan.dwg → no CADCraft claim", () => {
    expect(claimsForPath(claims, "plan.dwg").map((c) => c.key)).toEqual([]);
  });

  it("plan.dxf → 'Edit in CADCraft'", () => {
    const m = claimsForPath(claims, "drawings/plan.dxf");
    expect(m.map((c) => c.meta.label)).toEqual(["Edit in CADCraft"]);
    expect(m[0].key).toBe("craft-web/cadcraft");
  });
});
