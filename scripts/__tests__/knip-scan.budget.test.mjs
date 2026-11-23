/**
 * Whole-workspace Knip scan wall-clock budget (test-plan #P4, #E31).
 *
 * Budget lane: this file is named `*.budget.test.*`, so `BUDGET_TEST_EXCLUDE`
 * (vitest.workers.ts) keeps it out of every blocking run; the nightly `budget`
 * job sets RUN_BUDGET_TESTS=1 and collects it. No env gate of its own.
 *
 * Split from `knip-scan.test.mjs`, whose live-scan assertions stay blocking.
 * This file times its own scan in `beforeAll`, as `knip-scan.test.mjs` does.
 *
 * See change: stabilize-blocking-test-lanes.
 */
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SCAN_TIMEOUT_MS = 180_000;

describe("live knip scan budget", () => {
  let elapsedMs;

  beforeAll(() => {
    const started = Date.now();
    try {
      // Non-zero exit is the normal state while the baseline is above zero.
      execSync("npx knip --reporter json --no-progress", {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      // The scan's exit status is not what this file measures.
    }
    elapsedMs = Date.now() - started;
  }, SCAN_TIMEOUT_MS);

  it("#P1 completes within the 30s budget (45s on CI)", () => {
    // 30 s on a dev machine (the scan takes ~8-10 s there). On a loaded CI runner the same scan ran
    // 16-19 s on develop and 23-31 s on busy PR runs, so CI gets contention headroom, as the other
    // timing budgets do (`process.env.CI ? looser : tight`).
    expect(elapsedMs).toBeLessThan(process.env.CI ? 45_000 : 30_000);
  });
});
