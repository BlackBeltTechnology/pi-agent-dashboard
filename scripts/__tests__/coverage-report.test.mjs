/**
 * Live `npm run test:coverage` scenarios (test-plan E2, X1).
 *
 * `ci`-level, behind RUN_CI_SCENARIOS=1 and run by `npm run test:ci-scenarios`:
 * the extension-project run loads the whole extension suite under v8
 * instrumentation, which in the default parallel run starves unrelated
 * 5s-timeout tests.
 *
 * See change: test-trust-audit (design D1).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CI_SCENARIOS = process.env.RUN_CI_SCENARIOS === "1";
const RUN_TIMEOUT_MS = 600_000;

function runCoverage(args) {
  const reportsDir = mkdtempSync(join(tmpdir(), "pi-cov-"));
  const res = spawnSync(
    "npm",
    ["run", "test:coverage", "--", `--coverage.reportsDirectory=${reportsDir}`, ...args],
    // The wrapper sets its own HOME; do not leak a parent vitest's worker env into the child.
    { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, CI: "" }, maxBuffer: 64 * 1024 * 1024 },
  );
  const summaryPath = join(reportsDir, "coverage-summary.json");
  return { res, summaryPath };
}

describe.skipIf(!CI_SCENARIOS)("test:coverage (live)", () => {
  it(
    "E2 reports the unloaded entry point at 0% and counts its lines",
    () => {
      // A path filter, NOT `--project`: with `--project` vitest 4 resolves the
      // `coverage.include` glob against that project's root, so no unloaded file
      // outside it (here: nothing under packages/extension) is ever discovered.
      const { summaryPath } = runCoverage(["packages/extension/src/"]);
      expect(existsSync(summaryPath)).toBe(true);
      const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      const key = Object.keys(summary).find((k) => k.endsWith("packages/extension/src/bridge.ts"));
      expect(key, "bridge.ts present in the coverage summary").toBeDefined();
      // Slice C (bridge extraction) flips this to `> 0` once handler modules are loaded by tests.
      expect(summary[key].lines.pct).toBe(0);
      expect(summary[key].lines.total).toBeGreaterThan(1000);
      expect(summary.total.lines.total).toBeGreaterThanOrEqual(summary[key].lines.total);
    },
    RUN_TIMEOUT_MS,
  );

  it(
    "X1 still writes the report when a test fails",
    () => {
      const { res, summaryPath } = runCoverage(["--config", "scripts/__tests__/fixtures/coverage-failing/vitest.config.mjs"]);
      expect(res.status).not.toBe(0);
      expect(existsSync(summaryPath)).toBe(true);
      expect(statSync(summaryPath).size).toBeGreaterThan(0);
    },
    RUN_TIMEOUT_MS,
  );
});
