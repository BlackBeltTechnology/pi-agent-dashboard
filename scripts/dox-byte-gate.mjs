#!/usr/bin/env node
/**
 * AGENTS.md byte-cap gate (D8) — the bytes arm of `kb dox lint`, and nothing
 * else.
 *
 * `packages/kb/src/dox.ts` already owns AGENTS_BYTE_CAP and emits an
 * `over-threshold` issue with `arm: "bytes"`. This gate therefore recomputes
 * NOTHING: no threshold, no walk, no classification. It filters that command's
 * own verdict.
 *
 * It must filter, because `kb dox lint` exits 1 on any of its seven issue kinds
 * and the tree carries 59 issues today — 30 missing, 19 missing-companion, 4
 * broken-ref, 4 over-threshold:rows, 1 orphan, and exactly 1 over-threshold:bytes.
 * Wiring the raw command as a ship gate would adopt a 58-issue backlog that
 * could never land green. Clearing that backlog is desirable and out of scope.
 *
 * Fix a reported breach with:  node scripts/split-large-agents.mjs <path> --write
 *
 * See change: wire-local-review-gate.
 */
import { execSync } from "node:child_process";

/** The gating subset of a `kb dox lint --json` report. */
export function byteArmIssues(report) {
  const issues = report?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter((i) => i?.kind === "over-threshold" && i?.arm === "bytes");
}

function main() {
  let raw;
  try {
    // `kb dox lint` exits non-zero whenever ANY issue exists, so a non-zero exit
    // here is expected and carries a valid report on stdout. Only a missing
    // command or unparseable output is a real failure.
    raw = execSync("npx kb dox lint --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (err) {
    raw = err.stdout ?? "";
  }

  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    console.error("✗ dox-byte-gate: could not parse `kb dox lint --json` output");
    process.exit(1);
  }

  const bad = byteArmIssues(report);
  for (const i of bad) {
    console.error(`✗ ${i.agentsFile} — ${i.detail}`);
    console.error(`  fix: node scripts/split-large-agents.mjs ${i.agentsFile} --write`);
  }
  if (bad.length === 0) {
    const total = report?.issues?.length ?? 0;
    console.log(
      `✓ dox-byte-gate: no AGENTS.md over the byte cap` +
        (total ? ` (${total} non-gating dox issue(s) ignored)` : ""),
    );
  }
  process.exit(bad.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
