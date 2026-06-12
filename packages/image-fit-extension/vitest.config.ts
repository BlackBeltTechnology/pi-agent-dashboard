import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    maxWorkers: 1,
    // Image-resize tests process multi-megapixel inputs; default 5s is borderline.
    testTimeout: 30000,
  },
});
