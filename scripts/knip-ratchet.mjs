#!/usr/bin/env node
/**
 * Dead-code ratchet — per-class, never a scalar total.
 *
 * A single total is gameable and, worse, self-deceiving: delete one dead file
 * while adding two dead exports and the total FALLS, so the gate passes while
 * the codebase got worse. Counts are therefore compared class by class, and any
 * class above its recorded number fails.
 *
 * The baseline is a debt ceiling, not a target. Raising it is rejected outright
 * (`--check-baseline-diff`) — the only sanctioned direction is down, as cleanup
 * lands. Deleting the file is likewise not an escape: a missing baseline is a
 * hard error, never an implicit "adopt whatever we measure today".
 *
 * Owns nothing else: dependency classes are `off` in knip.json because
 * `noUndeclaredDependencies` in biome.json already gates them (one rule, one
 * engine — see openspec/specs/code-quality-loop).
 *
 * See change: add-knip-dead-code-oracle.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** The classes Knip reports and this repo gates. Order is display order. */
export const GATED_CLASSES = ["files", "exports", "types", "duplicates", "enumMembers"];

/** Per-class counts from a `knip --reporter json` report. Pure. */
export function countIssues(report) {
  const issues = Array.isArray(report) ? report : (report?.issues ?? []);
  const counts = {};
  for (const cls of GATED_CLASSES) {
    counts[cls] = issues.reduce((n, e) => n + (Array.isArray(e?.[cls]) ? e[cls].length : 0), 0);
  }
  return counts;
}

/**
 * Compare current counts against the baseline, class by class.
 * Returns `{ ok, violations, missingBaseline, missingClasses }` — never throws,
 * never mutates.
 *
 * A class whose baseline is absent, non-numeric or non-FINITE is a HARD
 * FAILURE, not a skip. Skipping it was a bypass of the very property this gate
 * exists for: deleting `counts.exports` (or emptying `counts` entirely) left
 * that class completely unmeasured while the command still exited 0. "Raising
 * the ceiling is rejected" means nothing if the ceiling can simply be deleted.
 *
 * `Number.isFinite`, not `typeof`, because `1e400` is valid JSON that parses to
 * `Infinity` and passes `typeof x === "number"`. `now > Infinity` is always
 * false, so an `Infinity` ceiling silences a class exactly like a deleted one
 * — the same bypass wearing a number. (`NaN` cannot reach here: it is not
 * JSON-representable, so parsing fails first and the baseline reads as absent.)
 */
export function ratchetDecision(baseline, current) {
  if (!baseline || typeof baseline !== "object" || !baseline.counts || typeof baseline.counts !== "object") {
    return { ok: false, missingBaseline: true, missingClasses: [], violations: [] };
  }
  const missingClasses = GATED_CLASSES.filter((cls) => !Number.isFinite(baseline.counts[cls]));
  if (missingClasses.length > 0) {
    return { ok: false, missingBaseline: false, missingClasses, violations: [] };
  }
  const violations = [];
  for (const cls of GATED_CLASSES) {
    const max = baseline.counts[cls];
    // `countIssues` always emits every gated class, so the `?? 0` is defensive
    // rather than a path a real report takes.
    const now = current?.[cls] ?? 0;
    if (now > max) violations.push({ class: cls, baseline: max, current: now, delta: now - max });
  }
  return { ok: violations.length === 0, missingBaseline: false, missingClasses: [], violations };
}

/**
 * Classes whose recorded ceiling a diff RAISES. Lowering is the point of the
 * ratchet and is always allowed.
 */
export function baselineIncreases(previous, next) {
  const raised = [];
  for (const cls of GATED_CLASSES) {
    const before = previous?.counts?.[cls];
    if (!Number.isFinite(before)) continue;
    const after = next?.counts?.[cls];
    // A DELETED class is the cheapest possible way to silence a regression, so
    // it counts as raising the ceiling to infinity rather than as "nothing to
    // compare".
    if (!Number.isFinite(after)) {
      // Covers both a deleted key and an `Infinity` ceiling (`1e400` in JSON):
      // each leaves the class unmeasured, so each counts as raising it.
      raised.push({ class: cls, from: before, to: null, removed: true });
      continue;
    }
    if (after > before) raised.push({ class: cls, from: before, to: after });
  }
  return raised;
}

const BASELINE_PATH = "knip-baseline.json";

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function runKnip() {
  let raw;
  try {
    // knip exits non-zero whenever findings exist, which is the normal state
    // while the baseline is above zero; the report still lands on stdout.
    raw = execSync("npx knip --reporter json --no-progress", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    raw = err.stdout ?? "";
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error("✗ knip-ratchet: could not parse `knip --reporter json` output");
    process.exit(1);
  }
}

function checkBaselineDiff(base) {
  let previous;
  try {
    previous = JSON.parse(execSync(`git show ${base}:${BASELINE_PATH}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    console.log(`✓ knip-ratchet: no baseline on ${base} to compare against`);
    return 0;
  }
  const raised = baselineIncreases(previous, readBaseline());
  for (const r of raised) {
    console.error(
      r.removed
        ? `✗ knip-ratchet: baseline class "${r.class}" (was ${r.from}) was DELETED — that class is now unmeasured`
        : `✗ knip-ratchet: baseline for "${r.class}" raised ${r.from} → ${r.to}`,
    );
  }
  if (raised.length > 0) {
    console.error("  The baseline is a debt ceiling. Remove the dead code; do not raise the ceiling.");
    return 1;
  }
  console.log("✓ knip-ratchet: no baseline class was raised");
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  const diffFlag = args.indexOf("--check-baseline-diff");
  if (diffFlag !== -1) process.exit(checkBaselineDiff(args[diffFlag + 1] ?? "origin/develop"));

  const baseline = readBaseline();
  const current = countIssues(runKnip());
  const decision = ratchetDecision(baseline, current);

  if (decision.missingBaseline) {
    console.error(`✗ knip-ratchet: no readable ${BASELINE_PATH}`);
    console.error("  Refusing to adopt the current counts as the baseline — that would gate nothing.");
    process.exit(1);
  }
  if (decision.missingClasses.length > 0) {
    console.error(`✗ knip-ratchet: ${BASELINE_PATH} has no number for: ${decision.missingClasses.join(", ")}`);
    console.error("  An absent class is unmeasured, not unlimited. Restore it rather than deleting the ceiling.");
    process.exit(1);
  }
  for (const v of decision.violations) {
    console.error(`✗ knip-ratchet: "${v.class}" ${v.current} > baseline ${v.baseline} (+${v.delta})`);
  }
  if (decision.ok) {
    console.log(`✓ knip-ratchet: ${GATED_CLASSES.map((c) => `${c} ${current[c]}/${baseline.counts[c] ?? "-"}`).join(", ")}`);
  } else {
    console.error("  Remove the dead code, or justify a deliberate lowering of a different class separately.");
  }
  process.exit(decision.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
