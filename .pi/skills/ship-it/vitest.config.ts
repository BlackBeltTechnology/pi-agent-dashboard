import { defineConfig } from "vitest/config";

/**
 * Vitest project for the ship-it skill's pure decision helpers.
 *
 * These helpers (`manifest.ts`, `no-weakening.ts`, `review-gate.ts`) gate real
 * ship decisions, but nothing under `.pi/skills/` was collected by any vitest
 * project before this config existed — so `assertNoWeakening`, `parseManifest`,
 * `deferDecision` and `filesystemRealityCheck` all shipped untested. Registering
 * this project in the root `vitest.config.ts` is what makes them runnable.
 *
 * See change: wire-local-review-gate.
 */
export default defineConfig({
  test: {
    include: ["scripts/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: "50%",
  },
});
