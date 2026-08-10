/**
 * Repo-level invariant: every non-fixture *runtime plugin* in `packages/*`
 * MUST be listed in the `BUNDLED_PLUGINS` array of
 * `packages/electron/scripts/bundle-server.mjs`, and every entry in that
 * array MUST correspond to an existing non-fixture runtime plugin.
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
 *   - `pi-dashboard-plugin.fixture !== true`, AND
 *   - the dir is not bundled as a workspace package (BUNDLED_WORKSPACE_PKGS).
 *
 * If this test fails: add the missing plugin dir to `BUNDLED_PLUGINS`
 * (kb-plugin case), or remove the stale entry (honcho case).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");
const BUNDLE_SCRIPT = path.join(
  REPO_ROOT,
  "packages",
  "electron",
  "scripts",
  "bundle-server.mjs",
);

/** Extract a `const NAME = [ "a", "b" ]` string-literal array from a source file. */
function readStringArray(source: string, name: string): string[] {
  const block = new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(
    source,
  );
  if (!block) throw new Error(`${name} array not found in bundle-server.mjs`);
  return [...block[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

/** Dir names in packages/* that are non-fixture runtime plugins. */
function discoverRuntimePluginDirs(excludeWorkspacePkgs: string[]): string[] {
  const exclude = new Set(excludeWorkspacePkgs);
  return fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !exclude.has(e.name))
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

describe("bundle-server BUNDLED_PLUGINS completeness", () => {
  const source = fs.readFileSync(BUNDLE_SCRIPT, "utf8");
  const bundled = readStringArray(source, "BUNDLED_PLUGINS");
  const workspacePkgs = readStringArray(source, "BUNDLED_WORKSPACE_PKGS");
  const expected = discoverRuntimePluginDirs(workspacePkgs);

  it("lists every non-fixture runtime plugin found in packages/*", () => {
    const missing = expected.filter((p) => !bundled.includes(p));
    expect(missing, `runtime plugins missing from BUNDLED_PLUGINS: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no stale entry pointing at a non-existent / non-runtime plugin", () => {
    const stale = bundled.filter((p) => !expected.includes(p));
    expect(stale, `stale BUNDLED_PLUGINS entries (no matching runtime plugin): ${stale.join(", ")}`).toEqual([]);
  });

  it("includes kb-plugin", () => {
    // Explicit pin: kb-plugin regressed once (present on disk, omitted here).
    expect(bundled).toContain("kb-plugin");
  });

  it("excludes fixture-only plugins (e.g. demo-plugin)", () => {
    expect(bundled).not.toContain("demo-plugin");
  });
});
