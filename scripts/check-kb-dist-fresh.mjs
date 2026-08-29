#!/usr/bin/env node
// kb dist freshness gate (design D1, change fix-kb-eval-measurement-integrity).
// Recomputes srcHash + tsconfigHash from the working tree and compares them
// with the COMMITTED engine-fingerprint.json. A commit that edits packages/kb
// src (or its tsconfig chain) without rebuilding leaves a stale fingerprint
// IN the commit — observable here, in CI, where a build-then-check would be
// vacuous (dist/ is gitignored, so a CI build is fresh by construction).
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FINGERPRINT_MALFORMED, computeSrcHash, computeTsconfigHash, readCommittedFingerprint } from "./lib/kb-engine-fingerprint.mjs";

// --pkg <dir>: sandbox override for the fault-injection tests; defaults to the
// repo's packages/kb.
const args = process.argv.slice(2);
const pkgIdx = args.indexOf("--pkg");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgRoot = pkgIdx >= 0 ? resolve(args[pkgIdx + 1]) : join(repoRoot, "packages", "kb");

const MANDATE = "the `kb` bin and the extension would run different engines — rebuild and commit the fingerprint";

const fp = readCommittedFingerprint(pkgRoot);
if (!fp || fp === FINGERPRINT_MALFORMED) {
  console.error(`[check-kb-dist-fresh] ${pkgRoot}: ${fp ? "malformed" : "no committed"} engine-fingerprint.json — ${MANDATE}`);
  process.exit(1);
}
const srcHash = computeSrcHash(pkgRoot);
const tsconfigHash = computeTsconfigHash(pkgRoot);
const staleSrc = srcHash !== fp.srcHash;
const staleTsconfig = tsconfigHash !== null && fp.tsconfigHash !== undefined && tsconfigHash !== fp.tsconfigHash;
if (staleSrc || staleTsconfig) {
  console.error(
    `[check-kb-dist-fresh] ${pkgRoot}: committed fingerprint is stale (${staleSrc ? "src" : "tsconfig"} changed after the last build) — ${MANDATE}`,
  );
  process.exit(1);
}
console.log(`[check-kb-dist-fresh] ${pkgRoot}: fingerprint matches src + tsconfig`);
