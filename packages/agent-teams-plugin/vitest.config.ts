import path from "node:path";
import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    // Server/bridge-centric package (store, lane handlers, faux-pi-rpc
    // harness): node env. A client test opts into jsdom with a
    // `// @vitest-environment jsdom` docblock.
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
    // Per-file HOME isolation — the team store writes under
    // `$HOME/.pi/dashboard/…`; parallel forks must not share one store dir.
    setupFiles: [path.resolve(__dirname, "../shared/src/test-support/setup-home-perfile.ts")],
  },
});
