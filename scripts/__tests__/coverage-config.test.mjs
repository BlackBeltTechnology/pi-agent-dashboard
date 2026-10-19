/**
 * Root coverage config + `test:coverage` script shape (test-plan E1, E3).
 *
 * Pins what makes the coverage report honest: an explicit `include` (so a
 * source file no test loads is reported at 0%), `reportOnFailure`, the v8
 * provider, and the same isolated-HOME wrapper `test` uses.
 *
 * See change: test-trust-audit (design D1).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { matchesGlob, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import rootConfig from "../../vitest.config.ts";
import scriptsConfig from "../vitest.config.ts";

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

/**
 * `coverage-unloaded` fixture hygiene (change: triage-browser-e2e-offbox-poison,
 * test-plan #E29-#E31, #X17). The scoped coverage scenario proves "an unloaded
 * file is reported at 0%" only while NOTHING imports the fixture's source file.
 */
const FIXTURE_SRC = "scripts/__tests__/fixtures/coverage-unloaded/src/unloaded.ts";
const FIXTURE_DIR = "scripts/__tests__/fixtures/coverage-unloaded/";
const IMPORT_OF_FIXTURE = /(?:\bfrom|\bimport\s*\(|\brequire\s*\()\s*["'][^"']*coverage-unloaded\/src\//;

/** Files (path → source) outside the fixture that import its source. */
const THIS_FILE = "scripts/__tests__/coverage-config.test.mjs";
const fixtureImporters = (files) =>
  Object.entries(files)
    // This file quotes import specifiers as lint samples; it imports nothing from the fixture.
    .filter(([path]) => !path.startsWith(FIXTURE_DIR) && path !== THIS_FILE)
    .filter(([, source]) => IMPORT_OF_FIXTURE.test(source))
    .map(([path]) => path);

describe("coverage-unloaded fixture stays unloaded (E29, X17)", () => {
  it("fails naming an importer outside the fixture; one inside it passes", () => {
    const outside = { "packages/shared/src/x.ts": 'import { neverCalled } from "../../../scripts/__tests__/fixtures/coverage-unloaded/src/unloaded.ts";' };
    expect(fixtureImporters(outside)).toEqual(["packages/shared/src/x.ts"]);
    const inside = { [`${FIXTURE_DIR}passes.fixture.mjs`]: 'import "./src/unloaded.ts"; // coverage-unloaded/src/' };
    expect(fixtureImporters(inside)).toEqual([]);
    const dynamic = { "scripts/__tests__/y.test.mjs": 'await import("./fixtures/coverage-unloaded/src/unloaded.ts");' };
    expect(fixtureImporters(dynamic)).toEqual(["scripts/__tests__/y.test.mjs"]);
  });

  it("the current tree has no importer outside the fixture", () => {
    const tracked = execFileSync("git", ["ls-files", "-z", "--", "*.ts", "*.tsx", "*.mjs", "*.js", "*.cjs"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean);
    const files = Object.fromEntries(
      tracked
        .filter((p) => !p.startsWith(FIXTURE_DIR))
        .map((p) => {
          try {
            return [p, readFileSync(resolve(REPO_ROOT, p), "utf8")];
          } catch {
            return [p, ""]; // deleted in the working tree
          }
        }),
    );
    expect(fixtureImporters(files)).toEqual([]);
  });
});

describe("fixture excluded from the root coverage and test globs (E30)", () => {
  it("is neither counted by the root coverage block nor collected by the scripts project", () => {
    expect(counted(FIXTURE_SRC)).toBe(false);
    // The scripts project's globs are relative to `scripts/`.
    const include = scriptsConfig.test.include;
    const rel = (p) => p.replace(/^scripts\//, "");
    expect(include.some((g) => matchesGlob(rel(FIXTURE_SRC), g))).toBe(false);
    expect(include.some((g) => matchesGlob(rel(`${FIXTURE_DIR}passes.fixture.mjs`), g))).toBe(false);
    // Sanity: the same globs DO collect a real test, so the negative above can fail.
    expect(include.some((g) => matchesGlob("__tests__/coverage-config.test.mjs", g))).toBe(true);
  });
});

describe("sampled coverage scope stays pinned (E31)", () => {
  it("counts the named entry point and excludes the named categories — and claims no more", () => {
    expect(counted("packages/extension/src/bridge.ts")).toBe(true);
    for (const excluded of [
      "packages/extension/src/__tests__/x.test.ts",
      "packages/shared/src/test-support/x.ts",
      "packages/shared/src/x.d.ts",
      "packages/electron/src/x.ts",
    ]) {
      expect(counted(excluded), excluded).toBe(false);
    }
  });
});
