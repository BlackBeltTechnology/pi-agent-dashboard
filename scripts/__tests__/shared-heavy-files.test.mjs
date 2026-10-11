/**
 * The three subprocess-heavy `shared` test groups stay under 10 s per file and keep every
 * assertion (test-plan E14).
 *
 * `ci`-level (`RUN_CI_SCENARIOS=1`): it runs the three groups in a real vitest subprocess and
 * reads per-file durations, which the default parallel run would distort.
 *
 * Groups: `git-checkout-roots` (split in two halves so they run on two workers),
 * `openspec-poller-parity`, `ensure-cli`. The assertion counts are the totals before the split.
 *
 * See change: test-trust-audit (design D7).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const CI_SCENARIOS = process.env.RUN_CI_SCENARIOS === "1";
const MAX_FILE_MS = 10_000;

/** group name -> [file path substring, total assertions across the group's files]. */
const GROUPS = {
  "git-checkout-roots": ["platform/__tests__/git-checkout-roots", 43],
  "openspec-poller-parity": ["__tests__/openspec-poller-parity", 1],
  "ensure-cli": ["tool-registry/__tests__/ensure-cli", 5],
};

describe.skipIf(!CI_SCENARIOS)("heavy shared test groups (E14)", () => {
  it("each file is under 10 s and each group keeps all its assertions", () => {
    const filters = Object.values(GROUPS).map(([f]) => f);
    const res = spawnSync("npx", ["vitest", "run", "--project", "@blackbelt-technology/pi-dashboard-shared", "--reporter=json", ...filters], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CI: "" },
    });
    const report = JSON.parse(res.stdout.slice(res.stdout.indexOf("{")));
    expect(report.numFailedTests).toBe(0);
    for (const [group, [needle, expected]] of Object.entries(GROUPS)) {
      const files = report.testResults.filter((f) => f.name.includes(needle));
      expect(files.length, `${group}: files found`).toBeGreaterThan(0);
      for (const f of files) expect(f.endTime - f.startTime, `${f.name} duration`).toBeLessThan(MAX_FILE_MS);
      expect(
        files.reduce((n, f) => n + f.assertionResults.length, 0),
        `${group}: assertion count`,
      ).toBe(expected);
    }
  }, 300_000);
});
