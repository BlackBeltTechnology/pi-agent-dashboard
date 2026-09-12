import { defineConfig } from "vitest/config";
import path from "node:path";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
    // Many server tests boot a full server (via `vi.resetModules()` + a fresh
    // `import("../server.js")`), spawn git worktree operations, or probe
    // subprocess state — legitimately slow work. `pool: "forks"` gives each
    // fork its OWN unshared vite transform cache, so the first heavy import in
    // a fork cold-transforms the whole server tree; under the saturated full
    // suite (325 files) that transform balloons (~90s aggregate) and a starved
    // fork can exceed even a 15s budget, producing "Test timed out" flakes that
    // pass in isolation (recovery-offer, doctor-route, git-pr-operations, ...).
    // Raise the floor well above the observed contention ceiling so healthy
    // tests stop tripping; a genuine hang still fails, just at 30s. Fast tests
    // finish immediately, unaffected.
    testTimeout: 30_000,
    // `hookTimeout` defaults to 10s INDEPENDENTLY of `testTimeout`, and four
    // server specs boot a full server in `beforeEach` — under 8-fork
    // contention those hooks blew 10s while the test budget was already 30s.
    // Match the test budget. See change: contention-harden-real-process-tests.
    hookTimeout: 30_000,
    globalSetup: ["@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts"],
    // Config-relative path (not the package name) so the worktree-local source
    // wins over the hoisted-workspace node_modules symlink, mirroring the
    // client config's resolve.alias rationale. See change: parallelize-test-suite.
    setupFiles: [path.resolve(__dirname, "../shared/src/test-support/setup-home-perfile.ts")],
  },
  resolve: {
    // Worktree-local shared source wins over the hoisted-workspace symlink
    // (which escapes to the main checkout), so tests see the same code the
    // build does. Mirrors packages/client/vitest.config.ts resolve.alias.
    alias: {
      "@blackbelt-technology/pi-dashboard-shared": path.resolve(__dirname, "../shared/src"),
      // Worktree-local runtime source wins for the same reason — server.ts
      // calls `createIsPiExtensionInstalled`, an export that exists only in
      // this worktree until it lands. Specific `/server` key MUST precede the
      // bare key (alias matches by prefix). See change:
      // add-blackhole-session-pipeline.
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
