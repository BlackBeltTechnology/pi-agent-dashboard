#!/usr/bin/env node
/**
 * Materialise one job's assignment from selection.json for a workflow step
 * (change: speed-up-ci-affected-tests, D5).
 *
 *   node scripts/test-selection/assigned.mjs <selection.json> <job-key> <out.txt>
 *
 * Writes the assigned repo-relative paths one per line to <out.txt> and the
 * step outputs `empty`, `enumerated` and `count` to $GITHUB_OUTPUT. An empty
 * assignment makes the job skip vitest (and succeed); `enumerated=false`
 * (the selector could not list tests) makes it fall back to `--shard`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assignedFor } from "./verify-executed.mjs";

export function assignment(selection, jobKey) {
  // The packaging-scenario files are found by a plain source scan, so they are
  // listed even when vitest could not enumerate the suite.
  if (selection.enumerated === false && jobKey !== "ci-scenarios") return { files: [], empty: false, enumerated: false };
  const files = assignedFor(selection, jobKey);
  return { files, empty: files.length === 0, enumerated: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [selectionPath, jobKey, outPath] = process.argv.slice(2);
  const a = assignment(JSON.parse(fs.readFileSync(selectionPath, "utf8")), jobKey);
  fs.writeFileSync(outPath, a.files.map((f) => `${f}\n`).join(""));
  const out = `empty=${a.empty}\nenumerated=${a.enumerated}\ncount=${a.files.length}\n`;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, out);
  process.stdout.write(`[assigned] ${jobKey}: ${out.replace(/\n/g, " ")}\n`);
}
