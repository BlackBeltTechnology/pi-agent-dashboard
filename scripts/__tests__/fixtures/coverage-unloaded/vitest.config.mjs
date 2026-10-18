// Root config with `projects` replaced by one green fixture, so the root
// `test.coverage` block (provider, reporters) is what runs — but the coverage
// scope is pinned to the one source file no test loads. This is what lets the
// "unloaded file is reported at 0%" scenario run in seconds instead of
// re-instrumenting the whole repository suite (#862).
// See change: triage-browser-e2e-offbox-poison (design D5).
import { defineConfig } from "vitest/config";
import rootConfig from "../../../../vitest.config.ts";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    ...rootConfig.test,
    projects: undefined,
    globalSetup: undefined,
    include: ["passes.fixture.mjs"],
    // The root `exclude` carries `**/__tests__/**`, which this fixture's own path
    // (scripts/__tests__/fixtures/...) matches, so it must be overridden or the
    // unloaded file is excluded and the report is empty.
    coverage: { ...rootConfig.test.coverage, include: ["src/unloaded.ts"], exclude: ["**/node_modules/**"] },
  },
});
