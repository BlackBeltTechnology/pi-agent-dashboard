#!/usr/bin/env node
/**
 * lint-runtime-lock.mjs — check a freshly generated `runtime-lock.json`
 * against the repo's bundled workspaces BEFORE the server is published.
 *
 *   node scripts/lint-runtime-lock.mjs --version X [--lock FILE]
 *
 * Runs the same pure rebase the Electron bundle step runs (release-lock mode),
 * as a check only. Any lock-level defect — an unmapped first-party entry, a
 * third-party entry without integrity or on a non-https source, a plugin-union
 * mismatch — exits non-zero. A publish cannot be undone, so the defect must
 * surface before `npm publish` of the server (`publish.yml`) and before the
 * nightly publishes it to Verdaccio.
 *
 * See change: pin-electron-bundle-dependency-tree (design D6).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readBundledWorkspaceDirs, readBundledWorkspaces, rebaseRuntimeLock } from "../packages/electron/scripts/lib/release-lock.mjs";
import { bundledPluginPackages, parseFlags, pluginRuntimeDeps } from "./lib/runtime-release.mjs";

/**
 * Lint `lock` for release X against the repo at `repoRoot`.
 * Throws on any defect; returns the rebase stats.
 */
export function lintRuntimeLock({ repoRoot, lock, version }) {
  const workspaces = readBundledWorkspaces(repoRoot, readBundledWorkspaceDirs(repoRoot));
  const bundledPlugins = new Set(bundledPluginPackages(repoRoot).map((p) => p.name));
  return rebaseRuntimeLock(lock, { workspaces, bundledPlugins, pluginUnion: pluginRuntimeDeps(repoRoot), version }).stats;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const version = typeof flags.version === "string" ? flags.version : process.env.VERSION;
  if (!version) throw new Error("--version X is required");
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const file = typeof flags.lock === "string" ? flags.lock : join(repoRoot, "packages", "server", "runtime-lock.json");
  const stats = lintRuntimeLock({ repoRoot, lock: JSON.parse(readFileSync(file, "utf8")), version });
  console.log(`runtime-lock lint OK for ${version}: ${stats.linked} workspaces linked, ${stats.dropped} first-party entries dropped, ${stats.thirdParty} third-party entries checked`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`::error::lint-runtime-lock: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
