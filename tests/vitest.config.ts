import { defineConfig } from "vitest/config";

/**
 * Vitest project for repo-root /tests.
 *
 * Deliberately narrow: it collects ONLY unit tests for the pure helpers under
 * `e2e/helpers/__tests__/`. Playwright specs (`e2e/*.spec.ts`) must never be
 * collected here — they need a running docker harness and a browser, and are
 * driven by `npm run test:e2e`.
 *
 * Added because the evidence-path resolver is pure logic used by two specs
 * that are BOTH opt-in (`PI_SYNTH_AGENT_TICKS=1`), so nothing in normal CI
 * could execute it. See issue #549.
 */
export default defineConfig({
  test: {
    include: ["e2e/helpers/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: "50%",
  },
});
