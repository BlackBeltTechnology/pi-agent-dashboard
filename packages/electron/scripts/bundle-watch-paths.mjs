#!/usr/bin/env node
/**
 * bundle-watch-paths.mjs — prints the local bundle freshness watch set, one
 * repo-relative path per line, for `build-installer.sh`:
 *   - `packages/<ws>/src` + `packages/<ws>/package.json` per
 *     `BUNDLED_WORKSPACE_PKGS` entry (parsed from bundle-server.mjs),
 *   - `packages/<id>/src` + `packages/<id>/package.json` per
 *     `packages/server/package.json#piDashboard.bundledPlugins` id,
 *   - `packages/server/package.json`, the built client, the bundler itself.
 * Derived so the shell never re-hardcodes either list (bundled plugins were
 * previously not watched at all).
 * See change: bundle-plugin-third-party-deps (design D6).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBundledPluginIds } from "../../shared/src/runtime-overlay/materialize-plugins.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BUNDLER_REL = "packages/electron/scripts/bundle-server.mjs";

/** `const BUNDLED_WORKSPACE_PKGS = [ ... ]` from bundle-server.mjs (same regex the tests use). */
function readBundledWorkspacePkgs() {
  const src = readFileSync(path.join(REPO_ROOT, BUNDLER_REL), "utf8");
  const block = /const BUNDLED_WORKSPACE_PKGS\s*=\s*\[([\s\S]*?)\]/.exec(src);
  if (!block) throw new Error(`BUNDLED_WORKSPACE_PKGS not found in ${BUNDLER_REL}`);
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const pkgDirs = [
  ...readBundledWorkspacePkgs(),
  ...readBundledPluginIds(path.join(REPO_ROOT, "packages", "server", "package.json")),
];
const paths = new Set();
for (const dir of pkgDirs) {
  paths.add(`packages/${dir}/src`);
  paths.add(`packages/${dir}/package.json`);
}
for (const extra of ["packages/server/package.json", "packages/dist/index.html", BUNDLER_REL]) paths.add(extra);
process.stdout.write(`${[...paths].join("\n")}\n`);
