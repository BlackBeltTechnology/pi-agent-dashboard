/**
 * Manifest + barrel wiring test — see change: add-grammar-settings-plugin.
 *
 * Guards the contract the vite-plugin's named-import generator relies on: the
 * manifest declares the settings-section/general claim, and the barrel exports
 * a component matching the claim's `component` field plus the `i18nCatalog`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as barrel from "../index.js";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8"),
);

describe("grammar-settings manifest", () => {
  it("declares a single settings-section claim on the general tab", () => {
    const manifest = pkg["pi-dashboard-plugin"];
    expect(manifest.id).toBe("grammar-settings");
    expect(manifest.claims).toHaveLength(1);
    expect(manifest.claims[0]).toMatchObject({
      slot: "settings-section",
      component: "GrammarSettings",
      tab: "general",
    });
  });

  it("exports the claimed component and the i18n catalog from the barrel", () => {
    const manifest = pkg["pi-dashboard-plugin"];
    expect(typeof (barrel as Record<string, unknown>)[manifest.claims[0].component]).toBe(
      "function",
    );
    expect((barrel as Record<string, unknown>)[manifest.i18nCatalog]).toBeTypeOf("object");
  });

  it("declares a server entry that owns the /api/grammar routes", () => {
    // The grammar check route + backends now live in the plugin's server entry
    // (no longer core). See change: make-grammar-fully-plugin-contained.
    const manifest = pkg["pi-dashboard-plugin"];
    expect(manifest.server).toBe("./src/server/index.ts");
    // configSchema still absent — config migration to plugins.grammar is a
    // later increment; the route currently reads core config.grammar.
    expect(manifest.configSchema).toBeUndefined();
  });
});
