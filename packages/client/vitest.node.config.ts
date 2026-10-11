import path from "node:path";
import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";
import base from "./vitest.config";
import { NODE_ENV_TESTS } from "./vitest.node-tests";

/**
 * Second client project: pure (DOM-free) tests under the `node` environment.
 *
 * A separate config file rather than an inline `extends` on purpose: vitest 4 merges an
 * `extends` project through `mergeConfig`, which CONCATENATES arrays (`include`, `exclude`,
 * `setupFiles`), so an inline node project would inherit the jsdom setup files and its own
 * globs would still be excluded. See change: test-trust-audit (design D5).
 *
 * The jsdom project (`vitest.config.ts`) excludes the same list, so no file runs in both.
 */
export default defineConfig({
  resolve: base.resolve,
  test: {
    name: "@blackbelt-technology/pi-dashboard-web-node",
    root: path.resolve(__dirname),
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    include: [...NODE_ENV_TESTS],
    globalSetup: base.test?.globalSetup,
    testTimeout: base.test?.testTimeout,
  },
});
