#!/usr/bin/env node
/**
 * Zero-skip check for the CSP E2E lanes (Playwright JSON report).
 *
 *   node scripts/e2e-csp-lane-check.mjs <report.json> [--allow a,b] [--require x,y]
 *
 * Exit 1 when: the report holds 0 tests; a `--require`d spec basename is absent;
 * `stats.unexpected > 0`; or a test in a spec outside `--allow` has a skipped
 * result with a `skip` annotation whose description contains `PI_DASHBOARD_CSP`.
 * Exit 2 on an unreadable / unparseable report or bad usage. No dependencies.
 *
 * See change: enforce-strict-csp-default (D4).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const TOKEN = "PI_DASHBOARD_CSP";

function parseArgs(argv) {
  const out = { report: undefined, allow: [], require: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--allow" || a === "--require") {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (out.report === undefined) out.report = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!out.report) throw new Error("missing <report.json>");
  return out;
}

/** Every spec in the suite tree, with its file basename. */
function* specsOf(suites, file) {
  for (const s of suites ?? []) {
    const f = s.file ?? file;
    for (const spec of s.specs ?? []) yield { spec, base: path.basename(spec.file ?? f ?? "") };
    yield* specsOf(s.suites, f);
  }
}

function main() {
  let args;
  let report;
  try {
    args = parseArgs(process.argv.slice(2));
    report = JSON.parse(readFileSync(args.report, "utf8"));
  } catch (e) {
    console.error(`e2e-csp-lane-check: ${e.message}`);
    return 2;
  }
  const failures = [];
  const seen = new Set();
  let tests = 0;
  for (const { spec, base } of specsOf(report.suites)) {
    seen.add(base);
    for (const t of spec.tests ?? []) {
      tests++;
      if (args.allow.includes(base)) continue;
      const skipped = (t.results ?? []).some((r) => r.status === "skipped");
      const cspSkip = (t.annotations ?? []).find((a) => a.type === "skip" && String(a.description ?? "").includes(TOKEN));
      if (skipped && cspSkip) failures.push(`${base} › ${spec.title}: skipped for CSP (${cspSkip.description})`);
    }
  }
  if (tests === 0) failures.push("report holds 0 tests");
  for (const r of args.require) if (!seen.has(r)) failures.push(`required spec absent from report: ${r}`);
  const unexpected = report.stats?.unexpected ?? 0;
  if (unexpected > 0) failures.push(`stats.unexpected = ${unexpected}`);
  if (failures.length) {
    for (const f of failures) console.error(`FAIL: ${f}`);
    return 1;
  }
  console.log(`OK: ${tests} tests, no CSP-reason skip outside the allow-list`);
  return 0;
}

process.exit(main());
