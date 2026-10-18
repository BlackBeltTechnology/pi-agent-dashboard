/**
 * Live `npm run test:coverage` scenarios (test-plan E2, X1).
 *
 * E2 proves the property the audit cared about — a source file in scope that no
 * test loads is reported at 0% with its lines counted — on a SCOPED run: the
 * `coverage-unloaded` fixture owns one source file nothing imports, and pins
 * `coverage.include` to it. The previous E2 re-instrumented the whole repository
 * suite (measured 736 s on the nightly against a 600 s ceiling, #862) to assert
 * something a single-file scope asserts equally well. The full-repo guarantee
 * stays where it belongs: the pinned `include` in coverage-config.test.mjs.
 *
 * `ci`-level, behind RUN_CI_SCENARIOS=1 and run by `npm run test:ci-scenarios`.
 *
 * See changes: test-trust-audit (design D1), triage-browser-e2e-offbox-poison (design D5).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CI_SCENARIOS = process.env.RUN_CI_SCENARIOS === "1";

/** Scoped config for E2: one unloaded source file, one green no-op test. */
const UNLOADED_CONFIG = "scripts/__tests__/fixtures/coverage-unloaded/vitest.config.mjs";
const UNLOADED_FILE_SUFFIX = "scripts/__tests__/fixtures/coverage-unloaded/src/unloaded.ts";
/**
 * Measured wall clock of the scoped `npm run test:coverage` invocation (spawn to
 * exit, including the npm and vitest start-up): 814 ms on CI (PR #955, run
 * 39111480624, job `ci-scenarios`; ~1.2 s on a developer machine, vitest itself
 * reports 74 ms). The full-repo invocation it replaced measured 736 s on the
 * nightly (run 38504381607) against its 600 s ceiling.
 */
const SCOPED_RUN_MEASURED_MS = 814;
/** Ceiling for the scoped run: at least 1.5x the measurement above (asserted below). */
const SCOPED_RUN_TIMEOUT_MS = 120_000;
/** X1 keeps its full ceiling: its failing fixture run is unrelated to #862. */
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
    "E2 reports a source file no test loads at 0% and counts its lines (scoped run)",
    () => {
      const started = Date.now();
      const { res, summaryPath } = runCoverage(["--config", UNLOADED_CONFIG]);
      const elapsedMs = Date.now() - started;
      expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
      expect(existsSync(summaryPath)).toBe(true);
      const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
      const key = Object.keys(summary).find((k) => k.endsWith(UNLOADED_FILE_SUFFIX));
      expect(key, "the unloaded fixture file is present in the coverage summary").toBeDefined();
      expect(summary[key].lines.pct).toBe(0);
      expect(summary[key].lines.total).toBeGreaterThan(0);
      expect(summary.total.lines.total).toBeGreaterThanOrEqual(summary[key].lines.total);
      // P3 — the scoped run finishes well inside its declared ceiling.
      expect(elapsedMs, `scoped coverage run took ${elapsedMs} ms`).toBeLessThan(SCOPED_RUN_TIMEOUT_MS);
    },
    SCOPED_RUN_TIMEOUT_MS,
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

// P3/P4 — static: the declared ceiling derives from the recorded measurement, and
// the scoped invocation cannot grow with the repository.
describe("scoped coverage scenario budget (P3, P4)", () => {
  it("P3 the ceiling is at least 1.5x the recorded measurement", () => {
    expect(SCOPED_RUN_TIMEOUT_MS).toBeGreaterThanOrEqual(1.5 * SCOPED_RUN_MEASURED_MS);
  });

  it("P4 the spawned config's include resolves to the fixture only and loads no project", () => {
    const config = readFileSync(join(REPO_ROOT, UNLOADED_CONFIG), "utf8");
    expect(config).toMatch(/include:\s*\["src\/unloaded\.ts"\]/);
    expect(config).toMatch(/projects:\s*undefined/);
    expect(config).toMatch(/include:\s*\["passes\.fixture\.mjs"\]/);
    // The only repo config it reads is the root one (for the coverage provider/reporters).
    expect([...config.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1])).toEqual([
      "vitest/config",
      "../../../../vitest.config.ts",
    ]);
  });
});
