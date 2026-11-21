import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../../vitest.workers";

/**
 * Vitest project for the switch-extension-source skill script.
 *
 * `switch-source.ts` rewrites global + project pi settings; its prune rule is
 * what keeps an empty project filter from shadowing the dashboard bridge
 * (REGISTER_TIMEOUT). Registered in the root `vitest.config.ts`.
 *
 * See change: fix-switch-source-empty-overlay.
 */
export default defineConfig({
  test: {
    include: ["scripts/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
  },
});
