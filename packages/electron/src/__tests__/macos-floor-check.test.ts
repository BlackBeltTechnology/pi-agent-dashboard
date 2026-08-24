/**
 * The macOS floor check, driven directly by fixtures.
 *
 * Covers test-plan scenarios E4 (comparison operator), E5 (multi-slice
 * safety) and X3 (upstream-floor tripwire diagnostic). The predicate lives in
 * `scripts/macos-floor.mjs` precisely so these can run without a packaged app —
 * previously it existed only as inline shell in `_electron-build.yml` and was
 * unreachable from any test.
 *
 * See change: upgrade-electron-runtime.
 */
import { describe, it, expect } from "vitest";
import {
  MACOS_FLOOR_MINOS_MAJOR,
  checkMinosFloor,
  extractMinosValues,
  // @ts-expect-error — plain .mjs module, no type declarations by design.
} from "../../scripts/macos-floor.mjs";

/** One `otool -l` LC_BUILD_VERSION block, as otool actually prints it. */
function buildVersionBlock(minos: string, index: number): string {
  return [
    `Load command ${index}`,
    "      cmd LC_BUILD_VERSION",
    "  cmdsize 32",
    " platform 1",
    `    minos ${minos}`,
    "      sdk 14.0",
    "   ntools 1",
  ].join("\n");
}

function otoolFixture(...minosValues: string[]): string {
  return [
    "packages/electron/out/PI-Dashboard.app/Contents/MacOS/pi-dashboard:",
    ...minosValues.map((v, i) => buildVersionBlock(v, i + 8)),
    "Load command 99",
    "      cmd LC_MAIN",
    "  cmdsize 24",
  ].join("\n");
}

describe("E4: the floor comparison is equality, not upward-only", () => {
  // Under the old `-gt` comparison the `11` case wrongly PASSED: a below-floor
  // slice was unreachable at a 10.15 target, so nothing guarded that direction.
  it.each([
    { minos: "11.0", expected: "mismatch" },
    { minos: "12.0", expected: "ok" },
    { minos: "13.0", expected: "mismatch" },
  ])("minos $minos against expected 12 → $expected", ({ minos, expected }) => {
    const result = checkMinosFloor({
      otoolOutput: otoolFixture(minos),
      expectedMajor: 12,
    });
    expect(result.status).toBe(expected);
  });

  it("uses 12 as the shipped expected major", () => {
    expect(MACOS_FLOOR_MINOS_MAJOR).toBe(12);
  });

  it("defaults to the shipped expected major when none is passed", () => {
    expect(checkMinosFloor({ otoolOutput: otoolFixture("12.0") }).status).toBe(
      "ok",
    );
    expect(checkMinosFloor({ otoolOutput: otoolFixture("11.0") }).status).toBe(
      "mismatch",
    );
  });
});

describe("E5: the extractor is multi-slice safe", () => {
  const fatBinary = otoolFixture("12.0", "11.0");

  it("collects a minos from EVERY slice, not just the first", () => {
    expect(extractMinosValues(fatBinary)).toEqual(["12.0", "11.0"]);
  });

  it("fails on the below-floor second slice", () => {
    // A first-match-and-exit extractor returns 12.0 here and passes. That is
    // the defect this scenario exists to catch.
    const result = checkMinosFloor({
      otoolOutput: fatBinary,
      expectedMajor: 12,
    });
    expect(result.status).toBe("mismatch");
    expect(result.message).toContain("11.0");
    expect(result.message).toContain("slice 2 of 2");
  });

  it("passes when every slice is at the floor", () => {
    expect(
      checkMinosFloor({
        otoolOutput: otoolFixture("12.0", "12.3"),
        expectedMajor: 12,
      }).status,
    ).toBe("ok");
  });
});

describe("X3: the diagnostic names the upstream Electron floor", () => {
  const result = checkMinosFloor({
    otoolOutput: otoolFixture("13.0"),
    expectedMajor: 12,
  });

  it("fails the check", () => {
    expect(result.status).toBe("mismatch");
  });

  it("attributes the value to the upstream Electron prebuilt", () => {
    expect(result.message).toMatch(/upstream Electron/i);
    expect(result.message).toMatch(/prebuilt/i);
  });

  it("does NOT blame MACOSX_DEPLOYMENT_TARGET", () => {
    // The otooled binary is the renamed Electron prebuilt; our deployment
    // target does not set its minos. The old remediation text was a
    // misdiagnosis (design.md Decision 2) and must not come back.
    expect(result.message).not.toMatch(/MACOSX_DEPLOYMENT_TARGET/);
  });
});

describe("the check degrades to a warning, not a failure, when it cannot measure", () => {
  it("reports not-extractable on unrecognised load-command output", () => {
    const result = checkMinosFloor({
      otoolOutput: "Load command 0\n      cmd LC_SEGMENT_64\n  cmdsize 72",
      expectedMajor: 12,
    });
    expect(result.status).toBe("not-extractable");
  });

  it("reports non-numeric rather than mismatching on a garbage major", () => {
    const result = checkMinosFloor({
      otoolOutput: otoolFixture("n/a"),
      expectedMajor: 12,
    });
    expect(result.status).toBe("non-numeric");
  });

  it("falls back to the legacy LC_VERSION_MIN_MACOSX load command", () => {
    const legacy = [
      "Load command 8",
      "      cmd LC_VERSION_MIN_MACOSX",
      "  cmdsize 16",
      "  version 12.0",
      "      sdk 14.0",
    ].join("\n");
    expect(extractMinosValues(legacy)).toEqual(["12.0"]);
  });
});
