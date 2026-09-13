import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    // Real plugin + engine boot + async run-store writes; the 5s default blew
    // under fork contention. Contention headroom, not a hang budget.
    // See change: contention-harden-real-process-tests.
    testTimeout: 30_000,
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
  },
  resolve: {
    // Worktree-local runtime/shared source wins over the hoisted-workspace
    // symlink (which escapes to the main checkout) so tests see the code under
    // test — `usePluginConfigOf` is an export that exists only in this worktree
    // until it lands. Mirrors packages/blackhole-plugin/vitest.config.ts.
    // Specific subpath keys MUST precede the bare key (alias matches by prefix).
    // See change: model-picker-everywhere-favorites (design D3).
    alias: {
      "@blackbelt-technology/dashboard-plugin-runtime/server": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/server/index.ts",
      ),
      "@blackbelt-technology/dashboard-plugin-runtime/context": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/plugin-context.tsx",
      ),
      "@blackbelt-technology/dashboard-plugin-runtime/test-support": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/test-support/index.ts",
      ),
      "@blackbelt-technology/dashboard-plugin-runtime/manifest-validator": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/manifest-validator.ts",
      ),
      "@blackbelt-technology/dashboard-plugin-runtime": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/index.ts",
      ),
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
    },
  },
});
