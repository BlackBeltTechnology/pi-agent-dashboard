/**
 * First-party plugin materialization — ONE list, ONE copy routine.
 *
 * `packages/server/package.json#piDashboard.bundledPlugins` declares the
 * first-party plugin ids (monorepo package dir names). Both the Electron
 * bundle (`bundle-server.mjs`) and a staged runtime overlay copy exactly those
 * into `<runtime>/resources/plugins/<id>/`, where `findBundledPluginsDir()`
 * finds them by walking up from the plugin runtime.
 *
 * Plain ESM JavaScript (types in `materialize-plugins.d.mts`) so the build
 * script, which runs under plain Node, can import it.
 *
 * See change: electron-runtime-overlay-updates (D1, D2; test-plan E22).
 */
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Read `piDashboard.bundledPlugins` from a server package.json. Throws when
 * the field is missing or not a string array — a silent empty list would ship
 * a runtime with zero plugins.
 * @param {string} serverPackageJsonPath
 * @returns {string[]}
 */
export function readBundledPluginIds(serverPackageJsonPath) {
  const pkg = JSON.parse(readFileSync(serverPackageJsonPath, "utf8"));
  const ids = pkg?.piDashboard?.bundledPlugins;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string" && id !== "")) {
    throw new Error(
      `${serverPackageJsonPath}: piDashboard.bundledPlugins must be a non-empty string array`,
    );
  }
  return ids;
}

// Skip the package's OWN nested node_modules (pnpm store symlinks in the
// monorepo; nested deps in an overlay). Tested RELATIVE to the package dir:
// an overlay plugin itself lives under node_modules/. Split on both
// separators (NOT path.sep) so a Windows `\` path is handled on every host.
// See change: adopt-pnpm-for-dev-ci (design.md §D4), electron-runtime-overlay-updates.
const excludeNestedNodeModules = (/** @type {string} */ pkgDir) => (/** @type {string} */ src) =>
  !path.relative(pkgDir, src).split(/[\\/]/).includes("node_modules");

/**
 * Copy each declared plugin package into `destDir/<id>/`. Skips ids whose
 * source has no package.json and fixture plugins (`pi-dashboard-plugin.fixture
 * === true`). Returns the ids actually materialized, in declaration order.
 * @param {{ ids: string[], resolveSource: (id: string) => string | null, destDir: string }} opts
 * @returns {string[]}
 */
export function materializeBundledPlugins({ ids, resolveSource, destDir }) {
  mkdirSync(destDir, { recursive: true });
  const done = [];
  for (const id of ids) {
    const src = resolveSource(id);
    if (!src || !existsSync(path.join(src, "package.json"))) continue;
    try {
      const raw = JSON.parse(readFileSync(path.join(src, "package.json"), "utf8"));
      if (raw?.["pi-dashboard-plugin"]?.fixture === true) continue;
    } catch {
      continue; // unparsable manifest — skip defensively (pre-existing rule)
    }
    cpSync(src, path.join(destDir, id), {
      recursive: true,
      dereference: false,
      filter: excludeNestedNodeModules(src),
    });
    done.push(id);
  }
  return done;
}
