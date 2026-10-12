/**
 * Repository regression: the build-time generated plugin registry must
 * actually be populated when ≥1 workspace plugin manifest exists.
 *
 * Why: `packages/client/vite.config.ts` must invoke
 * `viteDashboardPluginsPlugin()` and `App.tsx` must consume the generated
 * `PLUGIN_REGISTRY`. If either wire is missing, every slot consumer
 * renders zero contributions even when manifests claim slots — a silent
 * UX regression with no compile error.
 *
 * Behaviour:
 *   - On a clean tree (pre-build), the committed stub exports
 *     `PLUGIN_REGISTRY = []`. The test detects this and SKIPS so
 *     `npm test` works without forcing a full `npm run build` first.
 *   - After `npm run build` (CI runs build before test), the generated
 *     file is overwritten with the real registry. The test asserts:
 *     • Every entry has at least one claim.
 *     • Every claim's `slot` is in the known SLOT_DEFINITIONS set.
 *     • At least one entry's manifest id matches a workspace package
 *       directory under `packages/`.
 *
 * See change: wire-plugin-registry-into-shell.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { SLOT_DEFINITIONS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js";
import { PLUGIN_REGISTRY } from "../generated/plugin-registry.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

function workspacePluginManifestCount(): number {
  if (!fs.existsSync(PACKAGES_DIR)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(PACKAGES_DIR)) {
    const pkgJson = path.join(PACKAGES_DIR, entry, "package.json");
    if (!fs.existsSync(pkgJson)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
      const m = raw["pi-dashboard-plugin"];
      if (m && Array.isArray(m.claims) && m.claims.length > 0) count++;
    } catch {
      // ignore malformed manifests
    }
  }
  return count;
}

const KNOWN_SLOTS = new Set(Object.keys(SLOT_DEFINITIONS));

describe("plugin-registry-populated", () => {
  if (PLUGIN_REGISTRY.length === 0) {
    it.skip("generated registry empty — run `npm run build` first to populate it", () => {});
    return;
  }

  it("at least one entry has at least one claim", () => {
    // Some plugins may ship a manifest with `claims: []` (e.g. flows-plugin
    // during the wire-plugin-registry-into-shell scope-down, where its
    // session-card-* claims are deferred to migrate-flows-jsx-to-slots). What
    // matters for the wiring regression is that the registry is populated
    // overall — i.e. at least one claim reaches the slot consumers.
    const totalClaims = PLUGIN_REGISTRY.reduce((n, e) => n + e.claims.length, 0);
    expect(totalClaims, "PLUGIN_REGISTRY has zero claims overall — wiring missing").toBeGreaterThan(0);
  });

  it("every claim slot is a known SlotId", () => {
    for (const entry of PLUGIN_REGISTRY) {
      for (const claim of entry.claims) {
        expect(
          KNOWN_SLOTS.has(claim.slot),
          `plugin ${entry.manifest.id} claims unknown slot "${claim.slot}"`,
        ).toBe(true);
      }
    }
  });

  it("at least one entry's id matches a workspace package directory", () => {
    const manifestCount = workspacePluginManifestCount();
    if (manifestCount === 0) return; // no plugins in workspace — vacuously OK
    const ids = new Set(PLUGIN_REGISTRY.map(e => e.manifest.id));
    const dirs = fs.readdirSync(PACKAGES_DIR);
    const matched = [...ids].some(id =>
      dirs.some(d => {
        const pkgJson = path.join(PACKAGES_DIR, d, "package.json");
        if (!fs.existsSync(pkgJson)) return false;
        try {
          const m = JSON.parse(fs.readFileSync(pkgJson, "utf-8"))["pi-dashboard-plugin"];
          return m?.id === id;
        } catch {
          return false;
        }
      }),
    );
    expect(matched, `no PLUGIN_REGISTRY entry matched a workspace plugin id`).toBe(true);
  });

  // See change: render-unclaimed-custom-entries (R1).
  it("web-access claims the custom-entry-renderer slot for web-search-results", () => {
    const entry = PLUGIN_REGISTRY.find(e => e.manifest.id === "web-access");
    expect(entry, "web-access missing from the generated registry").toBeTruthy();
    expect(
      entry!.claims.some(
        c => c.slot === "custom-entry-renderer" && c.customType === "web-search-results" && c.pluginId === "web-access",
      ),
    ).toBe(true);
  });
});
