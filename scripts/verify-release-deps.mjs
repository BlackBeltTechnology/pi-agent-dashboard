#!/usr/bin/env node
/**
 * verify-release-deps.mjs — pre-release dependency-shape gate.
 *
 * Asserts the publishable workspace package.json files declare the
 * critical runtime dependencies that, if missing, ship a broken tarball
 * to the npm registry. Each rule corresponds to a real bug captured in
 * `docs/repro/`.
 *
 * Exits non-zero with a human-readable report on any violation.
 *
 * Invoked by the `release-cut` skill in its pre-flight phase and by the
 * Release workflow before `npm publish`. Add new rules here as more
 * "must-have-at-release" invariants are identified.
 *
 * See change: enable-standalone-npm-install (task 7.2).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * Rules. Each rule: { pkgPath, dep, kind, evidence }.
 *   pkgPath:  path relative to repo root, to a package.json
 *   dep:      name of the dependency to verify
 *   kind:     "dependencies" | "devDependencies" | "peerDependencies"
 *   evidence: docs/repro pointer or change name for context in failures
 */
const RULES = [
  {
    pkgPath: "packages/server/package.json",
    dep: "jiti",
    kind: "dependencies",
    evidence:
      "docs/repro/v0.5.3-clean-node22-linux-x64-2026-05-19.log STEP 3 — " +
      "without jiti as a direct dep, the bin wrapper exits 1 'cannot find jiti' " +
      "on any clean-machine npm install. See change: enable-standalone-npm-install task 7.2.",
  },
  {
    pkgPath: "packages/server/package.json",
    dep: "node-pty",
    kind: "dependencies",
    evidence:
      "docs/repro/v0.5.3-clean-node22-linux-x64-2026-05-19.log STEP 1 — " +
      "node-pty 1.1.0 ships no linux-x64 prebuild; install fails on slim " +
      "Debian. Must remain pinned at 1.2.0-beta.13+ until 1.2.0 stable. " +
      "See change: enable-standalone-npm-install task 7.1.",
    minVersion: "1.2.0-beta.13",
  },
  {
    pkgPath: "packages/server/package.json",
    dep: "@earendil-works/pi-coding-agent",
    kind: "dependencies",
    evidence:
      "eliminate-electron-runtime-install task 1.1.a — pi lifted from " +
      "optional peer to regular dep so `npm install` resolves it for the " +
      "standalone + Electron arms. Floor 0.74.0 taken from the now-vestigial " +
      "packages/electron/offline-packages.json pin.",
    minVersion: "0.74.0",
  },
  {
    pkgPath: "packages/server/package.json",
    dep: "@fission-ai/openspec",
    kind: "dependencies",
    evidence:
      "eliminate-electron-runtime-install task 1.1.a — openspec lifted from " +
      "optional peer to regular dep. Floor 1.3.0 taken from the now-vestigial " +
      "packages/electron/offline-packages.json pin.",
    minVersion: "1.3.0",
  },
  {
    pkgPath: "packages/server/package.json",
    dep: "tsx",
    kind: "dependencies",
    evidence:
      "eliminate-electron-runtime-install task 1.1.a — tsx lifted from " +
      "optional peer to regular dep so the server can run TypeScript entry " +
      "points without a separate user install. Floor 4.21.0 matches the " +
      "jiti/tsx loader contract used by packages/server/bin/pi-dashboard.mjs.",
    minVersion: "4.21.0",
  },
];

const failures = [];

for (const rule of RULES) {
  const abs = path.join(REPO_ROOT, rule.pkgPath);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(abs, "utf-8"));
  } catch (err) {
    failures.push(`Cannot read ${rule.pkgPath}: ${err.message}`);
    continue;
  }
  const bucket = pkg[rule.kind];
  if (!bucket || !bucket[rule.dep]) {
    failures.push(
      `Missing: ${rule.pkgPath} → ${rule.kind}.${rule.dep}\n  Why: ${rule.evidence}`,
    );
    continue;
  }
  if (rule.minVersion) {
    const declared = String(bucket[rule.dep]);
    // Loose check: declared range must mention >= rule.minVersion (any caret/tilde/exact accepted).
    // We do not do full semver math here — we just want a clear signal that the
    // pin hasn't reverted to an older release. The rule's evidence is the
    // authority on which versions are acceptable.
    if (!declared.includes(rule.minVersion.split("-")[0])) {
      failures.push(
        `Stale pin: ${rule.pkgPath} → ${rule.kind}.${rule.dep} = "${declared}"\n` +
          `  Expected: range covering at least ${rule.minVersion}\n` +
          `  Why: ${rule.evidence}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("verify-release-deps.mjs: pre-release dependency gate FAILED");
  console.error("");
  for (const f of failures) {
    console.error("  ✗ " + f.replace(/\n/g, "\n    "));
    console.error("");
  }
  console.error(
    `Total failures: ${failures.length}. Fix the workspace package.json files before cutting a release.`,
  );
  process.exit(1);
}

console.log(
  `verify-release-deps.mjs: OK — ${RULES.length} rules passed.`,
);
