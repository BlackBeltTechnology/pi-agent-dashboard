/**
 * Manifest validation for the hermes-memory-plugin `pi-dashboard-plugin` block.
 * Covers the settings-section claim + the activation gate
 * (`requires.piExtensions: ["pi-hermes-memory"]`) — spec: "Activate only when
 * the extension is installed". See change: add-hermes-memory-settings-plugin.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, "..", "..", "package.json");

describe("hermes-memory-plugin manifest", () => {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  const manifest = pkg["pi-dashboard-plugin"] as Record<string, unknown> | undefined;

  it("has a pi-dashboard-plugin block", () => {
    expect(manifest).toBeDefined();
  });

  it("validates against the loader's validator", () => {
    expect(() => validateManifest(manifest, "hermes-memory")).not.toThrow();
  });

  it("is id `hermes-memory` with client + server entries", () => {
    const v = validateManifest(manifest, "hermes-memory");
    expect(v.id).toBe("hermes-memory");
    expect(v.client).toBeTruthy();
    expect(v.server).toBeTruthy();
  });

  it("declares the settings-section claim on the general tab", () => {
    const v = validateManifest(manifest, "hermes-memory");
    const claim = v.claims.find((c) => c.slot === "settings-section") as { component: string; tab?: string };
    expect(claim).toBeDefined();
    expect(claim.component).toBe("HermesMemorySettings");
    expect(claim.tab).toBe("general");
  });

  it("gates activation on the pi-hermes-memory extension", () => {
    const v = validateManifest(manifest, "hermes-memory");
    expect(v.requires?.piExtensions).toEqual(["pi-hermes-memory"]);
  });
});
