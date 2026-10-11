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
import { collectPluginRuntimeDeps, readBundledPluginIds } from "../runtime-overlay/materialize-plugins.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");
const SERVER_PKG_JSON = path.join(REPO_ROOT, "packages", "server", "package.json");
const BUNDLE_SCRIPT = path.join(REPO_ROOT, "packages", "electron", "scripts", "bundle-server.mjs");

type Pkg = { name: string; dependencies?: Record<string, string> };
const readPkg = (dir: string): Pkg =>
  JSON.parse(fs.readFileSync(path.join(PACKAGES_DIR, dir, "package.json"), "utf8"));

/** `const BUNDLED_WORKSPACE_PKGS = [ ... ]` from bundle-server.mjs. */
function readBundledWorkspacePkgs(): string[] {
  const src = fs.readFileSync(BUNDLE_SCRIPT, "utf8");
  const block = /const BUNDLED_WORKSPACE_PKGS\s*=\s*\[([\s\S]*?)\]/.exec(src);
  if (!block) throw new Error("BUNDLED_WORKSPACE_PKGS not found in bundle-server.mjs");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** First-party (`@blackbelt-technology/*`) runtime dependency names of a package dir. */
const firstPartyDeps = (dir: string): string[] =>
  Object.keys(readPkg(dir).dependencies ?? {}).filter((d) => d.startsWith("@blackbelt-technology/"));

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

  // Bundled plugins are copied to resources/plugins/<id>/ WITHOUT node_modules;
  // their imports resolve only via resources/server/node_modules. A first-party
  // dep not installed there from workspace source fails at load time
  // ("Failed to load plugin ... Cannot find module '@blackbelt-technology/...'").
  it("every first-party dep of a bundled plugin (transitively) is a bundled workspace package", () => {
    const nameToDir = new Map(
      fs
        .readdirSync(PACKAGES_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(PACKAGES_DIR, e.name, "package.json")))
        .map((e) => [readPkg(e.name).name, e.name] as const),
    );
    const workspaces = new Set(readBundledWorkspacePkgs());
    const missing = new Set<string>();
    const seen = new Set<string>();
    const queue = [...bundled, ...workspaces];
    while (queue.length > 0) {
      const dir = queue.shift()!;
      if (seen.has(dir)) continue;
      seen.add(dir);
      for (const dep of firstPartyDeps(dir)) {
        const depDir = nameToDir.get(dep);
        if (!depDir) continue; // not a workspace package — comes from the registry
        if (!workspaces.has(depDir)) missing.add(`${depDir} (needed by ${dir})`);
        queue.push(depDir);
      }
    }
    expect([...missing].sort(), "add these dirs to BUNDLED_WORKSPACE_PKGS in bundle-server.mjs").toEqual([]);
  });

  // Third-party plugin deps are unioned into the bundle root package.json.
  // See change: bundle-plugin-third-party-deps (test-plan #E13).
  it("the real bundled plugins' third-party deps union without conflict and cover the server-reachable gaps", () => {
    const union = collectPluginRuntimeDeps({
      ids: bundled,
      resolveSource: (id) => path.join(PACKAGES_DIR, id),
      workspaceManifests: readBundledWorkspacePkgs().map((dir) => readPkg(dir)),
    });
    for (const dep of ["oauth4webapi", "yaml", "debug", "discord.js"]) expect(union).toHaveProperty(dep);
    expect(Object.keys(union).filter((d) => d.startsWith("@blackbelt-technology/"))).toEqual([]);
  });

  it("includes kb-plugin", () => {
    // Explicit pin: kb-plugin regressed once (present on disk, omitted here).
    expect(bundled).toContain("kb-plugin");
  });

  it("excludes fixture-only plugins (e.g. demo-plugin)", () => {
    expect(bundled).not.toContain("demo-plugin");
  });
});
