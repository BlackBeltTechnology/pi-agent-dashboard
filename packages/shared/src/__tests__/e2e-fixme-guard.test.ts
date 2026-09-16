/**
 * Repo-lint guard for browser-E2E quarantine (change: stabilize-browser-e2e,
 * task 4.1; design D5).
 *
 * Triage of the red baseline may quarantine a spec that fails for a PRODUCT
 * reason. Quarantine hides regressions, so every conditional `test.fixme` MUST
 * link the issue that tracks the real fix — an unlinked one is an invisible
 * hole in the strongest gate on the ship-it path.
 *
 *   test.fixme(true, "flaky")                     → REJECTED (no issue link)
 *   test.fixme(true, "…/issues/42")               → ok
 *   test.fixme("a title", async () => {})          → ok (unconditional skip
 *                                                    with a documented reason,
 *                                                    not a quarantine)
 *
 * Also runs `npm run lint:e2e`-adjacent checks? No — this file owns ONLY the
 * fixme rule; `scripts/check-e2e-fixture-import.mjs` owns the import rule.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const E2E_DIR = path.join(REPO_ROOT, "tests", "e2e");

/**
 * Conditional `test.fixme(<cond>, "<reason>")` calls whose reason has no
 * `/issues/<n>` link. The first argument is captured only up to `,` or `(` so a
 * string-literal first arg (the unconditional `test.fixme(title, body)` form)
 * is recognized and skipped.
 */
export function unlinkedFixmes(source: string): string[] {
  const findings: string[] = [];
  const re =
    /test\.fixme\(\s*([^,(]+?)\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  for (const m of source.matchAll(re)) {
    const first = m[1].trim();
    if (/^["'`]/.test(first)) continue; // unconditional skip, not a quarantine
    const reason = m[2].slice(1, -1);
    if (!/issues\/\d+/.test(reason)) findings.push(reason);
  }
  return findings;
}

/** Every `*.spec.ts` under tests/e2e/ (recursive). */
function specFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".spec.ts")) out.push(p);
    }
  };
  walk(E2E_DIR);
  return out;
}

describe("e2e fixme guard", () => {
  it("rejects a conditional fixme whose reason has no issue link", () => {
    expect(unlinkedFixmes(`test.fixme(true, "flaky");`)).toEqual(["flaky"]);
  });

  it("accepts a conditional fixme linked to an issue", () => {
    expect(
      unlinkedFixmes(`test.fixme(true, "https://github.com/o/r/issues/42");`),
    ).toEqual([]);
  });

  it("ignores the unconditional test.fixme(title, body) form", () => {
    // Pre-existing specs use this with a justification comment + an L1
    // equivalent; it is a deliberate permanent skip, not a quarantine.
    expect(unlinkedFixmes(`test.fixme("payload renders", async () => {});`)).toEqual([]);
  });

  it("every conditional fixme under tests/e2e/ links its issue", () => {
    const offenders: string[] = [];
    for (const file of specFiles()) {
      for (const reason of unlinkedFixmes(fs.readFileSync(file, "utf8"))) {
        offenders.push(`${path.relative(REPO_ROOT, file)}: test.fixme(..., "${reason}")`);
      }
    }
    expect(
      offenders,
      "quarantined E2E specs must link an issue: test.fixme(true, \"<issue url>\")",
    ).toEqual([]);
  });
});
