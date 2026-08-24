/**
 * Repo-lint harness scoping: a repo-wide scan must judge SOURCE, not whatever
 * happens to be sitting in the working tree.
 *
 * Four harnesses shell out to a repo-wide tool and then narrow the result.
 * Each had a hole where local-only state — an untracked scratch file, a
 * `.worktrees/` checkout, a gitignored build artifact — reached the verdict:
 *
 *  - `lint-ledger` / `async-semantics-guards` filter results to git-tracked
 *    files, but ran Biome through `execFileSync`, which THROWS on a non-zero
 *    exit. Biome exits non-zero for ANY diagnostic, so one untracked file with
 *    a syntax error killed four tests before the tracked-filter ever ran.
 *  - `knip-config` walked `.worktrees/`, which this repo's own `ship-it` flow
 *    creates — so a developer mid-change had a red suite.
 *  - `skill-frontmatter` judged gitignored `bundled-extensions/` build output.
 *
 * All four are invisible in CI (clean checkout, no worktrees) and only bite
 * locally, which is exactly the population that runs the suite most often.
 *
 * See change: restore-dashboard-subagents-dependency (PR #519 follow-up).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseBiomeReport, runBiomeRule } from "../lint-ledger.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = [];

afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

// Under `node_modules/.cache/`, not os.tmpdir(): `npx biome` resolves the
// binary by walking UP from cwd, so a fixture outside the repo finds no biome
// and yields empty stdout. `node_modules/` is also skipped by every repo-wide
// scan, so a parallel sibling test cannot trip over this fixture.
function fixtureRepo() {
  const base = path.join(repoRoot, "node_modules", ".cache");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "lint-harness-"));
  scratch.push(dir);
  fs.writeFileSync(
    path.join(dir, "biome.json"),
    JSON.stringify({ $schema: "./node_modules/@biomejs/biome/configuration_schema.json", linter: { enabled: true } }),
  );
  return dir;
}

describe("parseBiomeReport", () => {
  it("returns diagnostics from a well-formed report", () => {
    const report = { diagnostics: [{ location: { path: "a.ts", start: { line: 3 } } }] };
    expect(parseBiomeReport(JSON.stringify(report))).toEqual(report);
  });

  it("throws a diagnosable error on unparseable stdout", () => {
    expect(() => parseBiomeReport("not json")).toThrow(/biome.*json/i);
  });
});

describe("runBiomeRule", () => {
  it("survives a non-zero exit caused by an unrelated parse error", () => {
    // The exact shape that took out four tests: a stray file Biome cannot
    // parse, which no rule filter and no tracked-file filter would have
    // excluded, because the process died first.
    const dir = fixtureRepo();
    fs.writeFileSync(path.join(dir, "broken.css"), "a { color: red; }}}\n");
    fs.writeFileSync(path.join(dir, "clean.ts"), "export const x = 1;\n");

    expect(() => runBiomeRule("noFloatingPromises", { cwd: dir })).not.toThrow();
    expect(Array.isArray(runBiomeRule("noFloatingPromises", { cwd: dir }).diagnostics)).toBe(true);
  });
});

describe("repo-wide scans ignore local-only state", () => {
  const tracked = new Set(
    execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n")
      .filter(Boolean),
  );

  // Asserted over TRACKED-ness rather than a `.worktrees/` substring: the same
  // walk also reached gitignored `bundled-extensions/` build output, and a
  // substring check would have declared victory with that still leaking.
  it("knip entry derivation sees only tracked workspaces", async () => {
    const { readWorkspacePackages } = await import("../knip-config.mjs");
    const offenders = readWorkspacePackages(repoRoot)
      .map((p) => (p.dir === "." ? "package.json" : `${p.dir}/package.json`))
      .filter((manifest) => !tracked.has(manifest));

    expect(offenders).toEqual([]);
  });

  it("skill frontmatter analysis judges only git-tracked SKILL.md", async () => {
    const { analyzeRepository } = await import("../check-skill-frontmatter.mjs");
    const untracked = analyzeRepository()
      .findings.map((f) => f.file)
      .filter((f) => !tracked.has(f));

    expect(untracked).toEqual([]);
  });
});
