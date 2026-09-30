#!/usr/bin/env node
/**
 * `ci-result` aggregate check (change: speed-up-ci-affected-tests, D5).
 *
 *   NEEDS_JSON='${{ toJSON(needs) }}' node scripts/test-selection/check-result.mjs [selection.json]
 *
 * Fails when `select` did not succeed, when any needed job failed or was
 * cancelled, or when a job the selection EXPECTED to run did not succeed.
 * `skipped` counts as success only for a conditional test job the selection
 * did not expect: the unit matrix when every shard is empty, `real-process`
 * with no real-process files, `ci-scenarios` with the packaging flag off.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Conditional test jobs → whether the selection expects them to run. */
export function expectedJobs(selection) {
  if (!selection) return {};
  const unenumerated = selection.enumerated === false;
  return {
    unit: unenumerated || (selection.shards ?? []).some((s) => s.length > 0),
    "real-process": unenumerated || (selection.realProcess ?? []).length > 0,
    "ci-scenarios": Boolean(selection.ciScenarios),
  };
}

/**
 * @param {object|null} selection  parsed selection.json (null when absent)
 * @param {Record<string, { result: string }>} needs  GitHub `needs` context
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function checkResult(selection, needs) {
  const problems = [];
  if (needs.select?.result !== "success") problems.push(`select: ${needs.select?.result ?? "missing"} (selection is required)`);
  if (!selection) problems.push("selection.json is missing");
  const expected = expectedJobs(selection);
  for (const [job, { result }] of Object.entries(needs)) {
    if (job === "select") continue;
    if (result === "failure" || result === "cancelled") {
      problems.push(`${job}: ${result}`);
      continue;
    }
    const conditional = job in expected;
    const isExpected = conditional ? expected[job] : true;
    if (isExpected && result !== "success") problems.push(`${job}: ${result} but the selection expected it to run`);
  }
  return { ok: problems.length === 0, problems };
}

function main([selectionPath = "selection.json"]) {
  const needs = JSON.parse(process.env.NEEDS_JSON ?? "{}");
  const selection = fs.existsSync(selectionPath) ? JSON.parse(fs.readFileSync(selectionPath, "utf8")) : null;
  const r = checkResult(selection, needs);
  for (const [job, { result }] of Object.entries(needs)) console.log(`${job}: ${result}`);
  if (selection) console.log(`selection: mode=${selection.mode} expected=${JSON.stringify(expectedJobs(selection))}`);
  for (const p of r.problems) console.log(`::error::ci-result: ${p}`);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
