import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    // Must match the default-group peers: the root runner refuses to group two
    // projects that disagree on maxWorkers under the same sequence.groupOrder.
    maxWorkers: "50%",
  },
});
