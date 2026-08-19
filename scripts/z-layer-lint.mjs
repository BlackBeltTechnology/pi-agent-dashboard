#!/usr/bin/env node
/**
 * Overlay z-index ratchet — freezes raw numeric z on client overlay source.
 *
 * A regex cannot tell a portaled overlay's z from an in-flow decoration's, so
 * this does not try to classify: it captures the CURRENT set of raw numeric-z
 * occurrences (`z-50`, `z-[60]`, `z-[9999]`, …) in `packages/client/src` as a
 * frozen baseline, and FAILS when a NEW occurrence appears that is not one of
 * the named layer utilities (`z-base … z-lightbox`, which are word-based and so
 * never match the numeric pattern). The baseline is a debt ceiling that may only
 * SHRINK — it doubles as the inline-popover / FilePreviewOverlay migration
 * backlog. Modelled on `scripts/knip-ratchet.mjs`.
 *
 * Test files are excluded: a spec that asserts `not.toContain("z-50")` legitimately
 * contains the literal.
 *
 * See openspec spec overlay-layering. See change: add-overlay-layering-system.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const SCAN_DIR = "packages/client/src";
export const BASELINE_PATH = "scripts/z-layer-baseline.json";

// Raw numeric z: `z-50`, `z-[60]`, `z-[9999]`, optionally negative. NOT the
// word-based layer utilities (`z-popover`), which carry ordering intent.
const RAW_Z = /(?<![\w-])-?z-(?:\[[0-9]+\]|[0-9]+)(?![\w-])/g;

/** All raw numeric-z tokens in a source string (with repeats). Pure. */
export function extractRawZ(source) {
  return source.match(RAW_Z) ?? [];
}

/**
 * Build a multiset `{"<relpath>|<token>": count}` from files. Pure w.r.t. the
 * injected `read`/`rel` so tests need no filesystem.
 */
export function scanRawZ(files, read, rel = (f) => f) {
  const counts = {};
  for (const f of files) {
    for (const tok of extractRawZ(read(f))) {
      const key = `${rel(f)}|${tok}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Compare current multiset against the baseline. `additions` = keys whose count
 * rose above the baseline (a NEW raw-z). Shrinking (current < baseline) is fine.
 * Pure; never throws.
 */
export function ratchetDecision(current, baseline) {
  const additions = [];
  for (const [key, n] of Object.entries(current)) {
    const allowed = baseline[key] ?? 0;
    if (n > allowed) additions.push({ key, current: n, baseline: allowed });
  }
  return { ok: additions.length === 0, additions };
}

/** List scanned source files (git-tracked .ts/.tsx under SCAN_DIR, no tests). */
function listFiles(repoRoot) {
  const out = execSync(`git ls-files "${SCAN_DIR}/*.ts" "${SCAN_DIR}/*.tsx"`, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !/(__tests__|\.test\.|\.spec\.)/.test(f))
    .map((f) => join(repoRoot, f));
}

function main() {
  const repoRoot = resolve(import.meta.dirname, "..");
  const files = listFiles(repoRoot);
  const current = scanRawZ(files, (f) => readFileSync(f, "utf8"), (f) => relative(repoRoot, f));

  if (process.argv.includes("--write-baseline")) {
    const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(join(repoRoot, BASELINE_PATH), `${JSON.stringify(sorted, null, 2)}\n`);
    const total = Object.values(current).reduce((n, v) => n + v, 0);
    console.log(`z-layer-lint: wrote baseline (${Object.keys(sorted).length} keys, ${total} occurrences)`);
    return;
  }

  const baselineFile = join(repoRoot, BASELINE_PATH);
  if (!existsSync(baselineFile)) {
    console.error(`z-layer-lint: missing baseline ${BASELINE_PATH} — run with --write-baseline once.`);
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  const { ok, additions } = ratchetDecision(current, baseline);
  if (!ok) {
    console.error("z-layer-lint: NEW raw z-index on client overlay source (use a z-<layer> token):");
    for (const a of additions) console.error(`  + ${a.key}  (${a.baseline} → ${a.current})`);
    console.error("Raw z-[NNNN]/ad-hoc numeric z is prohibited on portaled overlays; the baseline may only shrink.");
    process.exit(1);
  }
  const curTotal = Object.values(current).reduce((n, v) => n + v, 0);
  const baseTotal = Object.values(baseline).reduce((n, v) => n + v, 0);
  console.log(`z-layer-lint: ok (${curTotal} raw-z occurrences; baseline ${baseTotal}).`);
}

// Run only as a CLI, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) main();
