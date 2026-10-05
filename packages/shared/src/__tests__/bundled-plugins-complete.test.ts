/**
 * Repo-level invariant: every non-fixture *runtime plugin* in `packages/*`
 * MUST be listed in `packages/server/package.json#piDashboard.bundledPlugins`
 * (the single first-party plugin list, read by
 * `packages/electron/scripts/bundle-server.mjs` and the runtime-overlay
 * stager — see change: electron-runtime-overlay-updates), and every entry in
 * that list MUST correspond to an existing non-fixture runtime plugin.
 *
 * Why: `bundle-server.mjs` copies each `BUNDLED_PLUGINS` dir into the
 * Electron bundle's `resources/plugins/`. A runtime plugin added to
 * `packages/` but forgotten in that array ships an installer with the
 * plugin silently missing — exactly what happened to `kb-plugin` (present
 * on disk, omitted from `BUNDLED_PLUGINS`, so every fresh Electron install
 * had no Knowledge Base surface). The reverse — a stale entry for a plugin
 * deleted from `packages/` (as happened with `honcho-plugin`) — leaves the
 * source list lying about what the bundle contains.
 *
 * Criterion for "runtime plugin that must be bundled":
 *   - the package.json has a `pi-dashboard-plugin` manifest, AND
 *   - `pi-dashboard-plugin.fixture !== true`.
 * A plugin that is ALSO a bundle workspace (BUNDLED_WORKSPACE_PKGS, e.g.
 * mcp-client-plugin — a direct server dep) must still be listed: the loader
 * discovers plugins from resources/plugins/, not from node_modules.
 *
 * If this test fails: add the missing plugin dir to `piDashboard.bundledPlugins`
 * (kb-plugin case), or remove the stale entry (honcho case).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { readBundledPluginIds } from "../runtime-overlay/materialize-plugins.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");
const SERVER_PKG_JSON = path.join(REPO_ROOT, "packages", "server", "package.json");

/** Dir names in packages/* that are non-fixture runtime plugins. */
function discoverRuntimePluginDirs(): string[] {
  return fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => {
      const pkgJson = path.join(PACKAGES_DIR, e.name, "package.json");
      if (!fs.existsSync(pkgJson)) return false;
      const raw = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
      const manifest = raw["pi-dashboard-plugin"];
      return manifest != null && manifest.fixture !== true;
    })
    .map((e) => e.name)
    .sort();
}

describe("piDashboard.bundledPlugins completeness", () => {
  const bundled = readBundledPluginIds(SERVER_PKG_JSON);
  const expected = discoverRuntimePluginDirs();

  it("lists every non-fixture runtime plugin found in packages/*", () => {
    const missing = expected.filter((p) => !bundled.includes(p));
    expect(missing, `runtime plugins missing from BUNDLED_PLUGINS: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no stale entry pointing at a non-existent / non-runtime plugin", () => {
    const stale = bundled.filter((p) => !expected.includes(p));
    expect(stale, `stale BUNDLED_PLUGINS entries (no matching runtime plugin): ${stale.join(", ")}`).toEqual([]);
  });

  it("every bundled plugin publishes repository.directory = packages/<id> (runtime-overlay stager maps npm packages back to ids by it)", () => {
    // See change: electron-runtime-overlay-updates (runtime-stager.ts).
    const wrong = bundled.filter((id) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGES_DIR, id, "package.json"), "utf8"));
      return pkg?.repository?.directory !== `packages/${id}`;
    });
    expect(wrong).toEqual([]);
  });

  it("includes kb-plugin", () => {
    // Explicit pin: kb-plugin regressed once (present on disk, omitted here).
    expect(bundled).toContain("kb-plugin");
  });

  it("excludes fixture-only plugins (e.g. demo-plugin)", () => {
    expect(bundled).not.toContain("demo-plugin");
  });
});
