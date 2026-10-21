#!/usr/bin/env node
/**
 * Fake `gh` for scripts/codeql-local.mjs --mirror-dismissal tests (test seam: PI_CODEQL_GH_BIN).
 *
 * Driven by the JSON plan at $FAKE_GH_PLAN:
 *   { log, alerts: { "<n>": <alert JSON> }, exit, stderr, sleepMs }
 * `gh api repos/<o>/<r>/code-scanning/alerts/<n>` prints `alerts[n]`; an unknown number is a 404 (exit 1).
 * Every invocation appends `{ argv }` to `plan.log` BEFORE doing anything else, so a test can assert the
 * script never reached GitHub. Alert shapes are built from the recorded real response
 * (fixtures/gh-code-scanning-alert.json, `gh api …/code-scanning/alerts/464`).
 *
 * See change: codeql-model-pack-and-mirror.
 */
import { appendFileSync, readFileSync } from "node:fs";

const plan = JSON.parse(readFileSync(process.env.FAKE_GH_PLAN, "utf8"));
const argv = process.argv.slice(2);
appendFileSync(plan.log, `${JSON.stringify({ argv })}\n`);

if (plan.sleepMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, plan.sleepMs);
if (plan.exit) {
  process.stderr.write(`${plan.stderr ?? "gh failed"}\n`);
  process.exit(plan.exit);
}
const n = /\/code-scanning\/alerts\/(\d+)$/.exec(argv[1] ?? "")?.[1];
const alert = n === undefined ? undefined : plan.alerts?.[n];
if (alert === undefined) {
  process.stderr.write("gh: Not Found (HTTP 404)\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify(alert));
