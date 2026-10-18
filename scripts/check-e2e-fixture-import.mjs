#!/usr/bin/env node
/**
 * Guard: every `tests/e2e/*.spec.ts` must import `test` from `./fixtures.js`,
 * never from `@playwright/test` directly.
 *
 * Why a guard and not a convention: the session accumulation this change fixes
 * IS a default — 138 spawn call sites accrued zero cleanup sites because
 * cleanup was opt-in. The fix is only durable if it is also the default, which
 * means spec #88 must be unable to opt out silently. A bare `test` from
 * `@playwright/test` has no reap fixture attached and leaks every session it
 * spawns.
 *
 * Type-only imports from `@playwright/test` stay legal: they carry no runtime
 * `test` object, so they cannot bypass the fixture.
 *
 * Emits structured findings; exits 1 when any error-level finding exists.
 * Run: node scripts/check-e2e-fixture-import.mjs
 *
 * See change: fix-e2e-harness-memory-exhaustion (test-plan #E6, #E7).
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const E2E_DIR = join(REPO_ROOT, "tests", "e2e");

/** The one-line correction printed on every violation. */
export const CORRECTION = 'import { expect, test } from "./fixtures.js";';

/**
 * Parse the named bindings of every `@playwright/test` import in `source`.
 * Returns the list of VALUE (non-type) bindings pulled from that module.
 */
function playwrightValueBindings(source) {
  const bindings = [];
  // Matches `import { ... } from "@playwright/test"` (single or double quotes).
  const re = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*["']@playwright\/test["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    // `import type { … }` is entirely type-level.
    const isTypeOnlyStatement = /import\s+type\s*\{/.test(m[0]);
    if (isTypeOnlyStatement) continue;
    for (const raw of m[1].split(",")) {
      const spec = raw.trim();
      if (!spec) continue;
      // Inline `type Page` / `type WebSocket as PWWebSocket` are type-level.
      if (/^type\s/.test(spec)) continue;
      bindings.push(spec.split(/\s+as\s+/)[0].trim());
    }
  }
  return bindings;
}

/**
 * Analyze one spec's source. Returns findings (empty = clean).
 * `test` and `expect` are the runtime bindings that must come from the fixture:
 * `test` carries the reap, and importing `expect` from elsewhere is the usual
 * first step back toward importing `test` from elsewhere too.
 */
export function analyzeSpecSource(file, source) {
  const findings = [];
  const offending = playwrightValueBindings(source).filter((b) => b === "test" || b === "expect");
  if (offending.length > 0) {
    findings.push({
      rule: "e2e-test-import-bypasses-fixture",
      severity: "error",
      file,
      bindings: offending,
      message:
        `${file}: imports {${offending.join(", ")}} from "@playwright/test" directly, ` +
        `bypassing the session-reap fixture. Sessions this spec spawns would outlive it ` +
        `and exhaust the shared harness container.\n  Correction: ${CORRECTION}\n` +
        `  (type-only imports from "@playwright/test" remain legal)`,
    });
  }
  return findings;
}

/**
 * Trust-write lint — specs change harness-global trust ONLY through
 * `narrowTrust` (tests/e2e/fixtures.ts), which snapshots, restores per test and
 * is policed by the reap fixture's tripwire. A raw write is the poisoning
 * hazard of #832: restored only in `afterAll`, which a timeout/kill never runs.
 *
 * Flags a server WRITE of a trust-bearing key: `PUT /api/config`, a local
 * `putConfig(...)` / `patchConfig(...)` helper, or a `delete x.<key>` on a parsed
 * config, whose argument/line names one of the keys. Route stubs
 * (`page.route`, `stubConfig`) never reach the server and are not flagged, and
 * neither is a `narrowTrust(...)` call.
 *
 * Escape hatch for a write `PUT /api/config` cannot express (e.g. REMOVING the
 * `hostGate` key from config.json to test the absent-key default): put
 * `e2e-trust-write-ok(<reason>)` in a comment on the same or the preceding
 * line. It is honoured only in a file that also calls `narrowTrust(`, so the
 * key's value is still snapshotted, restored per test and tripwired.
 *
 * See change: triage-browser-e2e-offbox-poison (design D3, test-plan #E21/#E22).
 */
export const TRUST_WRITE_KEYS = [
  "trustedNetworks",
  "bypassHosts",
  "bypassUrls",
  "allowedHosts",
  "hostGate",
  "requireLocalProof",
];

/** Files that implement `narrowTrust` / the baseline and may write trust raw. */
export const TRUST_WRITE_ALLOWLIST = [
  "tests/e2e/fixtures.ts",
  "tests/e2e/global-setup.ts",
  "tests/e2e/helpers/trust-access.ts",
  "tests/e2e/harness-isolation-faults.spec.ts",
];

export const TRUST_WRITE_CORRECTION =
  "await narrowTrust(request, { ...patch }, { touches: [...] })  // from ./fixtures.js";

const KEY_RE = new RegExp(`\\b(${TRUST_WRITE_KEYS.join("|")})\\b`);

/** The balanced `( ... )` argument text starting at the `(` at `open`, or "" when unbalanced. */
function callArguments(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return source.slice(open, i + 1);
  }
  return "";
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

/** Analyze one e2e source for raw trust writes. Returns findings (empty = clean). */
export function analyzeTrustWriteSource(file, source) {
  if (TRUST_WRITE_ALLOWLIST.includes(file)) return [];
  const findings = [];
  const declared = /\bnarrowTrust\s*\(/.test(source);
  const flag = (index, key, how) => {
    if (declared) {
      const lines = source.split("\n");
      const at = lineOf(source, index) - 1;
      if (/e2e-trust-write-ok\(/.test(`${lines[at - 1] ?? ""}\n${lines[at] ?? ""}`)) return;
    }
    findings.push({
      rule: "e2e-trust-write-outside-narrow-trust",
      severity: "error",
      file,
      key,
      message:
        `${file}:${lineOf(source, index)}: ${how} writes trust-bearing key "${key}" outside narrowTrust. ` +
        `A timeout or worker kill never runs afterAll, so the harness stays narrowed for every later spec (#832).\n` +
        `  Correction: ${TRUST_WRITE_CORRECTION}`,
    });
  };

  const calls = [
    { re: /\.put\(\s*["'`]\/api\/config["'`]/g, how: "PUT /api/config", open: (m) => source.indexOf("(", m.index) },
    { re: /\b(?:putConfig|patchConfig)\s*\(/g, how: (m) => `${m[0].replace(/\s*\($/, "")}()`, open: (m) => m.index + m[0].length - 1 },
  ];
  for (const { re, how, open } of calls) {
    for (const m of source.matchAll(re)) {
      // A local helper's own declaration (`function putConfig(`, `const putConfig = async (`) is not a call.
      if (/(?:function|const|let)\s+(?:putConfig|patchConfig)\b/.test(source.slice(Math.max(0, m.index - 12), m.index + m[0].length))) continue;
      const args = callArguments(source, open(m));
      const key = args.match(KEY_RE)?.[1];
      if (key) flag(m.index, key, typeof how === "function" ? how(m) : how);
    }
  }
  for (const m of source.matchAll(/\bdelete\s+[\w.]+\.(trustedNetworks|bypassHosts|bypassUrls|allowedHosts|hostGate|requireLocalProof)\b/g)) {
    flag(m.index, m[1], "delete on a parsed config");
  }
  return findings;
}

/** Every `.ts` source under tests/e2e, relative to the repo root (specs, fixtures and helpers; not nested test dirs). */
function e2eSources(dir) {
  const out = [];
  const walk = (current, rel) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      if (entry.isDirectory()) walk(join(current, entry.name), `${rel}/${entry.name}`);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(`${rel}/${entry.name}`);
    }
  };
  walk(dir, "tests/e2e");
  return out;
}

/** Analyze every `tests/e2e/*.spec.ts` (fixture import) and every e2e source (trust writes). */
export function analyzeRepository(dir = E2E_DIR) {
  const findings = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".spec.ts")) continue;
    const full = join(dir, name);
    findings.push(...analyzeSpecSource(`tests/e2e/${name}`, readFileSync(full, "utf8")));
  }
  for (const rel of e2eSources(dir)) {
    findings.push(...analyzeTrustWriteSource(rel, readFileSync(join(dir, rel.slice("tests/e2e/".length)), "utf8")));
  }
  return findings;
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const findings = analyzeRepository();
  for (const f of findings) console.error(`[${f.severity}] ${f.message}`);
  if (findings.length > 0) {
    console.error(`\n${findings.length} spec(s) bypass the E2E session-reap fixture.`);
    process.exit(1);
  }
  console.log("All tests/e2e/*.spec.ts import test from ./fixtures.js");
}
