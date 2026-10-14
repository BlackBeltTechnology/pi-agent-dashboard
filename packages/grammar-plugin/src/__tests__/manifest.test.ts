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

describe("grammar manifest", () => {
  it("declares the settings-section + composer-panel claims", () => {
    const manifest = pkg["pi-dashboard-plugin"];
    expect(manifest.id).toBe("grammar");
    expect(manifest.claims).toHaveLength(2);
    expect(manifest.claims).toContainEqual({
      slot: "settings-section",
      component: "GrammarSettings",
      module: "./src/GrammarSettings.tsx",
      tab: "general",
    });
    // The composer-panel claim renders the grammar check UI below the input.
    // See change: make-grammar-fully-plugin-contained.
    expect(manifest.claims).toContainEqual({
      slot: "composer-panel",
      component: "GrammarComposerPanel",
    });
  });

  it("exports every claimed component and the i18n catalog from the barrel (lazy claims from their module only)", async () => {
    const manifest = pkg["pi-dashboard-plugin"];
    // The vite registry generator resolves each claim.component by name — from
    // the barrel, or for a lazy claim (`module`, change:
    // lazy-plugin-claim-modules) from that module, never both.
    const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    for (const claim of manifest.claims) {
      if (claim.module) {
        const mod = (await import(/* @vite-ignore */ join(pkgDir, claim.module))) as Record<string, unknown>;
        expect(typeof mod[claim.component]).toBe("function");
        expect((barrel as Record<string, unknown>)[claim.component]).toBeUndefined();
      } else {
        expect(typeof (barrel as Record<string, unknown>)[claim.component]).toBe("function");
      }
    }
    expect((barrel as Record<string, unknown>)[manifest.i18nCatalog]).toBeTypeOf("object");
  });

  it("declares a server entry that owns the /api/grammar routes", () => {
    // The grammar check route + backends now live in the plugin's server entry
    // (no longer core). See change: make-grammar-fully-plugin-contained.
    const manifest = pkg["pi-dashboard-plugin"];
    expect(manifest.server).toBe("./src/server/index.ts");
    // configSchema present — config lives in the plugin namespace plugins.grammar
    // (migrated off core config.grammar). See change: make-grammar-fully-plugin-contained.
    expect(manifest.configSchema).toBe("./configSchema.json");
  });
});
