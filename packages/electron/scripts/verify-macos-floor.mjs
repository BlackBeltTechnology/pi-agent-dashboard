#!/usr/bin/env node
/**
 * CI wrapper: otool the packaged main Mach-O and enforce the macOS floor.
 *
 * Usage:  node scripts/verify-macos-floor.mjs <path-to-mach-o> [expectedMajor]
 *
 * The predicates live in ./macos-floor.mjs so they are unit-testable without a
 * packaged app (test-plan E4 / E5 / X3). This file only does the I/O and the
 * GitHub-annotation mapping, in two phases:
 *
 * 1. Extractor canary over the installed Electron prebuilt
 *    (`<electron-dir>/dist/Electron.app/Contents/MacOS/Electron`, dir from
 *    pi-dashboard-resolve-tool.cjs). `checkCanary` — EVERY non-ok is fatal:
 *      ok                                        → continue
 *      blind-extractor / non-numeric / mismatch  → ::error:: exit 1
 *      sample-missing / exec-failed              → ::error:: exit 1
 *
 * 2. Produced binary (argv[2]). `producedBinaryVerdict`:
 *      ok               → exit 0
 *      not-extractable  → ::warning:: exit 0   (robust to future Mach-O formats)
 *      non-numeric      → ::warning:: exit 0
 *      otool failure    → ::warning:: exit 0
 *      mismatch         → ::error::   exit 1
 *
 * Phase-2 tolerance is safe only because phase 1 proved the extractor sees.
 *
 * See change: upgrade-electron-runtime, fix-ci-pipeline-followups.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MACOS_FLOOR_MINOS_MAJOR,
  checkCanary,
  checkMinosFloor,
  producedBinaryVerdict,
} from "./macos-floor.mjs";

const [binary, expectedMajorArg] = process.argv.slice(2);

if (!binary) {
  console.error("::error::verify-macos-floor.mjs: no binary path given");
  process.exit(1);
}

let expectedMajor = MACOS_FLOOR_MINOS_MAJOR;
if (expectedMajorArg !== undefined) {
  expectedMajor = Number(expectedMajorArg);
  if (!Number.isInteger(expectedMajor)) {
    // Silently coercing a typo to NaN would make every comparison mismatch
    // (noisy) or, worse, be misread as a deliberate override.
    console.error(
      `::error::verify-macos-floor.mjs: expectedMajor must be an integer, got '${expectedMajorArg}'`,
    );
    process.exit(1);
  }
}

// ── Phase 1: extractor canary on the installed Electron prebuilt ──────────
const RESOLVER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../shared/bin/pi-dashboard-resolve-tool.cjs",
);
let samplePath = "<electron dir unresolved>/dist/Electron.app/Contents/MacOS/Electron";
let sampleMissing = false;
try {
  const electronDir = execFileSync(process.execPath, [RESOLVER, "electron"], {
    encoding: "utf8",
  }).trim();
  samplePath = path.join(electronDir, "dist/Electron.app/Contents/MacOS/Electron");
  sampleMissing = !fs.existsSync(samplePath);
} catch {
  sampleMissing = true;
}

let canaryOutput = "";
let canaryExecFailed = false;
if (!sampleMissing) {
  try {
    canaryOutput = execFileSync("otool", ["-l", samplePath], { encoding: "utf8" });
  } catch (err) {
    canaryExecFailed = String(err?.message ?? err);
  }
}
const canary = checkCanary({
  otoolOutput: canaryOutput,
  execFailed: canaryExecFailed,
  sampleMissing,
  samplePath,
  expectedMajor,
});
if (canary.exitCode !== 0) {
  console.log(`::error::${canary.message}`);
  process.exit(1);
}
console.log(`✓ ${canary.message}`);

// ── Phase 2: the produced binary ──────────────────────────────────────────
let otoolOutput = "";
try {
  otoolOutput = execFileSync("otool", ["-l", binary], { encoding: "utf8" });
} catch (err) {
  console.log(
    `::warning::Could not run 'otool -l ${binary}' (${err?.message ?? err}) — skipping the floor check`,
  );
  process.exit(0);
}

const result = checkMinosFloor({ otoolOutput, expectedMajor });
console.log(`  Mach-O minos = ${result.values.join(", ") || "<not-found>"}`);

const verdict = producedBinaryVerdict(result);
if (verdict.level !== "ok") {
  console.log(`::${verdict.level}::${result.message}`);
  process.exit(verdict.exitCode);
}
console.log(`✓ ${result.message}`);
