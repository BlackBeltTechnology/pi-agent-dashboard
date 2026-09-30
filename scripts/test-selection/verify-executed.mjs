#!/usr/bin/env node
/**
 * Shard self-verification (change: speed-up-ci-affected-tests).
 *
 *   node scripts/test-selection/verify-executed.mjs <selection.json> <job-key> <vitest-report.json>
 *
 * job-key: `unit-<n>` (1-based shard), `real-process` or `ci-scenarios`.
 * Fails naming every file the selector assigned to this job that is absent
 * from the vitest JSON report's `testResults[].name` — a path-form mismatch or
 * a filter that silently matched nothing must never read as a green shard.
 * An empty assignment passes without a report. A selection that could not
 * enumerate tests (`enumerated: false`) has nothing to compare and passes.
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
  throw new Error(`unknown job key ${jobKey}`);
}

/**
 * @param {string[]} assigned  repo-relative paths
 * @param {object|null} report vitest JSON report (null when absent)
 * @param {string} root        repo root the report's absolute names are relative to
 * @returns {{ ok: boolean, missing: string[], message: string }}
 */
export function verifyExecuted(assigned, report, root) {
  if (assigned.length === 0) return { ok: true, missing: [], message: "no files assigned; nothing to verify" };
  if (!report) return { ok: false, missing: [...assigned], message: `no vitest report, ${assigned.length} assigned file(s) unverified` };
  const executed = new Set(
    (report.testResults ?? []).map((r) => path.relative(root, r.name).split(path.sep).join("/")),
  );
  const missing = assigned.filter((f) => !executed.has(f));
  return missing.length
    ? { ok: false, missing, message: `${missing.length} assigned file(s) did not execute:\n${missing.map((f) => `  - ${f}`).join("\n")}` }
    : { ok: true, missing: [], message: `all ${assigned.length} assigned file(s) executed` };
}

function main([selectionPath, jobKey, reportPath]) {
  const selection = JSON.parse(fs.readFileSync(selectionPath, "utf8"));
  if (selection.enumerated === false && jobKey !== "ci-scenarios") {
    console.log("[verify-executed] selection did not enumerate tests (fallback sharding); nothing to compare");
    return 0;
  }
  let report = null;
  if (reportPath && fs.existsSync(reportPath)) report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const r = verifyExecuted(assignedFor(selection, jobKey), report, process.cwd());
  console.log(`[verify-executed] ${jobKey}: ${r.message}`);
  if (!r.ok) console.log(`::error::${jobKey}: ${r.missing.length} assigned test file(s) did not execute: ${r.missing.slice(0, 10).join(", ")}`);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
