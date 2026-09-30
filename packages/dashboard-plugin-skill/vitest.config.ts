import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    // Serial, the vitest-4 spelling of the former `poolOptions.forks.singleFork`
    // (vitest 4 dropped `poolOptions`). Same shape as the other serial peers
    // (mockup-loop, nano-banana), so the root runner can group it.
    // See change: speed-up-ci-affected-tests.
    maxWorkers: 1,
  },
});
