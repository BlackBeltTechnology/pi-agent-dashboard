#!/usr/bin/env node
/**
 * Guard: no machine-specific absolute path may appear in a `packages[].source`
 * of a committed `.pi/settings.json`.
 *
 * Why a guard and not a convention: the absolute path this fixes was not a
 * typo. `pi install <path>` RESOLVES a local source to an absolute path before
 * writing it (package identity for local sources is "resolved absolute path"),
 * and `pi config` rewrites the same file. So the machine-specific form is what
 * the tooling produces by default, and a one-time correction regresses the
 * next time anyone runs either command. The repo carried
 * `/Users/robson/Project/pi-agent-dashboard` long enough for kb-extension to
 * silently not load for every other developer (#371).
 *
 * Relative sources resolve against the directory of the settings file they
 * appear in, so `".."` from `.pi/settings.json` is the repo root — portable
 * for everyone.
 *
 * `source` also legally carries non-path specifiers (`npm:`, `git:`, `https://`,
 * `ssh://`); those are never filesystem paths and are left alone.
 *
 * Emits structured findings; exits 1 when any violation exists.
 * Run: node scripts/check-pi-settings-paths.mjs
 *
 * See issue #371.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Settings files this repo commits. Absolute paths are only a problem in ones we ship. */
export const CHECKED_FILES = [".pi/settings.json"];

/** The one-line correction printed on every violation. */
export const CORRECTION = '"source": ".."  (relative to the .pi/ directory holding settings.json)';

const NON_PATH_SPECIFIER = /^(?:npm:|git:|https?:\/\/|ssh:\/\/|github:)/i;

/** POSIX (`/x`), Windows (`C:\x`, `\\server\share`) and home-relative (`~/x`). */
function isMachineSpecific(source) {
  if (NON_PATH_SPECIFIER.test(source)) return false;
  return source.startsWith("/") || source.startsWith("~") || /^[A-Za-z]:[\\/]/.test(source) || source.startsWith("\\\\");
}

/**
 * Findings for one settings file's raw JSON text.
 * Returns `[{ file, source, reason }]`; empty when clean.
 */
export function absoluteSourceViolations(file, raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return [{ file, source: null, reason: `could not parse JSON: ${err.message}` }];
  }

  const packages = Array.isArray(parsed?.packages) ? parsed.packages : [];
  const violations = [];

  for (const entry of packages) {
    // The bare-string form is a specifier, not an object with a `source`.
    const source = typeof entry === "string" ? entry : entry?.source;
    if (typeof source !== "string") continue;
    if (isMachineSpecific(source)) {
      violations.push({ file, source, reason: "machine-specific absolute path" });
    }
  }

  return violations;
}

function main() {
  const violations = [];

  for (const rel of CHECKED_FILES) {
    let raw;
    try {
      raw = readFileSync(resolve(REPO_ROOT, rel), "utf-8");
    } catch {
      continue; // not every checkout has every settings file
    }
    violations.push(...absoluteSourceViolations(rel, raw));
  }

  if (violations.length === 0) {
    console.log("check-pi-settings-paths: OK");
    return 0;
  }

  for (const v of violations) {
    const what = v.source ? `${v.source} — ${v.reason}` : v.reason;
    console.error(`error: ${v.file}: ${what}`);
  }
  console.error(`\nUse a path relative to the settings file instead:\n  ${CORRECTION}`);
  console.error(
    "\nNote: `pi install <path>` and `pi config` write the ABSOLUTE form. After running either,\n" +
      "re-check this file before committing.",
  );
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
