#!/usr/bin/env node
/**
 * Shard self-verification (change: speed-up-ci-affected-tests).
 *
 *   node scripts/test-selection/verify-executed.mjs <selection.json> <job-key> <vitest-report.json>
 *
 * job-key: `unit-<n>` (1-based shard), `real-process`, `ci-scenarios` or `budget`.
 * Fails naming every file the selector assigned to this job that is absent
 * from the vitest JSON report's `testResults[].name` — a path-form mismatch or
 * a filter that silently matched nothing must never read as a green shard.
 * An empty assignment passes without a report. A selection that could not
 * enumerate tests (`enumerated: false`) has nothing to compare, but its report
 * must still exist and list at least one file.
 * The `budget` key is stricter (design.md D3): a file that ran zero assertions, or
 * holds any skipped/pending/todo assertion, fails too, so a missing runtime
 * (e.g. the blender JSPI probe) never reads as a green budget lane.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Files the selection assigns to a job key. */
export function assignedFor(selection, jobKey) {
  const m = /^unit-(\d+)$/.exec(jobKey);
  if (m) return selection.shards?.[Number(m[1]) - 1] ?? [];
  if (jobKey === "real-process") return selection.realProcess ?? [];
  if (jobKey === "ci-scenarios") return selection.ciScenariosFiles ?? [];
  if (jobKey === "budget") return selection.budgetFiles ?? [];
  throw new Error(`unknown job key ${jobKey}`);
}

/** Assertion statuses that mean "did not really run" under the strict (`budget`) rule. */
const NOT_RUN_STATUSES = new Set(["skipped", "pending", "todo"]);

/**
 * @param {string[]} assigned  repo-relative paths
 * @param {object|null} report vitest JSON report (null when absent)
 * @param {string} root        repo root the report's absolute names are relative to
 * @param {{ strict?: boolean }} [opts]  strict: also fail a file with zero assertions or a skipped/pending/todo one
 * @returns {{ ok: boolean, missing: string[], weak: {file: string, reason: string}[], message: string }}
 */
export function verifyExecuted(assigned, report, root, { strict = false } = {}) {
  if (assigned.length === 0) return { ok: true, missing: [], weak: [], message: "no files assigned; nothing to verify" };
  if (!report) return { ok: false, missing: [...assigned], weak: [], message: `no vitest report, ${assigned.length} assigned file(s) unverified` };
  const results = new Map(
    (report.testResults ?? []).map((r) => [path.relative(root, r.name).split(path.sep).join("/"), r]),
  );
  const missing = assigned.filter((f) => !results.has(f));
  const weak = [];
  if (strict) {
    for (const f of assigned) {
      const r = results.get(f);
      if (!r) continue;
      const assertions = r.assertionResults ?? [];
      const notRun = assertions.filter((a) => NOT_RUN_STATUSES.has(a.status)).length;
      if (assertions.length === 0) weak.push({ file: f, reason: "zero executed assertions" });
      else if (notRun > 0) weak.push({ file: f, reason: `${notRun} skipped/pending/todo assertion(s)` });
    }
  }
  const lines = [];
  if (missing.length) lines.push(`${missing.length} assigned file(s) did not execute:\n${missing.map((f) => `  - ${f}`).join("\n")}`);
  if (weak.length) lines.push(`${weak.length} assigned file(s) did not fully run:\n${weak.map((w) => `  - ${w.file} (${w.reason})`).join("\n")}`);
  return lines.length
    ? { ok: false, missing, weak, message: lines.join("\n") }
    : { ok: true, missing: [], weak: [], message: `all ${assigned.length} assigned file(s) executed` };
}

function main([selectionPath, jobKey, reportPath]) {
  const selection = JSON.parse(fs.readFileSync(selectionPath, "utf8"));
  let report = null;
  if (reportPath && fs.existsSync(reportPath)) report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const assigned = assignedFor(selection, jobKey);
  // The `budget` list is a filename scan, valid even when vitest could not enumerate: no fallback run.
  if (selection.enumerated === false && assigned.length === 0 && jobKey !== "budget") {
    // Fallback sharding: no assignment to compare, but the job must still
    // prove vitest ran something and reported it (review B4).
    const n = report?.testResults?.length ?? 0;
    console.log(`[verify-executed] ${jobKey}: fallback sharding (selection not enumerated); report lists ${n} file(s)`);
    if (n === 0) console.log(`::error::${jobKey}: fallback run produced no vitest report entries`);
    return n > 0 ? 0 : 1;
  }
  const r = verifyExecuted(assigned, report, process.cwd(), { strict: jobKey === "budget" });
  console.log(`[verify-executed] ${jobKey}: ${r.message}`);
  if (r.missing.length) console.log(`::error::${jobKey}: ${r.missing.length} assigned test file(s) did not execute: ${r.missing.slice(0, 10).join(", ")}`);
  if (r.weak.length) console.log(`::error::${jobKey}: ${r.weak.length} assigned test file(s) did not fully run: ${r.weak.slice(0, 10).map((w) => `${w.file} (${w.reason})`).join(", ")}`);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
