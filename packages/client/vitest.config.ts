import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    pool: "forks",
    maxWorkers: "50%",
    // Headroom for `waitFor`-based assertions (asyncUtilTimeout raised to 5s in
    // the setup) so a slow-under-contention poll finishes inside the test
    // budget instead of tripping the 5s default. A genuine hang still fails at
    // 15s; fast tests finish immediately, unaffected.
    // See change: fix-flaky-full-suite-tests.
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
    },
  },
});
