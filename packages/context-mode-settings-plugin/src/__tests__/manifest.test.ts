/**
 * Manifest validation for the context-mode-settings-plugin `pi-dashboard-plugin` block.
 * Covers the settings-section claim + the activation gate
 * (`requires.piExtensions: ["context-mode"]`) — spec: "Activate only when
 * the extension is installed". See change: add-context-mode-settings-plugin.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { validateManifest } from "../../../dashboard-plugin-runtime/src/manifest-validator.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, "..", "..", "package.json");

describe("context-mode-settings-plugin manifest", () => {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
  const manifest = pkg["pi-dashboard-plugin"] as Record<string, unknown> | undefined;

  it("has a pi-dashboard-plugin block", () => {
    expect(manifest).toBeDefined();
  });

  it("validates against the loader's validator", () => {
    expect(() => validateManifest(manifest, "context-mode-settings")).not.toThrow();
  });

  it("is id `context-mode-settings` with client + server entries", () => {
    const v = validateManifest(manifest, "context-mode-settings");
    expect(v.id).toBe("context-mode-settings");
    expect(v.client).toBeTruthy();
    expect(v.server).toBeTruthy();
  });

  it("declares the settings-section claim on the general tab", () => {
    const v = validateManifest(manifest, "context-mode-settings");
    const claim = v.claims.find((c) => c.slot === "settings-section") as { component: string; tab?: string };
    expect(claim).toBeDefined();
    expect(claim.component).toBe("ContextModeSettings");
    expect(claim.tab).toBe("general");
  });

  it("declares a bridge entry", () => {
    const v = validateManifest(manifest, "context-mode-settings");
    expect(v.bridge).toBeTruthy();
  });

  it("gates activation on the context-mode extension", () => {
    const v = validateManifest(manifest, "context-mode-settings");
    expect(v.requires?.piExtensions).toEqual(["context-mode"]);
  });
});
