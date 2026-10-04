/**
 * The macOS floor check, driven directly by fixtures.
 *
 * Covers test-plan scenarios E4 (comparison operator), E5 (multi-slice
 * safety) and X3 (upstream-floor tripwire diagnostic). The predicate lives in
 * `scripts/macos-floor.mjs` precisely so these can run without a packaged app —
 * previously it existed only as inline shell in `_electron-build.yml` and was
 * unreachable from any test.
 *
 * Also covers the extractor canary and the floor-check workflow contract
 * (fix-ci-pipeline-followups test-plan E1 E3 E4 E5 E6 X1 X2).
 *
 * See change: upgrade-electron-runtime, fix-ci-pipeline-followups.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  MACOS_FLOOR_MINOS_MAJOR,
  checkCanary,
  checkMinosFloor,
  extractMinosValues,
  producedBinaryVerdict,
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

// ─── Extractor canary (change: fix-ci-pipeline-followups, #533) ─────────────
//
// The produced-binary check tolerates an unextractable / non-numeric minos
// (::warning:: + exit 0). That tolerance is only safe if the extractor is
// proven NOT blind on a binary we KNOW carries LC_BUILD_VERSION: the
// installed Electron prebuilt. `checkCanary` is the pure verdict; the otool
// exec stays in verify-macos-floor.mjs (this project runs on Linux).

const SAMPLE =
  "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";

describe("E3: a blind extractor fails the canary", () => {
  const result = checkCanary({
    otoolOutput: "Load command 0\n      cmd LC_SEGMENT_64\n  cmdsize 72",
    samplePath: SAMPLE,
    expectedMajor: 12,
  });

  it("reports blind-extractor", () => {
    expect(result.status).toBe("blind-extractor");
  });

  it("names the extractor and the sample", () => {
    expect(result.message).toContain("extractMinosValues");
    expect(result.message).toContain(SAMPLE);
  });

  it("maps to ::error:: + exit 1, never a warning", () => {
    expect(result.level).toBe("error");
    expect(result.exitCode).toBe(1);
  });
});

describe("E5: a non-numeric canary result fails the canary", () => {
  const result = checkCanary({
    otoolOutput: otoolFixture("n/a"),
    samplePath: SAMPLE,
    expectedMajor: 12,
  });

  it("is not ok", () => {
    expect(result.status).not.toBe("ok");
    expect(result.status).toBe("non-numeric");
  });

  it("maps to the error verdict, not the produced-binary warning", () => {
    expect(result.level).toBe("error");
    expect(result.exitCode).toBe(1);
    // The produced-binary path maps the same status to a passing warning —
    // the asymmetry is the point.
    expect(
      producedBinaryVerdict(
        checkMinosFloor({ otoolOutput: otoolFixture("n/a"), expectedMajor: 12 }),
      ),
    ).toEqual({ level: "warning", exitCode: 0 });
  });
});

describe("X1: the canary cannot run its tool", () => {
  const result = checkCanary({
    execFailed: "spawn otool ENOENT",
    samplePath: SAMPLE,
    expectedMajor: 12,
  });

  it("fails with exec-failed naming the extractor and the sample", () => {
    expect(result.status).toBe("exec-failed");
    expect(result.message).toContain("extractMinosValues");
    expect(result.message).toContain(SAMPLE);
    expect(result.message).toContain("ENOENT");
  });

  it("maps to ::error:: + exit 1, not the warning+exit-0 produced-binary path", () => {
    expect(result.level).toBe("error");
    expect(result.exitCode).toBe(1);
  });
});

describe("X2: the canary sample is missing", () => {
  const result = checkCanary({
    sampleMissing: true,
    samplePath: SAMPLE,
    expectedMajor: 12,
  });

  it("fails with sample-missing naming the sample path", () => {
    expect(result.status).toBe("sample-missing");
    expect(result.message).toContain(SAMPLE);
    expect(result.message).toMatch(/install\.js/);
  });

  it("maps to ::error:: + exit 1", () => {
    expect(result.level).toBe("error");
    expect(result.exitCode).toBe(1);
  });

  it("does not consult otool output when the sample is missing", () => {
    // Even a perfect otool text cannot rescue a missing sample.
    const r = checkCanary({
      sampleMissing: true,
      otoolOutput: otoolFixture("12.0"),
      samplePath: SAMPLE,
      expectedMajor: 12,
    });
    expect(r.status).toBe("sample-missing");
  });
});

describe("canary: a mismatching sample also fails", () => {
  it("maps mismatch to ::error:: + exit 1", () => {
    const r = checkCanary({
      otoolOutput: otoolFixture("13.0"),
      samplePath: SAMPLE,
      expectedMajor: 12,
    });
    expect(r.status).toBe("mismatch");
    expect(r.level).toBe("error");
    expect(r.exitCode).toBe(1);
  });
});

describe("E4: a passing canary keeps the produced-binary tolerance intact", () => {
  it("canary ok on a single numeric slice", () => {
    const r = checkCanary({
      otoolOutput: otoolFixture("12.0"),
      samplePath: SAMPLE,
      expectedMajor: 12,
    });
    expect(r.status).toBe("ok");
    expect(r.level).toBe("ok");
    expect(r.exitCode).toBe(0);
  });

  it("produced binary with no minos still warns and passes", () => {
    const produced = checkMinosFloor({
      otoolOutput: "Load command 0\n      cmd LC_SEGMENT_64\n  cmdsize 72",
      expectedMajor: 12,
    });
    expect(produced.status).toBe("not-extractable");
    expect(producedBinaryVerdict(produced)).toEqual({
      level: "warning",
      exitCode: 0,
    });
  });

  it("produced-binary verdicts for ok / mismatch are unchanged", () => {
    expect(
      producedBinaryVerdict(
        checkMinosFloor({ otoolOutput: otoolFixture("12.0"), expectedMajor: 12 }),
      ),
    ).toEqual({ level: "ok", exitCode: 0 });
    expect(
      producedBinaryVerdict(
        checkMinosFloor({ otoolOutput: otoolFixture("13.0"), expectedMajor: 12 }),
      ),
    ).toEqual({ level: "error", exitCode: 1 });
  });
});

// ─── Workflow contract (_electron-build.yml) ───────────────────────────────

const WORKFLOW_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../.github/workflows/_electron-build.yml",
);
const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");

const FLOOR_STEP = "Verify macOS deployment target floor";

/** Split the build job's step list into `{ name, body }` by `- name:` lines. */
function steps(text: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /^ {6}- name: (.+)$/gm;
  const marks = [...text.matchAll(re)];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    out.push({ name: m[1].trim(), body: text.slice(m.index, end) });
  });
  return out;
}

describe("E1: the canary sample is installed before the floor check (darwin)", () => {
  const all = steps(workflow);
  const floorIdx = all.findIndex((s) => s.name.startsWith(FLOOR_STEP));
  const installIdx = all.findIndex(
    (s) =>
      /if:\s*matrix\.platform == 'darwin'/.test(s.body) &&
      /node install\.js/.test(s.body),
  );

  it("has a darwin step running node install.js", () => {
    expect(installIdx, "no darwin `node install.js` step").toBeGreaterThanOrEqual(0);
  });

  it("resolves the electron dir through the tool registry", () => {
    expect(all[installIdx].body).toContain(
      "node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron",
    );
  });

  it("runs before the floor-check step", () => {
    expect(floorIdx).toBeGreaterThanOrEqual(0);
    expect(installIdx).toBeLessThan(floorIdx);
  });
});

describe("E6: a missing produced binary fails the floor check", () => {
  const floor = steps(workflow).find((s) => s.name.startsWith(FLOOR_STEP));
  const elseBranch = floor?.body.split(/^\s*else\s*$/m)[1]?.split(/^\s*fi\s*$/m)[0] ?? "";

  it("has an else branch for the binary lookup", () => {
    expect(elseBranch.trim()).not.toBe("");
  });

  it("errors and exits 1 instead of skipping", () => {
    expect(elseBranch).toContain("::error::");
    expect(elseBranch).toMatch(/exit 1/);
    expect(floor?.body).not.toContain("skipping otool check");
  });

  it("detaches the mount before exiting", () => {
    const detach = elseBranch.indexOf("hdiutil detach");
    expect(detach).toBeGreaterThanOrEqual(0);
    expect(detach).toBeLessThan(elseBranch.indexOf("exit 1"));
  });
});
