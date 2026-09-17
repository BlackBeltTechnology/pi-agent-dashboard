import path from "node:path";
import { defineConfig } from "vitest/config";
import { REAL_PROCESS_TESTS } from "./vitest.real-process-files";

/**
 * The real-process phase (change: isolate-real-process-tests).
 *
 * Deliberately NOT listed in the root `test.projects`: vitest runs projects
 * concurrently over one fork pool, so a low `maxWorkers` here would not
 * protect these tests — sibling projects would still saturate the CPU. Only
 * SEQUENCING does. The root `test` script therefore runs the parallel
 * projects first, then this config, on a machine that has gone idle.
 *
 * Mirrors `vitest.config.ts` (environment, pool, globalSetup, setupFiles,
 * resolve.alias) and changes only the concurrency + budgets + retry.
 */
export default defineConfig({
  test: {
    name: "server-real-process",
    // The root `test` script invokes this config from the REPO root, where
    // vitest would otherwise resolve `src/**` against the repo root and
    // collect zero files (a silently-empty phase). Pin the root to the package
    // so the paths mean the same thing from either cwd.
    root: __dirname,
    include: [...REAL_PROCESS_TESTS],
    environment: "node",
    pool: "forks",
    // Two forks, not `PARALLEL_MAX_WORKERS`: every member spawns at least one
    // real child process, so the effective process count is already double.
    maxWorkers: 2,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // CI-only, single, and scoped to this project alone: a real-process test
    // that fails twice still blocks. A retried PASS stays a visible event
    // rather than a silent one via the JSON report CI uploads: vitest 4 has no
    // `retryCount` field, but it keeps the failed attempt's error, so the
    // retried-pass signature is `status: passed` + non-empty `failureMessages`
    // (triage recipe in .pi/skills/ci-troubleshoot/SKILL.md).
    // Locally the count is 0, so a developer sees the first failure.
    retry: process.env.CI ? 1 : 0,
    // Separate output file from the parallel phase's, so the second run does
    // not clobber the first; ci.yml uploads `test-results/vitest*.json`.
    ...(process.env.CI
      ? {
          reporters: ["default", "json"] as const,
          outputFile: {
            json: path.resolve(__dirname, "../../test-results/vitest-real-process.json"),
          },
        }
      : {}),
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
    setupFiles: [path.resolve(__dirname, "../shared/src/test-support/setup-home-perfile.ts")],
  },
  resolve: {
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
      "@blackbelt-technology/dashboard-plugin-runtime/server": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/server/index.ts",
      ),
      "@blackbelt-technology/dashboard-plugin-runtime": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/index.ts",
      ),
    },
  },
});
