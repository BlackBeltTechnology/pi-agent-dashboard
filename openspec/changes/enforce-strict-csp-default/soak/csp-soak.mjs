#!/usr/bin/env node
/**
 * Soak-gate helper for OpenSpec change `enforce-strict-csp-default` (tasks 1.2–1.4).
 *
 * Takes `/api/health` → `cspReports` snapshots through `pi-dashboard api` (which
 * sends local proof), checks the liveness canary, and evaluates the soak exit:
 *   - every `strict`-label counter except `require-trusted-types-for` is 0
 *     (or covered by a reasoned exclusion);
 *   - `dropped` is 0;
 *   - `since` is unchanged between the open and close snapshots;
 *   - open and close are different release tags, each equal to `serverVersion`
 *     without its leading `v` (when tags are given).
 * CSP / Trusted Types mode, exercise checklist and sign-off stay manual
 * (see the change's soak-evidence.md).
 *
 * Usage:
 *   node csp-soak.mjs snapshot <label> [--dir d] [--port n]
 *   node csp-soak.mjs reset [--dir d] [--port n]       # POST reset, then snapshot "open"
 *   node csp-soak.mjs canary <before-label> [--dir d] [--port n]
 *   node csp-soak.mjs check [--open open] [--close close] [--open-tag vX] [--close-tag vY]
 *                                   [--exclusions file.json] [--dir d]
 * Labels resolve to `<dir>/<label>.json`; default dir is this script's directory.
 * Tests: `node --test openspec/changes/enforce-strict-csp-default/soak/csp-soak.test.mjs`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Snapshots default to this script's own directory (the change's `soak/`). */
const DEFAULT_DIR = dirname(fileURLToPath(import.meta.url));
const TT_DIRECTIVE = "require-trusted-types-for";
const CANARY_DIRECTIVE = "script-src-elem";

/** Non-zero `strict` counters that block the flip (Trusted Types excluded). */
export function strictBlockingCounts(snapshot) {
  const strict = snapshot?.cspReports?.counts?.strict ?? {};
  const out = {};
  for (const [directive, n] of Object.entries(strict)) if (directive !== TT_DIRECTIVE && n > 0) out[directive] = n;
  return out;
}

/** Increase of the strict `script-src-elem` counter between two snapshots (the canary). */
export function canaryDelta(before, after) {
  const n = (s) => s?.cspReports?.counts?.strict?.[CANARY_DIRECTIVE] ?? 0;
  return n(after) - n(before);
}

const bare = (tag) => String(tag).replace(/^v/, "");

/** Window integrity: `since` unchanged and nothing dropped. */
function windowFailures(open, close) {
  const out = [];
  if (open.cspReports.since !== close.cspReports.since) {
    out.push(`since changed: ${open.cspReports.since} -> ${close.cspReports.since} (evidence restarted; restart the window)`);
  }
  if (close.cspReports.dropped !== 0) out.push(`dropped = ${close.cspReports.dropped}`);
  return out;
}

/** Validates exclusions; returns accepted counts per directive plus rejections. */
function readExclusions(exclusions) {
  const failures = [];
  const excluded = [];
  const allowed = {};
  for (const e of exclusions) {
    const directive = e?.directive;
    if (typeof directive !== "string" || directive === TT_DIRECTIVE || directive === "dropped") {
      failures.push(`exclusion for ${directive} is not allowed (only strict directives other than ${TT_DIRECTIVE})`);
    } else if (typeof e.reason !== "string" || !e.reason.trim()) {
      failures.push(`exclusion for ${directive} has no reason`);
    } else {
      const n = Number.isInteger(e.count) && e.count > 0 ? e.count : 0;
      allowed[directive] = (allowed[directive] ?? 0) + n;
      excluded.push({ directive, count: e.count, reason: e.reason });
    }
  }
  return { failures, excluded, allowed };
}

/** Release span: different tags, each equal to its snapshot's `serverVersion` without the leading `v`. */
function tagFailures(open, close, openTag, closeTag) {
  const out = [];
  if (openTag && closeTag && bare(openTag) === bare(closeTag)) {
    out.push(`open and close are the same release (${openTag}); the window must span >=1 release`);
  }
  if (openTag && bare(openTag) !== open.serverVersion) out.push(`open serverVersion ${open.serverVersion} != tag ${openTag}`);
  if (closeTag && bare(closeTag) !== close.serverVersion) out.push(`close serverVersion ${close.serverVersion} != tag ${closeTag}`);
  return out;
}

/**
 * Soak exit verdict. `exclusions`: `[{ directive, count, reason }]`, each accepting up to
 * `count` strict violations of `directive` (extension-only or switcher-flow, signed off).
 */
export function gateVerdict({ open, close, openTag, closeTag, exclusions = [] }) {
  const missing = [];
  if (!open?.cspReports) missing.push("open snapshot has no cspReports (disclosure refused or wrong file)");
  if (!close?.cspReports) missing.push("close snapshot has no cspReports (disclosure refused or wrong file)");
  if (missing.length) return { pass: false, failures: missing, excluded: [] };

  const ex = readExclusions(exclusions);
  const failures = [...windowFailures(open, close), ...ex.failures];
  for (const [directive, n] of Object.entries(strictBlockingCounts(close))) {
    const ok = ex.allowed[directive] ?? 0;
    if (n > ok) failures.push(`strict ${directive} = ${n}${ok ? ` (${ok} excluded)` : ""}`);
  }
  failures.push(...tagFailures(open, close, openTag, closeTag));
  return { pass: failures.length === 0, failures, excluded: ex.excluded };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { positional, flags };
}

function api(method, path, port) {
  const bin = process.env.PI_DASHBOARD_BIN || "pi-dashboard";
  const args = ["api", method, path, ...(port ? ["--port", port] : [])];
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")} failed: ${(r.stderr || r.stdout || "").trim()}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : {};
}

function takeSnapshot(port) {
  const health = api("GET", "/api/health", port);
  const file = join(os.homedir(), ".pi/dashboard/csp-reports.json");
  let documents;
  if (existsSync(file)) {
    try {
      documents = JSON.parse(readFileSync(file, "utf8")).documents;
    } catch {
      documents = "unreadable";
    }
  }
  return {
    takenAt: new Date().toISOString(),
    serverVersion: health.serverVersion ?? health.version,
    cspReports: health.cspReports,
    documents,
  };
}

const fileFor = (dir, label) => (label.endsWith(".json") ? resolve(label) : join(dir, `${label}.json`));
const load = (dir, label) => JSON.parse(readFileSync(fileFor(dir, label), "utf8"));

function save(dir, label, data) {
  mkdirSync(dir, { recursive: true });
  const f = fileFor(dir, label);
  writeFileSync(f, `${JSON.stringify(data, null, 2)}\n`);
  return f;
}

function summary(s) {
  const c = s.cspReports;
  if (!c) return "  cspReports: ABSENT (health did not disclose it; read ~/.pi/dashboard/csp-reports.json on the server host)";
  return [
    `  serverVersion: ${s.serverVersion}`,
    `  since: ${c.since}`,
    `  dropped: ${c.dropped}`,
    `  strict (blocking): ${JSON.stringify(strictBlockingCounts(s))}`,
    `  strict (all): ${JSON.stringify(c.counts?.strict ?? {})}`,
  ].join("\n");
}

function cmdSnapshot({ positional, dir, port }) {
  const label = positional[0];
  if (!label) throw new Error("usage: snapshot <label>");
  const s = takeSnapshot(port);
  console.log(`saved ${save(dir, label, s)}\n${summary(s)}`);
  return 0;
}

function cmdReset({ dir, port }) {
  const r = api("POST", "/api/csp-reports/reset", port);
  const resetAt = new Date().toISOString();
  const s = { ...takeSnapshot(port), resetAt, resetResponse: r };
  console.log(`saved ${save(dir, "open", s)}\n  resetAt: ${resetAt}\n${summary(s)}`);
  const drift = s.cspReports ? Math.abs(Date.parse(s.cspReports.since) - Date.parse(resetAt)) : Number.NaN;
  if (!(drift <= 60_000)) {
    console.error(`FAIL: since is not within 60 s of the reset (${s.cspReports?.since})`);
    return 1;
  }
  if (Object.keys(strictBlockingCounts(s)).length || s.cspReports.dropped) {
    console.error("FAIL: counts are not zero right after the reset");
    return 1;
  }
  console.log("OK: window open");
  return 0;
}

function cmdCanary({ positional, dir, port }) {
  const before = positional[0];
  if (!before) throw new Error("usage: canary <before-label>");
  const after = takeSnapshot(port);
  const d = canaryDelta(load(dir, before), after);
  save(dir, `${before}-after`, after);
  console.log(`canary: strict ${CANARY_DIRECTIVE} +${d}`);
  if (d < 1) {
    console.error("FAIL: no canary report arrived (did you wait >=5 s after the inline script?)");
    return 1;
  }
  console.log("OK: report pipeline delivers");
  return 0;
}

function cmdCheck({ flags, dir }) {
  const exclusions = flags.exclusions ? JSON.parse(readFileSync(resolve(flags.exclusions), "utf8")) : [];
  const v = gateVerdict({
    open: load(dir, flags.open ?? "open"),
    close: load(dir, flags.close ?? "close"),
    openTag: flags["open-tag"],
    closeTag: flags["close-tag"],
    exclusions,
  });
  for (const e of v.excluded) console.log(`excluded: strict ${e.directive} up to ${e.count} (${e.reason})`);
  for (const f of v.failures) console.error(`FAIL: ${f}`);
  console.log(v.pass ? "PASS: soak gate counters clean" : "BLOCKED: soak gate not met");
  return v.pass ? 0 : 1;
}

const COMMANDS = { snapshot: cmdSnapshot, reset: cmdReset, canary: cmdCanary, check: cmdCheck };

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const run = COMMANDS[cmd];
  if (!run) {
    console.error("usage: csp-soak.mjs <snapshot|reset|canary|check> … (see file header)");
    return 2;
  }
  return run({ positional, flags, dir: resolve(flags.dir ?? DEFAULT_DIR), port: flags.port });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}
