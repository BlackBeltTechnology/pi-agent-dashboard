#!/usr/bin/env node
/**
 * CI wrapper: otool the packaged main Mach-O and enforce the macOS floor.
 *
 * Usage:  node scripts/verify-macos-floor.mjs <path-to-mach-o> [expectedMajor]
 *
 * The predicate itself lives in ./macos-floor.mjs so it is unit-testable
 * without a packaged app (test-plan E4 / E5 / X3). This file only does the I/O
 * and the GitHub-annotation mapping:
 *
 *   ok               → exit 0
 *   not-extractable  → ::warning:: exit 0   (robust to future Mach-O formats)
 *   non-numeric      → ::warning:: exit 0
 *   mismatch         → ::error::   exit 1
 *
 * See change: upgrade-electron-runtime.
 */
import { execFileSync } from "node:child_process";
import { MACOS_FLOOR_MINOS_MAJOR, checkMinosFloor } from "./macos-floor.mjs";

const [binary, expectedMajorArg] = process.argv.slice(2);

if (!binary) {
  console.error("::error::verify-macos-floor.mjs: no binary path given");
  process.exit(1);
}

const expectedMajor = expectedMajorArg
  ? Number(expectedMajorArg)
  : MACOS_FLOOR_MINOS_MAJOR;

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

if (result.status === "mismatch") {
  console.log(`::error::${result.message}`);
  process.exit(1);
}
if (result.status !== "ok") {
  console.log(`::warning::${result.message}`);
  process.exit(0);
}
console.log(`✓ ${result.message}`);
