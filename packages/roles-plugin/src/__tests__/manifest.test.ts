/**
 * L1 — roles manifest requests promotion into the Models nav group as
 * "Model roles" ("Roles" alone reads as access control next to Security).
 *
 * See change: promote-model-roles-settings (test-plan #E17).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it, vi } from "vitest";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(here, "..", "..", "package.json"), "utf-8")) as Record<
  string,
  unknown
>;

describe("roles-plugin manifest", () => {
  it("E17: BuiltInRolesSettings claim carries the Models nav hint, inert tab kept, no warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const v = validateManifest(pkg["pi-dashboard-plugin"], "roles");
      const claim = v.claims.find((c) => c.slot === "settings-section" && c.component === "BuiltInRolesSettings");
      expect(claim).toBeDefined();
      expect(claim?.tab).toBe("general");
      expect(claim?.nav?.group).toBe("models");
      expect(claim?.nav?.label).toBe("Model roles");
      expect(claim?.nav?.description?.length ?? 0).toBeGreaterThan(0);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("is first-party (npm scope) so the host honours the hint", () => {
    expect(String(pkg.name).startsWith("@blackbelt-technology/")).toBe(true);
  });
});
