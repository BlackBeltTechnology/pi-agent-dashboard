/**
 * Affected-test selector — diff, CLI, shard self-verification and the
 * `ci-result` aggregate (change: speed-up-ci-affected-tests).
 *
 * Temporary git repos follow `lint-harness-scoping.test.mjs`; the CLI is run
 * as a child process, the way ci.yml runs it. test-plan rows E20, E21, E32,
 * X2–X8.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { loadData, renderSummary } from "../select-affected-tests.mjs";
import { assignment } from "../test-selection/assigned.mjs";
import { checkResult } from "../test-selection/check-result.mjs";
import { decide } from "../test-selection/decide.mjs";
import { changedFiles, resolveDiff } from "../test-selection/git-diff.mjs";
import { summarizeReports } from "../test-selection/nightly-report.mjs";
import { assignedFor, verifyExecuted } from "../test-selection/verify-executed.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(repoRoot, "scripts", "select-affected-tests.mjs");
const scratch = [];
afterAll(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  scratch.push(d);
  return d;
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A temp repo with packages/p/src/a.ts + a fixture, one commit. */
function fixtureRepo() {
  const d = tmpDir("sel-repo-");
  git(d, "init", "-q", "-b", "main");
  git(d, "config", "user.email", "t@example.com");
  git(d, "config", "user.name", "t");
  git(d, "config", "commit.gpgsign", "false");
  fs.mkdirSync(path.join(d, "packages/p/src"), { recursive: true });
  fs.mkdirSync(path.join(d, "packages/p/fixtures"), { recursive: true });
  fs.writeFileSync(path.join(d, "packages/p/src/a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(d, "packages/p/fixtures/f.json"), "{}\n");
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "base");
  return d;
}

function runCli(cwd, args, env = {}) {
  const summary = path.join(tmpDir("sel-sum-"), "summary.md");
  execFileSync(process.execPath, [CLI, ...args, "--cwd", cwd, "--out", "selection.json"], {
    cwd,
    env: { ...process.env, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    selection: JSON.parse(fs.readFileSync(path.join(cwd, "selection.json"), "utf8")),
    summary: fs.readFileSync(summary, "utf8"),
  };
}

describe("diff without rename detection (E20, E21)", () => {
  it("E20: a rename counts both the old and the new path", () => {
    const d = fixtureRepo();
    const base = git(d, "rev-parse", "HEAD");
    git(d, "mv", "packages/p/src/a.ts", "packages/p/src/b.ts");
    git(d, "commit", "-q", "-m", "rename");
    expect(changedFiles(base, "HEAD", d)).toEqual(["packages/p/src/a.ts", "packages/p/src/b.ts"]);
  });

  it("E21: a deletion counts, and fires the package fallback", () => {
    const d = fixtureRepo();
    const base = git(d, "rev-parse", "HEAD");
    git(d, "rm", "-q", "packages/p/fixtures/f.json");
    git(d, "commit", "-q", "-m", "delete");
    const diff = resolveDiff({ base, cwd: d });
    expect(diff.changed).toEqual(["packages/p/fixtures/f.json"]);
    const pt = "packages/p/src/__tests__/p.test.ts";
    const sel = decide({
      changed: diff.changed,
      index: { tests: { [pt]: { deps: ["packages/p/src/a.ts"], phase: "parallel", locations: [], gated: false } } },
      data: { triggers: {}, coveredElsewhere: [], slowTier: [] },
    });
    expect(sel.selected[pt]).toBe("package-fallback");
  });

  it("a pull request diffs from the merge-base, not the moving base tip", () => {
    const d = fixtureRepo();
    git(d, "checkout", "-q", "-b", "feature");
    fs.writeFileSync(path.join(d, "packages/p/src/feature.ts"), "x\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "feature");
    git(d, "checkout", "-q", "main");
    fs.writeFileSync(path.join(d, "packages/p/src/main-only.ts"), "y\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "main moves");
    git(d, "checkout", "-q", "feature");
    expect(resolveDiff({ base: "main", cwd: d, mergeBase: true }).changed).toEqual(["packages/p/src/feature.ts"]);
  });
});

describe("base resolution fails safe to full (X3–X5)", () => {
  it("X3: the all-zero push base is full", () => {
    const d = fixtureRepo();
    const { selection } = runCli(d, ["--base", "0000000000000000000000000000000000000000"]);
    expect(selection.mode).toBe("full");
    expect(selection.reason).toMatch(/all-zero/);
  });

  it("X4: a base that is not an ancestor of head (force-push) is full, reason names ancestry", () => {
    const d = fixtureRepo();
    git(d, "checkout", "-q", "--orphan", "orphan");
    fs.writeFileSync(path.join(d, "orphan.txt"), "o\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "orphan");
    const orphan = git(d, "rev-parse", "HEAD");
    git(d, "checkout", "-q", "main");
    const { selection } = runCli(d, ["--base", orphan]);
    expect(selection.mode).toBe("full");
    expect(selection.reason).toMatch(/ancestor/);
  });

  it("X5: a missing base ref is full and the reason names it", () => {
    const d = fixtureRepo();
    const { selection } = runCli(d, ["--base", "deadbeef"]);
    expect(selection.mode).toBe("full");
    expect(selection.reason).toContain("deadbeef");
  });
});

describe("internal errors fall back to full (X2)", () => {
  it("X2: a forced throw exits 0 with mode full and the error in the reason", () => {
    const d = fixtureRepo();
    const { selection, summary } = runCli(d, ["--full"], { SELECT_AFFECTED_TEST_THROW: "1" });
    expect(selection.mode).toBe("full");
    expect(selection.enumerated).toBe(false);
    expect(selection.reason).toContain("SELECT_AFFECTED_TEST_THROW");
    expect(summary).toContain("NOT enumerated");
  });

  it("an unknown argument still writes a full selection and exits 0", () => {
    const d = fixtureRepo();
    const { selection } = runCli(d, ["--bogus"]);
    expect(selection.mode).toBe("full");
    expect(selection.reason).toContain("--bogus");
  });
});

describe("selection data must load, or the run is full (review B1)", () => {
  function dataDir(files) {
    const d = tmpDir("sel-data-");
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name), body);
    return d;
  }
  const good = { "triggers.json": "{}", "covered-elsewhere.json": "[]", "slow-tier.json": "[]" };

  it("loads valid data, and a missing timings file is tolerated (it only balances shards)", () => {
    expect(loadData(dataDir(good))).toEqual({ triggers: {}, coveredElsewhere: [], slowTier: [] });
  });

  it("throws naming a missing or malformed rule file", () => {
    expect(() => loadData(dataDir({ ...good, "triggers.json": "{not json" }))).toThrow(/triggers\.json/);
    const { "slow-tier.json": _gone, ...noSlow } = good;
    expect(() => loadData(dataDir(noSlow))).toThrow(/slow-tier\.json/);
    expect(() => loadData(dataDir({ ...good, "covered-elsewhere.json": "{}" }))).toThrow(/covered-elsewhere\.json/);
  });

  it("the CLI turns a malformed rule file into mode full naming it, still enumerated", () => {
    const d = fixtureRepo();
    const base = git(d, "rev-parse", "HEAD");
    const bad = dataDir({ ...good, "triggers.json": "{not json" });
    const { selection } = runCli(d, ["--base", base], { SELECT_AFFECTED_DATA_DIR: bad });
    expect(selection.mode).toBe("full");
    expect(selection.reason).toContain("triggers.json");
  });
});

describe("every selection is auditable (E32)", () => {
  it("E32: the summary carries mode, reason, every layer count and each listed file; the JSON carries layers and shards", () => {
    const tests = {
      "packages/p/src/__tests__/g.test.ts": { deps: ["packages/p/src/a.ts", "packages/q/src/open.ts"], phase: "parallel", locations: [], gated: false },
      "packages/z/src/__tests__/z.test.ts": { deps: [], phase: "parallel", locations: [], gated: false },
      "scripts/__tests__/async-semantics-mutation.test.mjs": { deps: ["packages/p/src/a.ts"], phase: "parallel", locations: [], gated: false },
    };
    const affected = decide({
      changed: ["packages/p/src/a.ts"],
      index: {
        tests,
        openModules: ["packages/q/src/open.ts"],
        leafErrors: [["packages/client/src/components/editor-pane/monaco-setup.ts", "Failed to resolve entry"]],
      },
      data: { triggers: {}, coveredElsewhere: [], slowTier: ["scripts/__tests__/async-semantics-mutation.test.mjs"] },
    });
    const md = renderSummary(affected);
    expect(md).toContain("`affected`");
    expect(md).toContain(affected.reason);
    for (const layer of ["global", "graph", "open edge", "always-run", "path literal", "package fallback", "trigger map", "slow-tier deselections"]) {
      expect(md).toContain(`| ${layer} |`);
    }
    expect(md).toContain("monaco-setup.ts");
    expect(md).toContain("packages/q/src/open.ts");
    expect(md).toContain("async-semantics-mutation.test.mjs");
    expect(md).toMatch(/no timing data/);
    expect(affected.selected["packages/p/src/__tests__/g.test.ts"]).toBe("graph");
    expect(affected.shards.flat()).toContain("packages/p/src/__tests__/g.test.ts");

    const unmapped = decide({ changed: ["weird-root.bin"], index: { tests }, data: { triggers: {}, coveredElsewhere: [], slowTier: [] } });
    const md2 = renderSummary(unmapped);
    expect(md2).toContain("`full`");
    expect(md2).toContain("weird-root.bin");
  });
});

describe("shard self-verification (X6, X7)", () => {
  const root = "/repo";
  const report = (names) => ({ testResults: names.map((n) => ({ name: path.join(root, n) })) });

  it("X6: an assigned file missing from the report fails and is named", () => {
    const r = verifyExecuted(["a.test.ts", "b.test.ts"], report(["a.test.ts"]), root);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["b.test.ts"]);
    expect(r.message).toContain("b.test.ts");
  });

  it("an exact match passes", () => {
    expect(verifyExecuted(["a.test.ts", "b.test.ts"], report(["b.test.ts", "a.test.ts"]), root).ok).toBe(true);
  });

  it("a missing report with assigned files fails", () => {
    expect(verifyExecuted(["a.test.ts"], null, root).ok).toBe(false);
  });

  it("review B4: an unenumerated (fallback) shard still requires a non-empty report", () => {
    const d = tmpDir("sel-verify-un-");
    const selPath = path.join(d, "selection.json");
    fs.writeFileSync(selPath, JSON.stringify({ enumerated: false, shards: [[], [], [], []], realProcess: [], ciScenariosFiles: [] }));
    const verify = path.join(repoRoot, "scripts/test-selection/verify-executed.mjs");
    const rep = path.join(d, "report.json");
    expect(() => execFileSync(process.execPath, [verify, selPath, "unit-1", rep], { cwd: d, stdio: "pipe" })).toThrow();
    fs.writeFileSync(rep, JSON.stringify({ testResults: [] }));
    expect(() => execFileSync(process.execPath, [verify, selPath, "unit-1", rep], { cwd: d, stdio: "pipe" })).toThrow();
    fs.writeFileSync(rep, JSON.stringify({ testResults: [{ name: path.join(d, "a.test.ts") }] }));
    expect(() => execFileSync(process.execPath, [verify, selPath, "unit-1", rep], { cwd: d, stdio: "pipe" })).not.toThrow();
  });

  it("X7: an empty assignment passes without any report", () => {
    expect(verifyExecuted([], null, root).ok).toBe(true);
  });

  it("job keys map to shards, real-process and packaging scenarios", () => {
    const sel = { shards: [["s1"], ["s2"], [], []], realProcess: ["rp"], ciScenariosFiles: ["cs"] };
    expect(assignedFor(sel, "unit-2")).toEqual(["s2"]);
    expect(assignedFor(sel, "real-process")).toEqual(["rp"]);
    expect(assignedFor(sel, "ci-scenarios")).toEqual(["cs"]);
  });

  it("the CLI exits non-zero on a missing file and 0 on an exact match", () => {
    const d = tmpDir("sel-verify-");
    const selPath = path.join(d, "selection.json");
    fs.writeFileSync(selPath, JSON.stringify({ shards: [["a.test.ts", "b.test.ts"], [], [], []], realProcess: [], ciScenariosFiles: [] }));
    const rep = path.join(d, "report.json");
    const verify = path.join(repoRoot, "scripts/test-selection/verify-executed.mjs");
    fs.writeFileSync(rep, JSON.stringify({ testResults: [{ name: path.join(d, "a.test.ts") }] }));
    expect(() => execFileSync(process.execPath, [verify, selPath, "unit-1", rep], { cwd: d, stdio: "pipe" })).toThrow();
    fs.writeFileSync(rep, JSON.stringify({ testResults: [{ name: path.join(d, "a.test.ts") }, { name: path.join(d, "b.test.ts") }] }));
    expect(() => execFileSync(process.execPath, [verify, selPath, "unit-1", rep], { cwd: d, stdio: "pipe" })).not.toThrow();
  });
});

describe("ci-result expectation check (X8)", () => {
  const selection = { mode: "affected", enumerated: true, shards: [["a"], [], [], []], realProcess: ["rp"], ciScenarios: true };
  const ok = {
    ci: { result: "success" },
    select: { result: "success" },
    unit: { result: "success" },
    "real-process": { result: "success" },
    "ci-scenarios": { result: "success" },
    "docker-plugin-load": { result: "success" },
    "music-pytest": { result: "success" },
  };

  it("X8a: a failed select fails, naming it", () => {
    const r = checkResult(selection, { ...ok, select: { result: "failure" } });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain("select");
  });

  it("X8b: a skipped unit matrix with a non-empty shard fails", () => {
    const r = checkResult(selection, { ...ok, unit: { result: "skipped" } });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain("unit");
  });

  it("X8c: real-process expected but skipped fails", () => {
    const r = checkResult(selection, { ...ok, "real-process": { result: "skipped" } });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain("real-process");
  });

  it("X8d: a cancelled job fails", () => {
    const r = checkResult(selection, { ...ok, "docker-plugin-load": { result: "cancelled" } });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toContain("docker-plugin-load");
  });

  it("X8e: all expected jobs succeeded and the unexpected ones skipped passes", () => {
    const docsOnly = { mode: "affected", enumerated: true, shards: [["z"], [], [], []], realProcess: [], ciScenarios: false };
    const r = checkResult(docsOnly, { ...ok, "real-process": { result: "skipped" }, "ci-scenarios": { result: "skipped" } });
    expect(r).toEqual({ ok: true, problems: [] });
  });

  it("a missing selection fails even when every job reports success", () => {
    expect(checkResult(null, ok).ok).toBe(false);
  });

  it("an always-expected job (ci) that was skipped fails", () => {
    expect(checkResult(selection, { ...ok, ci: { result: "skipped" } }).ok).toBe(false);
  });
});

describe("assignment for a workflow job", () => {
  const sel = { enumerated: true, shards: [["a"], [], [], []], realProcess: [], ciScenariosFiles: ["g"] };

  it("an empty shard is empty (the job skips vitest and succeeds)", () => {
    expect(assignment(sel, "unit-2")).toEqual({ files: [], empty: true, enumerated: true });
    expect(assignment(sel, "unit-1")).toEqual({ files: ["a"], empty: false, enumerated: true });
  });

  it("an unenumerated selection falls back to --shard for unit/real-process, never to an empty skip", () => {
    const un = { ...sel, enumerated: false };
    expect(assignment(un, "unit-2")).toEqual({ files: [], empty: false, enumerated: false });
    expect(assignment(un, "real-process").empty).toBe(false);
  });

  it("packaging-scenario files stay listed even when the suite was not enumerated", () => {
    expect(assignment({ ...sel, enumerated: false }, "ci-scenarios").files).toEqual(["g"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Budget lane (change: stabilize-blocking-test-lanes, design.md D1–D3; test-plan E17, E18, E20–E22, X9, X10)
// ---------------------------------------------------------------------------------------------

const VERIFY = path.join(repoRoot, "scripts/test-selection/verify-executed.mjs");
const ASSIGNED = path.join(repoRoot, "scripts/test-selection/assigned.mjs");

/** Run `verify-executed.mjs <selection> <key> <report>` in a temp dir; the report names resolve against it. */
function verifyCli(selection, key, resultsFor) {
  const d = tmpDir("sel-budget-verify-");
  const selPath = path.join(d, "selection.json");
  const rep = path.join(d, "report.json");
  fs.writeFileSync(selPath, JSON.stringify(selection));
  fs.writeFileSync(rep, JSON.stringify({ testResults: resultsFor(d) }));
  const r = spawnSync(process.execPath, [VERIFY, selPath, key, rep], { cwd: d, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("budget lane verification is strict (E20, X9, X10)", () => {
  const f = "packages/kb-plugin/src/server/__tests__/kb-search-perf.budget.test.ts";
  const result = (d, statuses) => [{ name: path.join(d, f), assertionResults: statuses.map((status) => ({ status })) }];
  const sel = { enumerated: true, budgetFiles: [f], shards: [[f], [], [], []], realProcess: [], ciScenariosFiles: [] };

  it("E20 (a): three passed assertions pass", () => {
    expect(verifyCli(sel, "budget", (d) => result(d, ["passed", "passed", "passed"])).status).toBe(0);
  });

  it.each([
    ["(b) zero assertions", []],
    ["(c) one skipped", ["passed", "skipped"]],
    ["(d) one pending", ["passed", "pending"]],
    ["(e) one todo", ["passed", "todo"]],
  ])("E20 %s fails the budget key, naming the file", (_label, statuses) => {
    const r = verifyCli(sel, "budget", (d) => result(d, statuses));
    expect(r.status).toBe(1);
    expect(r.out).toContain(f);
  });

  it("E20 (f): the strict rule applies to the budget key only (the same skipped case passes under unit-1)", () => {
    expect(verifyCli(sel, "unit-1", (d) => result(d, ["passed", "skipped"])).status).toBe(0);
    expect(verifyCli(sel, "unit-1", (d) => result(d, [])).status).toBe(0);
  });

  it("X9: a JSPI probe failure (real-binary P1–P3 skipped) fails the lane, naming the file", () => {
    const blender = "packages/blender/src/__tests__/real-binary.budget.test.ts";
    const r = verifyCli({ ...sel, budgetFiles: [blender] }, "budget", (d) => [
      { name: path.join(d, blender), assertionResults: ["P1", "P2", "P3"].map((title) => ({ title, status: "skipped" })) },
    ]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("real-binary.budget.test.ts");
  });

  it("X10: a tracked budget file the run did not collect fails, naming it", () => {
    const missing = "packages/server/src/access/__tests__/ladder-perf.budget.test.ts";
    const r = verifyCli({ ...sel, budgetFiles: [f, missing] }, "budget", (d) => result(d, ["passed"]));
    expect(r.status).toBe(1);
    expect(r.out).toContain(missing);
    expect(r.out).not.toContain(`  - ${f}`); // the collected file is not blamed
  });

  it("verifyExecuted reports `weak` files only under { strict: true }", () => {
    const rep = { testResults: [{ name: "/repo/a.budget.test.ts", assertionResults: [{ status: "skipped" }] }] };
    expect(verifyExecuted(["a.budget.test.ts"], rep, "/repo").ok).toBe(true);
    const strict = verifyExecuted(["a.budget.test.ts"], rep, "/repo", { strict: true });
    expect(strict.ok).toBe(false);
    expect(strict.weak.map((w) => w.file)).toEqual(["a.budget.test.ts"]);
  });

  it("the `budget` key maps to budgetFiles", () => {
    expect(assignedFor({ budgetFiles: ["b"] }, "budget")).toEqual(["b"]);
    expect(assignedFor({}, "budget")).toEqual([]);
  });
});

describe("an empty budget lane is green (E21)", () => {
  it("empty budgetFiles + empty testResults: verify exits 0, the summary is green, `budget` is not 'no report'", () => {
    const emptySel = { enumerated: true, budgetFiles: [], shards: [[], [], [], []], realProcess: [], ciScenariosFiles: [] };
    expect(verifyCli(emptySel, "budget", () => []).status).toBe(0);
    // Also when the selector fell back (the budget list is a filename scan, not an enumeration).
    expect(verifyCli({ ...emptySel, enumerated: false }, "budget", () => []).status).toBe(0);
    const summary = summarizeReports({ expected: ["budget"], reports: { budget: { testResults: [] } }, root: "/repo", needs: { budget: { result: "success" } } });
    expect(summary.noReport).toEqual([]);
    expect(summary.red).toBe(false);
  });
});

describe("fallback selection keeps the scanned budget list (E22)", () => {
  it("assigned.mjs budget prints the scanned list, not an empty one", () => {
    const d = tmpDir("sel-budget-assigned-");
    const selPath = path.join(d, "selection.json");
    const out = path.join(d, "assigned.txt");
    const files = ["a/x.budget.test.ts", "b/y.budget.test.mjs"];
    fs.writeFileSync(selPath, JSON.stringify({ enumerated: false, shards: [[], [], [], []], realProcess: [], ciScenariosFiles: [], budgetFiles: files }));
    const r = spawnSync(process.execPath, [ASSIGNED, selPath, "budget", out], { cwd: d, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "" } });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(out, "utf8")).toBe(`${files.join("\n")}\n`);
    expect(assignment({ enumerated: false, budgetFiles: files }, "budget")).toEqual({ files, empty: false, enumerated: true });
    // ...while unit/real-process still fall back to `--shard`.
    expect(assignment({ enumerated: false, budgetFiles: files }, "unit-1").enumerated).toBe(false);
  });
});

describe("budget files in a real selector run (E17, E18)", () => {
  // Fixture lives in the gitignored install cache: on macOS `vitest` under /var/folders is ~150x slower.
  const FIXTURE_BASE = path.join(repoRoot, "node_modules", ".cache", "budget-selector-fixtures");
  const WORKERS = fs.readFileSync(path.join(repoRoot, "vitest.workers.ts"), "utf8");
  const BUDGETS = ["packages/p/src/__tests__/zeta.budget.test.ts", "packages/p/src/__tests__/alpha.budget.test.ts"];
  const SNAP = "packages/p/src/__tests__/__snapshots__/alpha.budget.test.ts.snap";
  const TEST = 'import { it } from "vitest";\nit("x", () => {});\n';

  const workspaces = [];
  afterAll(() => {
    for (const d of workspaces) fs.rmSync(d, { recursive: true, force: true });
    try {
      fs.rmdirSync(FIXTURE_BASE);
    } catch {
      /* not empty or gone */
    }
  });

  function budgetWorkspace() {
    fs.mkdirSync(FIXTURE_BASE, { recursive: true });
    const d = fs.realpathSync(fs.mkdtempSync(path.join(FIXTURE_BASE, "ws-")));
    workspaces.push(d);
    const w = (rel, content) => {
      fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
      fs.writeFileSync(path.join(d, rel), content);
    };
    w("vitest.config.ts", 'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { projects: ["packages/*/vitest.config.ts"] } });\n');
    w("vitest.workers.ts", WORKERS);
    w(
      "packages/p/vitest.config.ts",
      'import { configDefaults, defineConfig } from "vitest/config";\nimport { BUDGET_TEST_EXCLUDE } from "../../vitest.workers";\nexport default defineConfig({ test: { include: ["src/**/__tests__/**/*.test.ts"], exclude: [...configDefaults.exclude, ...BUDGET_TEST_EXCLUDE] } });\n',
    );
    w("packages/p/src/a.ts", "export const a = 1;\n");
    w("packages/p/src/__tests__/a.test.ts", 'import { a } from "../a";\nimport { it } from "vitest";\nit("a", () => { void a; });\n');
    for (const b of BUDGETS) w(b, TEST);
    w(SNAP, "// snapshot\n");
    fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(d, "node_modules"));
    w(".gitignore", "node_modules\n");
    git(d, "init", "-q", "-b", "main");
    git(d, "config", "user.email", "t@example.com");
    git(d, "config", "user.name", "t");
    git(d, "config", "commit.gpgsign", "false");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "base");
    return d;
  }

  const lists = (sel) => [...sel.shards.flat(), ...sel.realProcess, ...sel.ciScenariosFiles];

  it("E17: the same tree and base twice give identical selections (budgetFiles order included)", () => {
    const d = budgetWorkspace();
    const base = git(d, "rev-parse", "HEAD");
    fs.appendFileSync(path.join(d, "packages/p/src/a.ts"), "export const b = 2;\n");
    git(d, "commit", "-q", "-am", "edit");
    const strip = (sel) => {
      // `graphMs` is the graph build's wall-clock; every other field must repeat exactly.
      const { graphMs, ...rest } = sel;
      expect(typeof graphMs).toBe("number");
      return JSON.stringify(rest);
    };
    const one = runCli(d, ["--base", base]).selection;
    const two = runCli(d, ["--base", base]).selection;
    expect(strip(one)).toBe(strip(two));
    expect(one.mode).toBe("affected");
    expect(one.budgetFiles).toEqual([...BUDGETS].sort());
    expect(runCli(d, ["--full"]).selection.budgetFiles).toEqual([...BUDGETS].sort());
  }, 120_000);

  it("E18: a PR that only edits a budget file runs none of its cases in a PR job, and lists every budget file", () => {
    const d = budgetWorkspace();
    const base = git(d, "rev-parse", "HEAD");
    fs.appendFileSync(path.join(d, BUDGETS[1]), "// touched\n");
    git(d, "commit", "-q", "-am", "edit a budget file");
    const { selection, summary } = runCli(d, ["--base", base]);
    expect(selection.mode).toBe("affected");
    for (const b of BUDGETS) expect(lists(selection)).not.toContain(b);
    expect(lists(selection).some((f) => f.includes(".budget.test."))).toBe(false);
    expect(selection.budgetFiles).toEqual([...BUDGETS].sort());
    expect(selection.budgetFiles).not.toContain(SNAP);
    expect(summary).toMatch(/budget 2/);
    // The workflow never reads the field and has no budget job.
    const ci = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    expect(ci).not.toMatch(/budgetFiles/);
    expect(ci).not.toMatch(/^  budget:/m);
  }, 120_000);
});
