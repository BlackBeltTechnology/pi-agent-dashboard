import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    // Match the repo-wide project convention so the root runner can group this
    // project with the others. See change: fix-kb-search-retrieval-quality.
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
  },
});
