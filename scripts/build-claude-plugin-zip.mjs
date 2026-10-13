#!/usr/bin/env node
/**
 * build-claude-plugin-zip.mjs — package the Claude plugin for download.
 *
 * Zips `packages/claude-plugin/` so `.claude-plugin/plugin.json` sits at the
 * zip root (the layout claude.ai "Upload plugin" expects) and writes
 * `<out>/pi-dashboard-claude-plugin-<version>.zip`. Refuses, writing nothing,
 * when `plugin.json`'s version differs from `--version`, so a stale plugin
 * never ships under a newer tag.
 *
 * Usage:
 *   node scripts/build-claude-plugin-zip.mjs --version <v> [--out <dir>]
 *
 * Needs the `zip` CLI (present on GitHub's ubuntu runners and macOS).
 *
 * See change: add-claude-code-plugin (design D10).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = path.join(REPO_ROOT, "packages", "claude-plugin");
const MANIFEST = path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json");

function fail(message) {
  console.error(`build-claude-plugin-zip: ${message}`);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const version = arg("--version");
if (!version) fail("--version <version> is required");
const outDir = path.resolve(arg("--out") ?? path.join(REPO_ROOT, "claude-plugin-dist"));

const manifestVersion = JSON.parse(fs.readFileSync(MANIFEST, "utf8")).version;
if (manifestVersion !== version) {
  fail(`plugin.json version ${manifestVersion} does not match release version ${version}`);
}

fs.mkdirSync(outDir, { recursive: true });
const zipPath = path.join(outDir, `pi-dashboard-claude-plugin-${version}.zip`);
fs.rmSync(zipPath, { force: true });

// -X: no extra file attributes (reproducible); -x: never ship Finder metadata.
const r = spawnSync("zip", ["-r", "-X", "-q", zipPath, ".", "-x", "*.DS_Store"], {
  cwd: PLUGIN_DIR,
  encoding: "utf8",
});
if (r.error || r.status !== 0) {
  fs.rmSync(zipPath, { force: true });
  fail(`zip failed: ${r.error?.message ?? r.stderr}`);
}
console.log(`wrote ${path.relative(REPO_ROOT, zipPath)}`);
