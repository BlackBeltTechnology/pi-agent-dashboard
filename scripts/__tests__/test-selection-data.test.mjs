/**
 * Data-file contract for the affected-test selector (change:
 * speed-up-ci-affected-tests, D7; test-plan E29).
 *
 * `scripts/test-selection/{triggers,covered-elsewhere,slow-tier}.json` decide
 * which tests run. A stale entry fails silently in the dangerous direction —
 * a trigger that matches nothing selects nothing — so every entry must still
 * point at something real:
 *   - every slow-tier entry is an existing test file;
 *   - every trigger glob matches a tracked file, every trigger test glob a test;
 *   - every covered-elsewhere entry is a TOP-LEVEL location that exists.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { globToRegExp } from "../test-selection/decide.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA = path.join(repoRoot, "scripts/test-selection");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

// `git ls-files` output passed Node's 1 MiB default `maxBuffer` (ENOBUFS once
// the tree crossed 1,048,576 bytes of paths); size it for growth.
const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n")
  .filter(Boolean);
const TEST_RE = /\.test\.(?:ts|tsx|mts|js|mjs)$/;

/** Every problem with the selection data, as human-readable strings naming the entry. */
function dataProblems({ triggers, coveredElsewhere, slowTier }, files) {
  const problems = [];
  const fileSet = new Set(files);
  const tests = files.filter((f) => TEST_RE.test(f));
  const topLevel = new Set(files.map((f) => f.split("/")[0]));
  for (const s of slowTier) if (!fileSet.has(s) || !TEST_RE.test(s)) problems.push(`slow-tier entry is not an existing test file: ${s}`);
  for (const [glob, testGlobs] of Object.entries(triggers)) {
    const re = globToRegExp(glob);
    if (!files.some((f) => re.test(f))) problems.push(`trigger glob matches no tracked file: ${glob}`);
    if (!Array.isArray(testGlobs) || testGlobs.length === 0) problems.push(`trigger ${glob} maps to no test glob`);
    for (const tg of testGlobs ?? []) {
      const tre = globToRegExp(tg);
      if (!tests.some((t) => tre.test(t))) problems.push(`trigger test glob matches no test file: ${tg} (for ${glob})`);
    }
  }
  for (const c of coveredElsewhere) {
    if (c.includes("/") || c.includes("*")) problems.push(`covered-elsewhere entry is not a top-level location: ${c}`);
    else if (!topLevel.has(c)) problems.push(`covered-elsewhere entry does not exist: ${c}`);
    if (c === "packages" || c === "scripts") problems.push(`covered-elsewhere entry would hide test-bearing code: ${c}`);
  }
  return problems;
}

describe("selection data files", () => {
  it("are valid and every entry points at something real", () => {
    const data = { triggers: read("triggers.json"), coveredElsewhere: read("covered-elsewhere.json"), slowTier: read("slow-tier.json") };
    expect(dataProblems(data, tracked)).toEqual([]);
  });

  it("timings.json is a flat file → seconds map", () => {
    const timings = read("timings.json");
    for (const [k, v] of Object.entries(timings)) {
      expect(typeof k).toBe("string");
      expect(typeof v).toBe("number");
    }
  });

  it("E29: a stale slow-tier entry and a sub-path covered entry fail naming each", () => {
    const problems = dataProblems(
      {
        triggers: { "no/such/file.json": ["scripts/__tests__/nothing-*.test.mjs"] },
        coveredElsewhere: ["docs/sub", "docs"],
        slowTier: ["scripts/__tests__/gone.test.mjs"],
      },
      tracked,
    );
    expect(problems.join("\n")).toContain("scripts/__tests__/gone.test.mjs");
    expect(problems.join("\n")).toContain("docs/sub");
    expect(problems.join("\n")).toContain("no/such/file.json");
    expect(problems.join("\n")).toContain("scripts/__tests__/nothing-*.test.mjs");
    expect(problems.some((p) => p.includes(": docs") && !p.includes("docs/"))).toBe(false);
  });
});
