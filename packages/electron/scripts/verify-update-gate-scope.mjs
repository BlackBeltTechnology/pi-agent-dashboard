#!/usr/bin/env node
/**
 * CI wrapper: assert the macOS update gate is present AND correctly scoped.
 *
 * Usage:  node scripts/verify-update-gate-scope.mjs <out/make dir> <platform>
 *
 * Asserted against the EMITTED metadata, never a build-config key — the config
 * key `mac.minimumSystemVersion` is a plausible-looking no-op under
 * `--prepackaged` (design.md Decision 5, Trap 2).
 *
 * Two directions, with opposite hazards:
 *   - `latest-mac.yml` MUST carry the value. Missing → fail-OPEN: below-floor
 *     macOS clients are offered an artifact launchd refuses, and the recurring
 *     update check retries forever.
 *   - `latest-linux.yml` / `latest.yml` MUST NOT carry it. Present → fail-CLOSED:
 *     `checkIfUpdateSupported` applies no platform guard, so a Linux kernel
 *     (`6.5.0`) or Windows version (`10.0.19045`) is compared against the Darwin
 *     value and EVERY client on that platform loses updates.
 *
 * Non-vacuity: a darwin invocation with no `latest-mac.yml` FAILS rather than
 * passing on an empty scan.
 *
 * Node rather than bash so the win32 legs do not need a shell — the repo's
 * `eliminate-bash-on-windows-runners` invariant. See change: upgrade-electron-runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { UPDATE_MINIMUM_SYSTEM_VERSION } from "./macos-floor.mjs";

const [outDir, platform] = process.argv.slice(2);

if (!outDir || !platform) {
  console.error(
    "::error::verify-update-gate-scope.mjs: usage <out/make dir> <platform>",
  );
  process.exit(1);
}

/** Recursively collect every `latest*.yml` under `dir`. */
function findMetadata(dir) {
  const found = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findMetadata(full));
    else if (/^latest.*\.yml$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Read the root-level `minimumSystemVersion` scalar, or "" when absent. */
function readGate(file) {
  const match = fs
    .readFileSync(file, "utf8")
    .match(/^minimumSystemVersion:[ \t]*(.*)$/m);
  return match ? match[1].trim() : "";
}

console.log(`Expected minimumSystemVersion: ${UPDATE_MINIMUM_SYSTEM_VERSION}`);

const files = findMetadata(outDir).sort();
let failed = false;
let checkedMac = false;

for (const file of files) {
  const base = path.basename(file);
  const value = readGate(file);

  if (base === "latest-mac.yml") {
    checkedMac = true;
    if (value !== UPDATE_MINIMUM_SYSTEM_VERSION) {
      console.log(
        `::error::${file} has minimumSystemVersion='${value}', expected '${UPDATE_MINIMUM_SYSTEM_VERSION}'. ` +
          "Below-floor macOS clients would be offered an artifact their OS refuses to launch.",
      );
      failed = true;
    } else {
      console.log(`  OK ${base} carries minimumSystemVersion: ${value}`);
    }
  } else if (value !== "") {
    console.log(
      `::error::${file} must NOT carry minimumSystemVersion (found '${value}'). ` +
        "checkIfUpdateSupported applies no platform guard, so this compares a non-Darwin OS " +
        "version against a Darwin value and denies updates to every client on this platform.",
    );
    failed = true;
  } else {
    console.log(`  OK ${base} correctly carries no minimumSystemVersion`);
  }
}

if (platform === "darwin" && !checkedMac) {
  console.log(
    "::error::darwin leg produced no latest-mac.yml — the update gate is unverified",
  );
  failed = true;
}

if (files.length === 0) {
  console.log(`  (no latest*.yml under ${outDir})`);
}

process.exit(failed ? 1 : 0);
