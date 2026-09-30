import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    // Was `poolOptions: { forks: { singleFork: true } }`, which vitest 4 dropped
    // and silently ignored — the suite already ran on the default worker
    // count. Every test isolates itself in its own mkdtemp dir. Now collected
    // by the root runner, so it must match its default-group peers.
    // See change: speed-up-ci-affected-tests.
    maxWorkers: PARALLEL_MAX_WORKERS,
  },
});
