#!/usr/bin/env node
/**
 * assert-bundled-plugins-complete.mjs — built-bundle plugin-completeness gate.
 *
 * Complements the SOURCE-list guard
 * (packages/shared/src/__tests__/bundled-plugins-complete.test.ts, which
 * asserts BUNDLED_PLUGINS in bundle-server.mjs == the runtime plugins in
 * packages/*). THIS gate asserts the *built bundle on disk* actually contains
 * every runtime plugin: after `bundle-server.mjs` runs, every non-fixture
 * runtime plugin discoverable in packages/* MUST have a directory under the
 * bundle's `resources/plugins/`. It flags `kb-plugin`-style omissions at build
 * time, on every leg, before the artifact is uploaded.
 *
 * Runtime-plugin predicate (task 2.2 — a DATA decision, not a hardcoded
 * denylist): a package is a bundled runtime plugin iff its package.json has a
 * `pi-dashboard-plugin` manifest AND `pi-dashboard-plugin.fixture !== true`.
 * This naturally excludes fixtures (demo-plugin) and the non-plugin authoring
 * / runtime packages (dashboard-plugin-skill, dashboard-plugin-runtime) which
 * carry no manifest — so kb-plugin inclusion is decided by manifest presence,
 * never by editing this file.
 *
 * Paths are env-overridable for unit testing:
 *   PACKAGES_DIR       — source workspaces root      (default <repo>/packages)
 *   BUNDLE_PLUGINS_DIR — built bundle plugins dir     (default
 *                        <repo>/packages/electron/resources/server/resources/plugins)
 *
 * Exit non-zero listing any missing plugin. See change:
 * add-nightly-verdaccio-build.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ELECTRON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(ELECTRON_DIR, "..", "..");

/** Dir names in `packagesDir` that are non-fixture runtime plugins. */
export function discoverRuntimePlugins(packagesDir) {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => {
      const pj = join(packagesDir, e.name, "package.json");
      if (!existsSync(pj)) return false;
      let raw;
      try {
        raw = JSON.parse(readFileSync(pj, "utf8"));
      } catch {
        return false;
      }
      const manifest = raw["pi-dashboard-plugin"];
      return manifest != null && manifest.fixture !== true;
    })
    .map((e) => e.name)
    .sort();
}

/** Plugin dir names present in the built bundle's resources/plugins/. */
export function readBundledPlugins(bundlePluginsDir) {
  if (!existsSync(bundlePluginsDir)) return [];
  return readdirSync(bundlePluginsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => e.name)
    .filter((name) => {
      const p = join(bundlePluginsDir, name);
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/** Returns `{ missing, expected, bundled }`. `missing` = expected − bundled. */
export function computeMissing(packagesDir, bundlePluginsDir) {
  const expected = discoverRuntimePlugins(packagesDir);
  const bundled = new Set(readBundledPlugins(bundlePluginsDir));
  const missing = expected.filter((p) => !bundled.has(p));
  return { missing, expected, bundled: [...bundled].sort() };
}

function main() {
  const packagesDir = process.env.PACKAGES_DIR || join(REPO_ROOT, "packages");
  const bundlePluginsDir =
    process.env.BUNDLE_PLUGINS_DIR ||
    join(ELECTRON_DIR, "resources", "server", "resources", "plugins");

  const { missing, expected, bundled } = computeMissing(
    packagesDir,
    bundlePluginsDir,
  );

  console.log(`Expected runtime plugins (${expected.length}): ${expected.join(", ")}`);
  console.log(`Bundled plugins (${bundled.length}): ${bundled.join(", ") || "(none)"}`);

  if (missing.length > 0) {
    console.error(
      `::error::Bundle is missing ${missing.length} runtime plugin(s): ${missing.join(", ")}. ` +
        `The built bundle at '${bundlePluginsDir}' does not contain every non-fixture ` +
        `runtime plugin found in '${packagesDir}'. Add each missing dir to BUNDLED_PLUGINS ` +
        `in packages/electron/scripts/bundle-server.mjs (kb-plugin-style omission).`,
    );
    process.exit(1);
  }
  console.log(`✓ Bundle contains all ${expected.length} runtime plugin(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
