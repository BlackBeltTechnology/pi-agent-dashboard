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

import { readFileSync, readdirSync } from "node:fs";
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

/** Analyze every `tests/e2e/*.spec.ts` in the repo. */
export function analyzeRepository(dir = E2E_DIR) {
  const findings = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".spec.ts")) continue;
    const full = join(dir, name);
    findings.push(...analyzeSpecSource(`tests/e2e/${name}`, readFileSync(full, "utf8")));
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
