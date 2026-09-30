/**
 * Affected-test selector — diff, CLI, shard self-verification and the
 * `ci-result` aggregate (change: speed-up-ci-affected-tests).
 *
 * Temporary git repos follow `lint-harness-scoping.test.mjs`; the CLI is run
 * as a child process, the way ci.yml runs it. test-plan rows E20, E21, E32,
 * X2–X8.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { renderSummary } from "../select-affected-tests.mjs";
import { checkResult } from "../test-selection/check-result.mjs";
import { decide } from "../test-selection/decide.mjs";
import { changedFiles, resolveDiff } from "../test-selection/git-diff.mjs";
import { assignment } from "../test-selection/assigned.mjs";
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
