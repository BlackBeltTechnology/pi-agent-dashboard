#!/usr/bin/env node
/**
 * One-off: rewrite the GitHub dismissal comment of the 33 code-scanning alerts
 * mapped in `dismissal-comments.json` (#1062). Reason unchanged, comment =
 * `<reasonText> — See change: fix-codeql-baseline-coverage` (≤ 280 chars).
 *
 * GitHub refuses to edit the comment of an already-dismissed alert (HTTP 400
 * "Alert is already dismissed", canary #57), so each alert is reopened
 * (`state=open`) and re-dismissed with the SAME reason and the new comment.
 * `dismissed_at` resets; `dismissed_by` becomes the gh user.
 *
 * Safety:
 *  - every reasonText is length-checked BEFORE any `gh` call (> 236 → exit 1);
 *  - pre-flight reads ALL selected alerts first; any alert not `dismissed`, or
 *    whose `dismissed_reason` differs from the table, aborts before any PATCH
 *    (a PATCH with state=dismissed on an open alert would dismiss it);
 *  - per-alert idempotent: an alert already carrying the new comment is skipped,
 *    so a re-run after a failure resumes;
 *  - a `reopened` record is logged BEFORE the reopen; on re-run an alert that is
 *    open AND has an unfinished `reopened` record is re-dismissed (crash between
 *    the two PATCHes), any other open alert still aborts the pre-flight;
 *  - the first failed PATCH stops the run non-zero.
 *
 * Usage: node sync-dismissal-comments.mjs [--dry-run] [--only 57,58] [--table f] [--log f] [--repo o/r]
 * Test seam: PI_SYNC_GH_BIN (default `gh`).
 *
 * See change: fix-codeql-baseline-coverage.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CHANGE = "fix-codeql-baseline-coverage";
const SUFFIX = ` — See change: ${CHANGE}`;
const MAX_REASON = 236;
const here = dirname(new URL(import.meta.url).pathname);

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const dryRun = args.includes("--dry-run");
const tablePath = opt("--table", join(here, "dismissal-comments.json"));
const logPath = opt("--log", join(here, "comment-sync.log.jsonl"));
const repo = opt("--repo", "BlackBeltTechnology/pi-agent-dashboard");
const only = opt("--only", null)?.split(",").map((s) => s.trim());
const gh = process.env.PI_SYNC_GH_BIN || "gh";

const fail = (msg) => {
  process.stderr.write(`sync-dismissal-comments: ${msg}\n`);
  process.exit(1);
};

const table = JSON.parse(readFileSync(tablePath, "utf8"));
const alerts = Object.keys(table).filter((n) => !only || only.includes(n));
if (only) for (const n of only) if (!table[n]) fail(`alert #${n} is not in the table`);

// 1. Length guard — before any gh call.
for (const n of alerts) {
  const len = table[n].reasonText.length;
  if (len > MAX_REASON) fail(`alert #${n}: reasonText is ${len} chars (max ${MAX_REASON}); nothing sent`);
}

function ghApi(argv) {
  const r = spawnSync(gh, ["api", ...argv], { encoding: "utf8" });
  if (r.status !== 0) return { ok: false, err: (r.stderr || r.error?.message || `exit ${r.status}`).trim() };
  return { ok: true, out: r.stdout };
}
const alertUrl = (n) => `repos/${repo}/code-scanning/alerts/${n}`;

// Alerts this script reopened and never re-dismissed (crash between the PATCHes).
const pendingReopen = new Set();
if (existsSync(logPath)) {
  for (const line of readFileSync(logPath, "utf8").split("\n").filter(Boolean)) {
    const e = JSON.parse(line);
    if (e.step === "reopened") pendingReopen.add(String(e.alert));
    else pendingReopen.delete(String(e.alert));
  }
}

// 2. Pre-flight — read every selected alert before any PATCH.
const current = {};
for (const n of alerts) {
  const r = ghApi([alertUrl(n)]);
  if (!r.ok) fail(`pre-flight: reading alert #${n} failed: ${r.err}; nothing patched`);
  const a = JSON.parse(r.out);
  const resuming = a.state === "open" && pendingReopen.has(n);
  if (a.state !== "dismissed" && !resuming) fail(`pre-flight: alert #${n} is ${a.state}, not dismissed; nothing patched`);
  if (!resuming && a.dismissed_reason !== table[n].dismissedReason) {
    fail(`pre-flight: alert #${n} reason "${a.dismissed_reason}" ≠ expected "${table[n].dismissedReason}"; nothing patched`);
  }
  current[n] = a;
}

// 3. Patch (or print) per alert.
let patched = 0;
let skipped = 0;
for (const n of alerts) {
  const resuming = current[n].state === "open";
  const oldC = current[n].dismissed_comment ?? "";
  const newC = table[n].reasonText + SUFFIX;
  if (newC.length > 280) fail(`alert #${n}: comment is ${newC.length} chars`); // unreachable after step 1
  if (!resuming && oldC === newC) {
    skipped++;
    if (dryRun) process.stdout.write(`#${n} unchanged\n`);
    continue;
  }
  if (dryRun) {
    process.stdout.write(`#${n} reason=${current[n].dismissed_reason}\n  old: ${oldC}\n  new: ${newC}\n`);
    continue;
  }
  const reason = table[n].dismissedReason;
  if (!resuming) {
    appendFileSync(logPath, `${JSON.stringify({ alert: Number(n), step: "reopened", at: new Date().toISOString(), old: oldC })}\n`);
    const o = ghApi(["-X", "PATCH", alertUrl(n), "-f", "state=open"]);
    if (!o.ok) fail(`reopen alert #${n} failed after ${patched} patched: ${o.err}; re-run to resume`);
  }
  const r = ghApi([
    "-X",
    "PATCH",
    alertUrl(n),
    "-f",
    "state=dismissed",
    "-f",
    `dismissed_reason=${reason}`,
    "-f",
    `dismissed_comment=${newC}`,
  ]);
  if (!r.ok) fail(`PATCH alert #${n} failed after ${patched} patched (alert is OPEN): ${r.err}; re-run to resume`);
  appendFileSync(logPath, `${JSON.stringify({ alert: Number(n), step: "dismissed", at: new Date().toISOString(), old: oldC, new: newC })}\n`);
  patched++;
}
process.stdout.write(`${dryRun ? "dry-run" : "done"}: ${alerts.length} alerts, ${patched} patched, ${skipped} unchanged\n`);
