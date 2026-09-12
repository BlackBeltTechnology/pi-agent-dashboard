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
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
    // Per-file HOME isolation — the relocated goal-store/-routes/-supervisor
    // suites wrote through `$HOME/.pi/dashboard/goals` under the server
    // package's per-file HOME; keep that isolation now that they run in this
    // package (else parallel forks + sequential tests share one store dir).
    // See change: relocate-goal-product-to-plugin (test move, D4).
    setupFiles: [path.resolve(__dirname, "../shared/src/test-support/setup-home-perfile.ts")],
  },
});
