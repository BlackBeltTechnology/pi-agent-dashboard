import { defineConfig } from "vitest/config";
import { PARALLEL_MAX_WORKERS } from "../../vitest.workers";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    pool: "forks",
    maxWorkers: PARALLEL_MAX_WORKERS,
  },
});
