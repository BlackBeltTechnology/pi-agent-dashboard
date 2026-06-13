/**
 * Manifest validation for the goal-plugin `pi-dashboard-plugin` block.
 * See change: add-goal-continuation-plugin.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, "..", "..", "package.json");

describe("goal-plugin manifest", () => {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  const manifest = pkg["pi-dashboard-plugin"] as Record<string, unknown> | undefined;

  it("has a pi-dashboard-plugin block", () => {
    expect(manifest).toBeDefined();
  });

  it("validates against the loader's validator", () => {
    expect(() => validateManifest(manifest, "goal")).not.toThrow();
  });

  it("plugin id is `goal` with three entries", () => {
    const v = validateManifest(manifest, "goal");
    expect(v.id).toBe("goal");
    expect(v.bridge).toBeTruthy();
    expect(v.server).toBeTruthy();
    expect(v.client).toBeTruthy();
  });

  it("declares badge + action-bar + settings claims", () => {
    const v = validateManifest(manifest, "goal");
    expect(v.claims.map((c) => c.slot).sort()).toEqual([
      "session-card-action-bar",
      "session-card-badge",
      "settings-section",
    ]);
  });

  it("requires the @ricoyudog/pi-goal-hermes pi extension", () => {
    const v = validateManifest(manifest, "goal");
    expect(v.requires?.piExtensions).toEqual(["@ricoyudog/pi-goal-hermes"]);
  });
});
