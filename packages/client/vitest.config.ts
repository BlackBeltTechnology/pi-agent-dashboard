import { defineConfig } from "vitest/config";
import path from "node:path";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    // Headroom for `waitFor`-based assertions (asyncUtilTimeout raised to 10s
    // in the setup) so a slow-under-contention poll finishes inside the test
    // budget instead of tripping Testing-Library's 1s default. The 5s margin
    // between that poll ceiling and this 15s test timeout is deliberate: a
    // genuine hang still fails, fast tests finish immediately.
    // See changes: fix-flaky-full-suite-tests, contention-harden-real-process-tests.
    testTimeout: 15_000,
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
    // jsdom has no layout/ResizeObserver → TanStack Virtual renders 0 rows.
    // This shim gives the ChatView scroll container a tall viewport so windowed
    // rows mount for content assertions. See change: virtualize-chat-transcript-tanstack.
    setupFiles: ["./src/test-support/virtualizer-jsdom.ts"],
  },
  resolve: {
    // Mirror vite.config alias — worktree-local source wins over the
    // hoisted-workspace symlink so tests see the same code the build does.
    // See change: redesign-session-card-and-composer (config-driven-workflow).
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
      "@blackbelt-technology/pi-dashboard-client-utils": path.resolve(__dirname, "../client-utils/src"),
      // Worktree-local runtime source for the same reason — the runtime's slot
      // consumers gained the claims-invalidation subscription this change
      // gates on. Specific subpath keys MUST precede the bare key (alias
      // matches by prefix). See change: add-blackhole-session-pipeline.
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
      "@blackbelt-technology/dashboard-plugin-runtime": path.resolve(
        __dirname,
        "../dashboard-plugin-runtime/src/index.ts",
      ),
    },
  },
});
