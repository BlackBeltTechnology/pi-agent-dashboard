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
 * It also flags INLINE numeric `zIndex` in style objects (`zIndex: 1000`,
 * `zIndex: "1000"`, `style={{ zIndex: 10 }}`) across `packages/client/src` AND
 * `packages/client-utils/src`, keyed `<file>|zIndex:<n>` and ratcheted against the
 * same baseline. A token value (`zIndex: "var(--z-popover)"`) is never flagged.
 * The Tailwind utility-class scan keeps its `client/src`-only scope.
 *
 * Test files are excluded: a spec that asserts `not.toContain("z-50")` legitimately
 * contains the literal.
 *
 * See openspec spec overlay-layering. See change: add-overlay-layering-system,
add-session-actions-flyout.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const SCAN_DIR = "packages/client/src";
// Inline `zIndex` is scanned in these roots (a superset of SCAN_DIR).
export const INLINE_SCAN_DIRS = [SCAN_DIR, "packages/client-utils/src"];
export const BASELINE_PATH = "scripts/z-layer-baseline.json";

// Raw numeric z: `z-50`, `z-[60]`, `z-[9999]`, optionally negative. NOT the
// word-based layer utilities (`z-popover`), which carry ordering intent.
const RAW_Z = /(?<![\w-])-?z-(?:\[[0-9]+\]|[0-9]+)(?![\w-])/g;

/** All raw numeric-z tokens in a source string (with repeats). Pure. */
export function extractRawZ(source) {
  return source.match(RAW_Z) ?? [];
}

// Inline numeric zIndex: `zIndex: 1000`, `zIndex: "1000"`, `zIndex: '10'`. The
// lookahead rejects expressions/units (`10 + n`, `10px`, `1.5`) and the
// backreference requires matching quotes, so `"var(--z-popover)"` never matches.
const INLINE_Z = /\bzIndex\s*:\s*(["'`]?)(-?[0-9]+)\1(?![\w.%+*/-])/g;

/** All inline numeric `zIndex` tokens (`zIndex:<n>`) in a source string. Pure. */
export function extractInlineZ(source) {
  return Array.from(source.matchAll(INLINE_Z), (m) => `zIndex:${m[2]}`);
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
 * Multiset over BOTH extractors: the utility-class scan applies only to files
 * under SCAN_DIR (`rel(f)` path prefix), the inline-`zIndex` scan to every file.
 * Pure w.r.t. the injected `read`/`rel`.
 */
export function scanAllZ(files, read, rel = (f) => f) {
  const counts = {};
  for (const f of files) {
    const path = rel(f);
    const src = read(f);
    const toks = [...(path.startsWith(`${SCAN_DIR}/`) ? extractRawZ(src) : []), ...extractInlineZ(src)];
    for (const tok of toks) {
      const key = `${path}|${tok}`;
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

/** List scanned source files (git-tracked .ts/.tsx under INLINE_SCAN_DIRS, no tests). */
function listFiles(repoRoot) {
  const globs = INLINE_SCAN_DIRS.flatMap((d) => [`"${d}/*.ts"`, `"${d}/*.tsx"`]).join(" ");
  const out = execSync(`git ls-files ${globs}`, {
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
  const current = scanAllZ(files, (f) => readFileSync(f, "utf8"), (f) => relative(repoRoot, f).split(sep).join("/"));

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

// Run only as a CLI, not when imported by tests. `pathToFileURL` (not a raw
// `file://` concat) makes the guard correct on Windows paths too.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
