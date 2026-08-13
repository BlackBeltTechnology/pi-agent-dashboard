import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    // Serial on purpose: these tests share the extension's reindex state.
    // A distinct groupOrder is REQUIRED — the root runner refuses to group two
    // projects that disagree on maxWorkers under the same order.
    // See change: fix-kb-search-retrieval-quality.
    maxWorkers: 1,
    sequence: { groupOrder: 1 },
  },
});
