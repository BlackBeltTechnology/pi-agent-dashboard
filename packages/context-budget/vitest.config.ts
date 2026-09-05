import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    // Must match the default-group peers: the root runner refuses to group two
    // projects that disagree on maxWorkers under the same sequence.groupOrder.
    maxWorkers: PARALLEL_MAX_WORKERS,
  },
});
