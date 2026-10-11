// Root config with `projects` replaced by the one red fixture, so the root
// `test.coverage` block (reportOnFailure, provider, reporters) is what runs.
import { defineConfig } from "vitest/config";
import rootConfig from "../../../../vitest.config.ts";

export default defineConfig({
  root: import.meta.dirname,
  test: {
    ...rootConfig.test,
    projects: undefined,
    globalSetup: undefined,
    include: ["failing.fixture.mjs"],
    // Narrow include: the fixture only needs the report to exist, not a full-repo scan.
    coverage: { ...rootConfig.test.coverage, include: ["packages/shared/src/index.ts"] },
  },
});
