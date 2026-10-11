/**
 * Root coverage config + `test:coverage` script shape (test-plan E1, E3).
 *
 * Pins what makes the coverage report honest: an explicit `include` (so a
 * source file no test loads is reported at 0%), `reportOnFailure`, the v8
 * provider, and the same isolated-HOME wrapper `test` uses.
 *
 * See change: test-trust-audit (design D1).
 */
import { readFileSync } from "node:fs";
import { matchesGlob, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import rootConfig from "../../vitest.config.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const coverage = rootConfig.test.coverage;
const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));

const counted = (file) =>
  coverage.include.some((g) => matchesGlob(file, g)) && !coverage.exclude.some((g) => matchesGlob(file, g));

describe("root vitest coverage block (E1)", () => {
  it("counts the unloaded entry point", () => {
    expect(counted("packages/extension/src/bridge.ts")).toBe(true);
  });

  it.each([
    "packages/extension/src/__tests__/x.test.ts",
    "packages/shared/src/test-support/x.ts",
    "packages/electron/src/x.ts",
    "packages/shared/src/x.d.ts",
  ])("excludes %s", (file) => {
    expect(counted(file)).toBe(false);
  });

  it("uses v8 and keeps the report when a test fails", () => {
    expect(coverage.provider).toBe("v8");
    expect(coverage.reportOnFailure).toBe(true);
  });
});

describe("test:coverage script (E3)", () => {
  const script = pkg.scripts["test:coverage"];

  it("carries the isolated-HOME + localStorage wrapper and enables coverage", () => {
    expect(script).toContain("HOME=$(mktemp -d -t pi-test-");
    expect(script).toContain("--localstorage-file=");
    expect(script).toContain("--coverage");
  });
});
