#!/usr/bin/env node
/**
 * ensure-macos-alias.mjs — compile the `macos-alias` native module
 * (`build/Release/volume.node`) required by `@electron-forge/maker-dmg`
 * (appdmg → electron-installer-dmg → macos-alias) on darwin.
 *
 * See change: fix-darwin-dmg-maker-macos-alias.
 *
 * Modes:
 *   (default — postinstall auto-heal)  Rebuild only when `volume.node` is
 *     absent. Never blocks `pnpm install`: always exits 0, even on failure.
 *   --rebuild  (build-installer.sh gate)  Always attempt the rebuild; exit
 *     non-zero when `volume.node` is still absent afterward so the build
 *     fails loudly BEFORE `electron-forge make` emits a confusing stack trace.
 *
 * Non-darwin hosts (linux / win32) exit 0 immediately without output.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";

const FORCE_REBUILD = process.argv.includes("--rebuild");

function log(msg) {
  process.stdout.write(`[ensure-macos-alias] ${msg}\n`);
}

// Skip silently off darwin — Linux / Windows contributors never need this.
if (process.platform !== "darwin") {
  process.exit(0);
}

const require = createRequire(import.meta.url);

/** Locate the hoisted `macos-alias` package directory, or null if absent. */
function resolveMacosAliasDir() {
  try {
    return path.dirname(require.resolve("macos-alias/package.json"));
  } catch {
    return null;
  }
}

const dir = resolveMacosAliasDir();
if (!dir) {
  if (FORCE_REBUILD) {
    // Build-gate mode: an unresolvable macos-alias means the DMG maker will
    // crash at forge make. Fail loudly here instead of falling through.
    log(
      "ERROR: Could not resolve macos-alias. Re-run `pnpm install`, or install " +
        "Xcode Command Line Tools (`xcode-select --install`) and retry.",
    );
    process.exit(1);
  }
  // Postinstall mode: not installed (e.g. maker-dmg pruned) — nothing to build.
  process.exit(0);
}

const volumePath = path.join(dir, "build", "Release", "volume.node");

// Auto-heal mode: already built → silent success.
if (!FORCE_REBUILD && existsSync(volumePath)) {
  process.exit(0);
}

// `npm rebuild macos-alias --prefix <P>` resolves `<P>/node_modules/macos-alias`.
// Under pnpm: dir = .pnpm/macos-alias@x/node_modules/macos-alias → prefix two up.
// Under classic npm: dir = node_modules/macos-alias → prefix two up = pkg root.
const prefix = path.resolve(dir, "..", "..");

log(`rebuilding macos-alias (prefix=${prefix})...`);
// argv form (shell:false) — no shell interpolation of the resolved path.
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
spawnSync(npm, ["rebuild", "macos-alias", "--prefix", prefix, "--foreground-scripts"], {
  stdio: "inherit",
  shell: false,
});
// Outcome judged by the existence re-check below, not the exit code.

if (existsSync(volumePath)) {
  log("volume.node built successfully.");
  process.exit(0);
}

const suggestion =
  "Could not build macos-alias volume.node. Install Xcode Command Line Tools " +
  "(`xcode-select --install`) and retry, or re-run `pnpm install`.";

if (FORCE_REBUILD) {
  log(`ERROR: ${suggestion}`);
  process.exit(1);
}

// Postinstall mode: non-fatal so `pnpm install` is never blocked.
log(suggestion);
process.exit(0);
