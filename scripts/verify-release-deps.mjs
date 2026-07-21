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
      "standalone + Electron arms. Floor tracks the deliberate pi bump in " +
      "commit 8646f1c4c (chore(deps): bump pi to 0.80.10).",
    minVersion: "0.80.10",
  },
  {
    pkgPath: "packages/server/package.json",
    dep: "@fission-ai/openspec",
    kind: "dependencies",
    evidence:
      "provision-openspec-cli-in-sessions task 1.4 — floor raised 1.3.0 → 1.6.0 " +
      "to match the version that generated the openspec-* skills " +
      "(generatedBy: 1.6.0). npm hoists the server + extension ^1.6.0 ranges to " +
      "one installed copy the session shim resolves.",
    minVersion: "1.6.0",
  },
  {
    pkgPath: "packages/extension/package.json",
    dep: "@fission-ai/openspec",
    kind: "dependencies",
    evidence:
      "provision-openspec-cli-in-sessions task 1.4 — the bridge shim " +
      "(openspec-cli-shim.ts) require.resolves this dep, so it must travel with " +
      "the published extension into generic projects (no dashboard copy hoisted " +
      "there). Floor tracks the single-source version 1.6.0.",
    minVersion: "1.6.0",
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

/**
 * Extract the version floor from a declared range: strips a leading caret/tilde
 * and any prerelease suffix so `^1.6.0` / `~1.6.0` / `1.6.0` all floor to
 * `1.6.0`. Returns null for a range we cannot parse (e.g. `*`, a git/url dep).
 */
export function floorOf(range) {
  const m = String(range).match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

/**
 * Cross-consistency: the server and extension `@fission-ai/openspec` ranges MUST
 * share one version floor (single-source governance). Returns an error string
 * naming the drifted sites, or null when consistent. Exported so the T-S1 unit
 * test can drive it with package.json fixtures.
 * See change: provision-openspec-cli-in-sessions.
 */
export function checkOpenspecFloorConsistency(serverPkg, extensionPkg) {
  const serverRange = serverPkg?.dependencies?.["@fission-ai/openspec"];
  const extensionRange = extensionPkg?.dependencies?.["@fission-ai/openspec"];
  if (!serverRange || !extensionRange) {
    return (
      "openspec floor consistency: missing @fission-ai/openspec dependency " +
      `(server=${serverRange ?? "absent"}, extension=${extensionRange ?? "absent"})`
    );
  }
  const serverFloor = floorOf(serverRange);
  const extensionFloor = floorOf(extensionRange);
  if (serverFloor === null || extensionFloor === null || serverFloor !== extensionFloor) {
    return (
      "openspec floor drift: server and extension @fission-ai/openspec floors must match — " +
      `server "${serverRange}" (floor ${serverFloor}) vs extension "${extensionRange}" (floor ${extensionFloor})`
    );
  }
  return null;
}

function collectFailures() {
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

// Cross-consistency gate: server ↔ extension openspec floors must not drift.
try {
  const serverPkg = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "packages/server/package.json"), "utf-8"),
  );
  const extensionPkg = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "packages/extension/package.json"), "utf-8"),
  );
  const drift = checkOpenspecFloorConsistency(serverPkg, extensionPkg);
  if (drift) failures.push(drift);
  } catch (err) {
    failures.push(`Cannot check openspec floor consistency: ${err.message}`);
  }

  return failures;
}

function main() {
  const failures = collectFailures();

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

  console.log(`verify-release-deps.mjs: OK — ${RULES.length} rules passed.`);
}

// Run only when invoked directly (CLI), not when imported by a unit test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
