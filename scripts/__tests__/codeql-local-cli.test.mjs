/**
 * scripts/codeql-local.mjs end to end against a FAKE `codeql` binary and temp
 * git repos (test-plan #E2–#E13, #E16, #E23, #E25–#E29, #P1, #X1–#X5). Real
 * CodeQL is exercised in codeql-local-real.test.mjs.
 *
 * See change: add-local-codeql-ratchet.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { processStartTime, serializeBaseline, snapshotId } from "../codeql-local.mjs";
import {
  analyzes,
  baselineOf,
  creates,
  entry,
  git,
  gitOut,
  makeRepo,
  PACKS,
  run,
  sarifOf,
  stateDirOf,
  write,
  writeBaselineFile,
} from "./fixtures/codeql-harness.mjs";

const PI = "js/path-injection";
const LOG = "js/clear-text-logging";
const BASELINE = "codeql-baseline.json";
const readBaseline = (repo) => readFileSync(join(repo.dir, BASELINE), "utf8");
const bothLanguages = (results) => ({ sarif: { "javascript-typescript": sarifOf(results), actions: sarifOf([]) } });
const seeded = (entries = [], repoOpts) => {
  const repo = makeRepo(repoOpts);
  writeBaselineFile(repo, baselineOf(entries));
  return repo;
};

describe("shared config → extractor filters (#E2, #E3)", () => {
  it("#E2 passes newline-joined exclude lines and never --codescanning-config", () => {
    const repo = seeded();
    const r = run(repo, [], { plan: bothLanguages([]) });
    expect(r.status).toBe(0);
    const cs = creates(r.calls);
    expect(cs).toHaveLength(2);
    for (const c of cs) {
      expect(c.env.LGTM_INDEX_FILTERS).toBe("exclude:**/__tests__\nexclude:tests");
      expect(c.argv.join(" ")).not.toContain("--codescanning-config");
    }
  });

  it("#E3 a result inside an ignored path is an error", () => {
    const repo = seeded();
    const r = run(repo, [], { plan: bothLanguages([{ ruleId: LOG, file: "src/__tests__/a.js" }]) });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("src/__tests__/a.js");
    expect(r.stderr).toContain("**/__tests__/**");
  });
});

describe("snapshot (#E5–#E8)", () => {
  it("#E5 analyses uncommitted content; ignored output, deletions and the baseline are absent", () => {
    const repo = makeRepo({ files: { "a.js": "OLD\n", "c.js": "gone\n" } });
    write(repo.dir, "a.js", "FIXED\n");
    write(repo.dir, "b.js", "untracked\n");
    rmSync(join(repo.dir, "c.js"));
    write(repo.dir, "node_modules/n.js", "ignored\n");
    writeBaselineFile(repo, baselineOf());
    const r = run(repo, [], { plan: bothLanguages([]) });
    expect(r.status).toBe(0);
    const root = creates(r.calls)[0].sourceRoot;
    expect(root["a.js"]).toBe("FIXED\n");
    expect(root["b.js"]).toBe("untracked\n");
    expect(root).not.toHaveProperty("c.js");
    expect(root).not.toHaveProperty("node_modules/n.js");
    expect(root).not.toHaveProperty(BASELINE);
  });

  it("#E6 the snapshot id tracks content, not the baseline", () => {
    const repo = makeRepo();
    write(repo.dir, "a.js", "one\n");
    const id1 = snapshotId(repo.dir);
    write(repo.dir, "a.js", "two\n");
    const id2 = snapshotId(repo.dir);
    writeBaselineFile(repo, baselineOf());
    const id3 = snapshotId(repo.dir);
    expect(id1).not.toBe(id2);
    expect(id2).toBe(id3);
  });

  it("#E7 a seed run without a baseline still snapshots", () => {
    const repo = makeRepo();
    expect(snapshotId(repo.dir)).toMatch(/^[0-9a-f]{40}/);
  });

  it("#E8 a linked worktree is snapshotted without touching its index", () => {
    const repo = makeRepo({ files: { "a.js": "a\n", "s.js": "s\n" } });
    const wt = join(repo.root, "wt");
    git(repo.dir, ["worktree", "add", "-q", wt, "-b", "feat"]);
    write(wt, "s.js", "staged\n");
    git(wt, ["add", "s.js"]);
    write(wt, "a.js", "unstaged\n");
    write(wt, "u.js", "untracked\n");
    writeBaselineFile(repo, baselineOf(), wt);
    const before = [gitOut(wt, ["status", "--porcelain"]), gitOut(wt, ["ls-files", "-s"])];
    const r = run(repo, [], { cwd: wt, plan: bothLanguages([]) });
    expect(r.status).toBe(0);
    const root = creates(r.calls)[0].sourceRoot;
    expect([root["s.js"], root["a.js"], root["u.js"]]).toEqual(["staged\n", "unstaged\n", "untracked\n"]);
    expect([gitOut(wt, ["status", "--porcelain"]), gitOut(wt, ["ls-files", "-s"])]).toEqual(before);
  });
});

describe("analysis options (#E9)", () => {
  it("pins suites, uses a fresh db dir, matches CI (no --threat-model) and never --download", () => {
    const repo = seeded();
    const a = run(repo, [], { plan: bothLanguages([]) });
    const b = run(repo, [], { plan: bothLanguages([]) });
    for (const r of [a, b]) {
      expect(r.status).toBe(0);
      for (const c of creates(r.calls)) expect(c.argv).toEqual(expect.arrayContaining(["--overwrite", "--build-mode=none"]));
      const suites = analyzes(r.calls).map((c) => c.argv.find((x) => x.includes("@")));
      expect(suites).toEqual([
        `codeql/javascript-queries@${PACKS["codeql/javascript-queries"]}:codeql-suites/javascript-code-scanning.qls`,
        `codeql/actions-queries@${PACKS["codeql/actions-queries"]}:codeql-suites/actions-code-scanning.qls`,
      ]);
      for (const c of analyzes(r.calls)) {
        // CI runs the default setup without a threat-model flag; the flag-on run added local-only results. See change: triage-codeql-alert-debt (#E1).
        expect(c.argv.some((x) => x.startsWith("--threat-model"))).toBe(false);
        expect(c.argv).not.toContain("--download");
      }
    }
    expect(creates(a.calls)[0].argv[2]).not.toBe(creates(b.calls)[0].argv[2]);
  });
});

describe("unavailable CodeQL (#E10–#E13, #X1–#X2)", () => {
  it("#E10 a missing binary skips loudly with exit 0", () => {
    const repo = seeded();
    const gitDir = dirname(spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim());
    const r = run(repo, ["--json"], { env: { CODEQL_BIN: null, PATH: `${gitDir}:/bin` } });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/^CODEQL SKIPPED:/m);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe("skipped");
    expect(out.message).toBeTruthy();
  });

  it("#E11 packs neither cached nor downloadable skip before any database", () => {
    const repo = seeded();
    const r = run(repo, [], { plan: { resolveExit: 2, downloadExit: 2 } });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/^CODEQL SKIPPED:.*codeql\/javascript-queries/m);
    expect(creates(r.calls)).toHaveLength(0);
  });

  it("#E12 cached packs never touch the network", () => {
    const repo = seeded();
    const r = run(repo, [], { plan: { resolveExit: 0 } });
    expect(r.calls.some((c) => c.argv[0] === "pack")).toBe(false);
  });

  it("#E13 a CLI version mismatch warns and still runs the ratchet", () => {
    const repo = seeded();
    const r = run(repo, [], { plan: { version: "2.28.0", ...bothLanguages([{ ruleId: LOG, file: "a.js" }]) } });
    expect(r.stderr).toMatch(/^CODEQL WARNING:.*2\.28\.0.*2\.27\.2/m);
    expect(r.status).toBe(1);
  });

  it("#X1 an extractor failure is exit 2 with the stderr tail", () => {
    const repo = seeded();
    const r = run(repo, [], { plan: { createExit: 1, createStderr: "boom" } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("boom");
  });

  it("#X2 a CODEQL_BIN that does not exist is an error, not a skip", () => {
    const repo = seeded();
    const r = run(repo, [], { env: { CODEQL_BIN: "/nonexistent/codeql" } });
    expect(r.status).toBe(2);
    expect(r.stderr).not.toContain("SKIPPED");
  });
});

describe("baseline file errors (#E16)", () => {
  const cases = {
    missing: null,
    "version 2": { ...baselineOf(), version: 2 },
    "count 0": baselineOf([entry(PI, "a.js", "h:1", 0)]),
    "reason because": baselineOf([entry(PI, "a.js", "h:1", 1, "because")]),
  };
  for (const [name, content] of Object.entries(cases)) {
    it(`${name} → exit 2, nothing written`, () => {
      const repo = makeRepo();
      if (content) writeFileSync(join(repo.dir, BASELINE), `${JSON.stringify(content)}\n`);
      const before = content ? readBaseline(repo) : null;
      const r = run(repo);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(BASELINE);
      expect(existsSync(join(repo.dir, BASELINE))).toBe(content !== null);
      if (content) expect(readBaseline(repo)).toBe(before);
      expect(creates(r.calls)).toHaveLength(0);
    });
  }
});

describe("JSON output (#E29)", () => {
  it("prints exactly one object on stdout, human lines on stderr", () => {
    const repo = seeded([entry(PI, "gone.js", "ff:1")]);
    const r = run(repo, ["--json"], { plan: bothLanguages([{ ruleId: LOG, file: "a.js", line: 4 }]) });
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe("new");
    expect(out.newResults).toHaveLength(1);
    expect(out.newResults[0]).toMatchObject({ ruleId: LOG, file: "a.js", startLine: 4 });
    expect(out.staleEntries).toHaveLength(1);
    expect(out.versions.packs).toEqual(PACKS);
    expect(r.stderr).toContain("NEW");
  });
});

describe("seed mode (#E28)", () => {
  it("writes header + untriaged entries, refuses to overwrite", () => {
    const repo = makeRepo();
    const plan = bothLanguages([
      { ruleId: LOG, file: "a.js", line: 1, hash: "aa:1" },
      { ruleId: PI, file: "b.js", line: 2, hash: "bb:1" },
    ]);
    const seed = run(repo, ["--write-baseline"], { plan });
    expect(seed.status).toBe(0);
    const written = JSON.parse(readBaseline(repo));
    expect(written.codeql).toBe("2.27.2");
    expect(written.packs).toEqual(PACKS);
    expect(written.entries).toHaveLength(2);
    expect(written.entries.every((e) => e.reason === "untriaged" && e.count === 1)).toBe(true);
    expect(run(repo, [], { plan }).status).toBe(0);
    const before = readBaseline(repo);
    expect(run(repo, ["--write-baseline"], { plan }).status).not.toBe(0);
    expect(readBaseline(repo)).toBe(before);
  });
});

describe("--check-baseline-diff (#E23, #E27, #X5, #P1)", () => {
  const k1 = (n) => Array.from({ length: n }, (_, i) => ({ ruleId: PI, file: "a.js", line: i + 1, hash: "aa:1" }));
  const k2 = [{ ruleId: LOG, file: "b.js", line: 1, hash: "bb:1" }];

  it("#E23 seed exactness against the recorded run", () => {
    const repo = makeRepo();
    const equal = baselineOf([entry(PI, "a.js", "aa:1", 2), entry(LOG, "b.js", "bb:1", 1)]);
    writeBaselineFile(repo, equal);
    expect(run(repo, [], { plan: bothLanguages([...k1(2), ...k2]) }).status).toBe(0);
    expect(run(repo, ["--check-baseline-diff", "HEAD"]).status).toBe(0); // (a)
    writeBaselineFile(repo, baselineOf([entry(PI, "a.js", "aa:1", 3), entry(LOG, "b.js", "bb:1", 1)]));
    expect(run(repo, ["--check-baseline-diff", "HEAD"]).status).toBe(1); // (b)
    writeBaselineFile(repo, baselineOf([entry(PI, "a.js", "aa:1", 2)]));
    expect(run(repo, ["--check-baseline-diff", "HEAD"]).status).toBe(1); // (c)
    writeBaselineFile(repo, equal);
    write(repo.dir, "a.js", "edited after the run\n");
    const d = run(repo, ["--check-baseline-diff", "HEAD"]); // (d)
    expect(d.status).toBe(0);
    expect(d.stdout).toMatch(/^SEED:/m);
  });

  it("#E27 triage changes only an untriaged reason; the diff check prints it", () => {
    const repo = makeRepo();
    writeBaselineFile(repo, baselineOf([entry(PI, "a.js", "aa:1", 2), entry(PI, "b.js", "bb:1", 1, "false-positive: x")]));
    git(repo.dir, ["add", BASELINE]);
    git(repo.dir, ["commit", "-q", "-m", "baseline"]);
    const t = run(repo, ["--triage", PI, "a.js", "aa:1", "--reason", "false-positive: constant input"]);
    expect(t.status).toBe(0);
    const after = JSON.parse(readBaseline(repo)).entries.find((e) => e.file === "a.js");
    expect(after).toMatchObject({ count: 2, reason: "false-positive: constant input" });
    const d = run(repo, ["--check-baseline-diff", "HEAD"]);
    expect(d.status).toBe(0);
    expect(d.stdout).toContain("false-positive: constant input");
    const before = readBaseline(repo);
    expect(run(repo, ["--triage", PI, "b.js", "bb:1", "--reason", "false-positive: y"]).status).toBe(2);
    expect(run(repo, ["--triage", PI, "zz.js", "cc:1", "--reason", "false-positive: y"]).status).toBe(2);
    expect(readBaseline(repo)).toBe(before);
  });

  it("#X5 invalid baselines and unknown refs fail closed", () => {
    const repo = makeRepo();
    writeBaselineFile(repo, baselineOf([entry(PI, "a.js", "aa:1", 1, "false-positive: x")]));
    git(repo.dir, ["add", BASELINE]);
    git(repo.dir, ["commit", "-q", "-m", "baseline"]);
    expect(run(repo, ["--check-baseline-diff", "nope/missing"]).status).toBe(2); // (c)
    const dup = entry(PI, "a.js", "aa:1", 1, "false-positive: x");
    writeBaselineFile(repo, baselineOf([dup, { ...dup }]));
    expect(run(repo, ["--check-baseline-diff", "HEAD"]).status).toBe(2); // (a)
    writeBaselineFile(repo, baselineOf([{ ...dup, reason: "because" }]));
    git(repo.dir, ["add", BASELINE]);
    git(repo.dir, ["commit", "-q", "-m", "bad ref"]);
    writeBaselineFile(repo, baselineOf([dup]));
    expect(run(repo, ["--check-baseline-diff", "HEAD"]).status).toBe(2); // (b)
  });

  it("#P1 a 400-entry diff is static and fast", () => {
    const repo = makeRepo();
    const mk = (n) => Array.from({ length: n }, (_, i) => entry(PI, `f${i}.ts`, `${i.toString(16)}:1`, 2, "false-positive: x"));
    writeBaselineFile(repo, baselineOf(mk(400)));
    git(repo.dir, ["add", BASELINE]);
    git(repo.dir, ["commit", "-q", "-m", "baseline"]);
    writeBaselineFile(repo, baselineOf(mk(400).map((e, i) => (i < 50 ? { ...e, count: 1 } : e))));
    const t = performance.now();
    const r = run(repo, ["--check-baseline-diff", "HEAD"]);
    expect(performance.now() - t).toBeLessThan(2000);
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(0);
  });
});

describe("prune and accept (#E25, #E26)", () => {
  it("#E25 several accepts after one run", () => {
    const repo = seeded();
    const results = [
      { ruleId: LOG, file: "a.js", line: 1, hash: "aa:1" },
      { ruleId: PI, file: "b.js", line: 1, hash: "bb:1" },
    ];
    expect(run(repo, [], { plan: bothLanguages(results) }).status).toBe(1);
    const reason = "false-positive: constant input";
    expect(run(repo, ["--accept", LOG, "a.js", "aa:1", "--reason", reason]).status).toBe(1);
    const second = run(repo, ["--accept", PI, "b.js", "bb:1", "--reason", reason]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("pass");
    expect(JSON.parse(readBaseline(repo)).entries.map((e) => [e.file, e.count, e.reason])).toEqual([
      ["a.js", 1, reason],
      ["b.js", 1, reason],
    ]);
  });

  it("#E26 refusals leave the baseline byte-identical", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 1, "false-positive: constant input")]);
    const results = [
      { ruleId: PI, file: "a.js", line: 1, hash: "aa:1" },
      { ruleId: PI, file: "a.js", line: 9, hash: "aa:1" },
      { ruleId: "js/request-forgery", file: "r.js", line: 1, hash: "rr:1" },
    ];
    run(repo, [], { plan: bothLanguages(results) });
    const before = readBaseline(repo);
    const refusals = [
      [PI, "none.js", "zz:1", "false-positive: x"], // no excess
      [PI, "a.js", "aa:1", "untriaged"],
      [PI, "a.js", "aa:1", "x"],
      [PI, "a.js", "aa:1", " false-positive:  constant input "], // unchanged reason
      ["js/request-forgery", "r.js", "rr:1", "operator-authz: not for this rule"],
    ];
    for (const [rule, file, hash, reason] of refusals) {
      const r = run(repo, ["--accept", rule, file, hash, "--reason", reason]);
      expect(r.status, `${rule} ${reason}`).toBe(2);
      expect(readBaseline(repo)).toBe(before);
    }
    write(repo.dir, "a.js", "changed after the run\n");
    expect(run(repo, ["--accept", PI, "a.js", "aa:1", "--reason", "false-positive: later"]).status).toBe(2);
    expect(readBaseline(repo)).toBe(before);
  });

  it("--prune lowers the baseline after a run and recomputes the verdict", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 2), entry(PI, "gone.js", "ff:1", 1, "github-dismissed (#12, false positive): x")]);
    run(repo, [], { plan: bothLanguages([{ ruleId: PI, file: "a.js", line: 1, hash: "aa:1" }]) });
    const r = run(repo, ["--prune"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("github-dismissed (#12, false positive): x");
    expect(JSON.parse(readBaseline(repo)).entries.map((e) => [e.file, e.count])).toEqual([["a.js", 1]]);
  });
});

/* harden-codeql-ratchet-followups: prune/accept bound to the baseline the run compared against (test-plan #E1\u2013#E12, #X1). */
describe("baseline binding (harden-codeql-ratchet-followups)", () => {
  const NOTE = /baseline binding was not checked/;
  const canonicalHash = (text) => createHash("sha256").update(serializeBaseline(JSON.parse(text))).digest("hex");
  const lastRunFile = (repo) => join(stateDirOf(repo), "last-run.json");
  const readLastRun = (repo) => JSON.parse(readFileSync(lastRunFile(repo), "utf8"));
  const dropHash = (repo) => {
    const { baselineHash: _drop, ...rest } = readLastRun(repo);
    writeFileSync(lastRunFile(repo), JSON.stringify(rest));
  };
  const editBaseline = (repo, fn) => {
    const b = JSON.parse(readBaseline(repo));
    fn(b);
    writeBaselineFile(repo, b);
    return readBaseline(repo);
  };
  const r1 = { ruleId: PI, file: "a.js", line: 1, hash: "aa:1" };
  const r2 = { ruleId: LOG, file: "b.js", line: 1, hash: "bb:1" };
  const r3 = { ruleId: PI, file: "c.js", line: 1, hash: "cc:1" };

  it("#E1 a hand edit after the run is refused by --accept and --prune", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 1, "false-positive: x")]);
    expect(run(repo, [], { plan: bothLanguages([r1, r2]) }).status).toBe(1);
    const edited = editBaseline(repo, (b) => {
      b.entries[0].count = 5;
    });
    for (const args of [["--accept", LOG, "b.js", "bb:1", "--reason", "false-positive: constant input"], ["--prune"]]) {
      const r = run(repo, args);
      expect(r.status, args[0]).toBe(2);
      expect(r.stderr).toMatch(/re-run/);
      expect(readBaseline(repo)).toBe(edited);
    }
  });

  it("#E2 a legacy record without a hash is accepted with a note and re-bound", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 2)]);
    run(repo, [], { plan: bothLanguages([r1]) });
    dropHash(repo);
    const r = run(repo, ["--prune"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(NOTE);
    expect(readLastRun(repo).baselineHash).toBe(canonicalHash(readBaseline(repo)));
  });

  it("#E3 an edit during the analysis is refused afterwards", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 1, "false-positive: x")]);
    const mid = `${JSON.stringify(baselineOf([entry(PI, "a.js", "aa:1", 1, "false-positive: edited mid-run")]), null, 2)}\n`;
    run(repo, [], { plan: { ...bothLanguages([r1]), analyzeWrites: { path: join(repo.dir, BASELINE), content: mid } } });
    expect(readBaseline(repo)).toBe(mid);
    expect(run(repo, ["--prune"]).status).toBe(2);
    expect(readBaseline(repo)).toBe(mid);
  });

  it("#E4 a triage between the run and an accept keeps the chain working", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 1)]);
    expect(run(repo, [], { plan: bothLanguages([r1, r2]) }).status).toBe(1);
    expect(run(repo, ["--triage", PI, "a.js", "aa:1", "--reason", "false-positive: x"]).status).toBe(0);
    const a = run(repo, ["--accept", LOG, "b.js", "bb:1", "--reason", "false-positive: y"]);
    expect(a.status).toBe(0);
    expect(a.stdout).toContain("codeql ratchet: pass");
    expect(JSON.parse(readBaseline(repo)).entries.map((e) => e.reason)).toEqual(["false-positive: x", "false-positive: y"]);
  });

  it("#E5 a triage does not launder a hand edit", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 1), entry(LOG, "b.js", "bb:1", 1, "false-positive: x")]);
    run(repo, [], { plan: bothLanguages([r1, r2]) });
    editBaseline(repo, (b) => {
      b.entries.find((e) => e.file === "b.js").count = 4;
    });
    expect(run(repo, ["--triage", PI, "a.js", "aa:1", "--reason", "false-positive: y"]).status).toBe(0);
    const postTriage = readBaseline(repo);
    expect(run(repo, ["--prune"]).status).toBe(2);
    expect(readBaseline(repo)).toBe(postTriage);
  });

  it("#E6 a triage after a legacy run does not add a hash", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 1), entry(LOG, "b.js", "bb:1", 1, "false-positive: x")]);
    run(repo, [], { plan: bothLanguages([r1, r2]) });
    dropHash(repo);
    editBaseline(repo, (b) => {
      b.entries.find((e) => e.file === "b.js").count = 4;
    });
    expect(run(repo, ["--triage", PI, "a.js", "aa:1", "--reason", "false-positive: y"]).status).toBe(0);
    expect(readLastRun(repo)).not.toHaveProperty("baselineHash");
  });

  it("#E7 reformatting and reordering do not invalidate the run", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 1, "false-positive: x"), entry(LOG, "b.js", "bb:1", 1, "false-positive: y")]);
    run(repo, [], { plan: bothLanguages([r1, r2]) });
    const b = JSON.parse(readBaseline(repo));
    b.entries.reverse();
    write(repo.dir, BASELINE, `${JSON.stringify(b, null, 4)}\n`);
    const r = run(repo, ["--prune"]);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/re-run/);
  });

  it("#E8 a whitespace change inside a string is not formatting", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 1, "false-positive: constant input")]);
    run(repo, [], { plan: bothLanguages([r1]) });
    // Still a valid reason (REASON_PREFIX), so only the binding can refuse it.
    const edited = editBaseline(repo, (b) => {
      b.entries[0].reason = "false-positive: constant  input";
    });
    expect(run(repo, ["--prune"]).status).toBe(2);
    expect(readBaseline(repo)).toBe(edited);
  });

  it("#E9 a seed run records the written baseline's hash", () => {
    const repo = makeRepo();
    expect(run(repo, ["--write-baseline"], { plan: bothLanguages([r1]) }).status).toBe(0);
    expect(readLastRun(repo).baselineHash).toBe(canonicalHash(readBaseline(repo)));
    const r = run(repo, ["--prune"]);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(NOTE);
  });

  it("#E10 prune, accept, accept after one run all succeed and keep the record bound", () => {
    const repo = seeded([entry(PI, "gone.js", "ff:1", 1, "false-positive: z")]);
    expect(run(repo, [], { plan: bothLanguages([r2, r3]) }).status).toBe(1);
    expect(run(repo, ["--prune"]).status).toBe(1);
    expect(run(repo, ["--accept", LOG, "b.js", "bb:1", "--reason", "false-positive: y"]).status).toBe(1);
    const last = run(repo, ["--accept", PI, "c.js", "cc:1", "--reason", "false-positive: y"]);
    expect(last.status).toBe(0);
    expect(last.stdout).toContain("codeql ratchet: pass");
    expect(readLastRun(repo).baselineHash).toBe(canonicalHash(readBaseline(repo)));
  });

  it("#E11 a plain run records the canonical hash of the parsed baseline", () => {
    const repo = seeded([entry(LOG, "b.js", "bb:1", 1, "false-positive: y"), entry(PI, "a.js", "aa:1", 1, "false-positive: x")]);
    run(repo, [], { plan: bothLanguages([r1, r2]) });
    expect(readLastRun(repo).baselineHash).toBe(canonicalHash(readBaseline(repo)));
  });

  it("#E12 a triage without a recorded run writes no record", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 1)]);
    expect(run(repo, ["--triage", PI, "a.js", "aa:1", "--reason", "false-positive: x"]).status).toBe(0);
    expect(existsSync(lastRunFile(repo))).toBe(false);
  });

  it("#X1 an invalid baseline is refused before the binding, nothing written", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 1, "false-positive: x")]);
    run(repo, [], { plan: bothLanguages([r1]) });
    const record = readFileSync(lastRunFile(repo), "utf8");
    const truncated = readBaseline(repo).slice(0, 20);
    write(repo.dir, BASELINE, truncated);
    const r = run(repo, ["--prune"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("is not valid JSON");
    expect(readBaseline(repo)).toBe(truncated);
    expect(readFileSync(lastRunFile(repo), "utf8")).toBe(record);
  });
});

describe("failures around the snapshot and lock (#X3, #X4)", () => {
  it("#X3 a conflicted index is exit 2 asking to resolve conflicts", () => {
    const repo = makeRepo({ files: { "f.js": "base\n" } });
    git(repo.dir, ["checkout", "-q", "-b", "other"]);
    write(repo.dir, "f.js", "other\n");
    git(repo.dir, ["commit", "-qam", "other"]);
    git(repo.dir, ["checkout", "-q", "main"]);
    write(repo.dir, "f.js", "main\n");
    git(repo.dir, ["commit", "-qam", "main"]);
    git(repo.dir, ["merge", "other"], { allowFail: true });
    writeBaselineFile(repo, baselineOf());
    const r = run(repo, [], { plan: bothLanguages([]) });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/resolve conflicts/);
    expect(creates(r.calls)).toHaveLength(0);
  });

  const lockOwner = (repo, owner) => {
    const lock = join(stateDirOf(repo), "lock");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "owner.json"), JSON.stringify(owner));
  };

  it("#X4 (a) a live lock refuses analysis and --prune", () => {
    const repo = seeded([entry(PI, "a.js", "aa:1", 1)]);
    lockOwner(repo, { pid: process.pid, start: processStartTime(process.pid) });
    const before = readBaseline(repo);
    expect(run(repo, [], { plan: bothLanguages([]) }).status).toBe(2);
    expect(run(repo, ["--prune"]).status).toBe(2);
    expect(readBaseline(repo)).toBe(before);
  });

  it("#X4 (c) an unverifiable owner (no recorded start time) goes stale with age", () => {
    const repo = seeded();
    lockOwner(repo, { pid: process.pid, start: null });
    expect(run(repo, [], { plan: bothLanguages([]) }).status).toBe(2); // fresh: still trusted
    const owner = join(stateDirOf(repo), "lock", "owner.json");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(owner, old, old);
    expect(run(repo, [], { plan: bothLanguages([]) }).status).toBe(0); // 2 h old: PID reuse is likelier than a live run
  });

  it("#X4 (b) a lock of a dead process is taken over", () => {
    const repo = seeded();
    const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
    lockOwner(repo, { pid: Number(dead.stdout), start: null });
    const r = run(repo, [], { plan: bothLanguages([]) });
    expect(r.status).toBe(0);
    expect(existsSync(join(stateDirOf(repo), "lock"))).toBe(false); // released on exit
  });
});

/* ── local model pack (change codeql-model-pack-and-mirror) ── */

const MODEL_DIR = ".github/codeql/extensions";
const modelYaml = (rows, marker = "") =>
  `${marker}extensions:\n  - addsTo: { pack: codeql/javascript-all, extensible: barrierModel }\n    data:\n${Array.from({ length: rows }, (_, i) => `      - ["'p/m${i}.js'", "Member[f].Argument[0]", "path-injection"]`).join("\n")}\n`;
const modelRepo = (files = { "a.model.yml": modelYaml(2) }, extra = {}) => {
  const repo = makeRepo({ files: Object.fromEntries(Object.entries(files).map(([n, c]) => [`${MODEL_DIR}/${n}`, c])), ...extra });
  writeBaselineFile(repo, baselineOf());
  return repo;
};
const jsAnalyze = (cs) => analyzes(cs).find((c) => c.argv[2].endsWith("db-javascript-typescript"));
const flagOf = (c, name) => c.argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const resolveExt = (cs) => cs.filter((c) => c.argv[0] === "resolve" && c.argv[1] === "extensions");
const MODEL_PACK = "pi-dashboard/local-models";

describe("local model pack — loading (#E6–#E10)", () => {
  it("#E6 only the JavaScript analysis gets the pack; never --download", () => {
    const repo = modelRepo();
    const r = run(repo, ["--json"], { plan: bothLanguages([]) });
    expect(r.status).toBe(0);
    const js = jsAnalyze(r.calls);
    const dir = flagOf(js, "--additional-packs");
    expect(dir).toBeTruthy();
    expect(dir.startsWith(join(stateDirOf(repo)))).toBe(true);
    expect(dir.includes("/src/") || dir.endsWith("/src")).toBe(false); // outside <run>/src
    expect(flagOf(js, "--model-packs")).toBe(MODEL_PACK);
    for (const c of analyzes(r.calls).filter((x) => x !== js)) {
      expect(c.argv.some((a) => a.startsWith("--additional-packs") || a.startsWith("--model-packs"))).toBe(false);
    }
    for (const c of r.calls) expect(c.argv).not.toContain("--download");
  });

  it("#E7 the pack holds exactly the manifest and the snapshot's model files; the snapshot id is untouched", () => {
    const repo = modelRepo({ "a.model.yml": modelYaml(1) });
    write(repo.dir, `${MODEL_DIR}/AGENTS.md`, "# not a model\n");
    git(repo.dir, ["add", "-A"]);
    git(repo.dir, ["commit", "-q", "-m", "agents"]);
    const before = snapshotId(repo.dir);
    const r = run(repo, [], { plan: bothLanguages([]) });
    expect(r.status).toBe(0);
    expect(Object.keys(jsAnalyze(r.calls).modelPack).sort()).toEqual(["a.model.yml", "codeql-pack.yml"]);
    expect(jsAnalyze(r.calls).modelPack["codeql-pack.yml"]).toContain(MODEL_PACK);
    expect(JSON.parse(readFileSync(join(stateDirOf(repo), "last-run.json"), "utf8")).snapshotId).toBe(before);
    expect(snapshotId(repo.dir)).toBe(before);
  });

  it("#E8 an uncommitted model edit is what gets analyzed", () => {
    const repo = modelRepo({ "a.model.yml": modelYaml(1) });
    write(repo.dir, `${MODEL_DIR}/a.model.yml`, modelYaml(1, "# UNSTAGED-MARKER\n"));
    const r = run(repo, [], { plan: bothLanguages([]) });
    expect(r.status).toBe(0);
    expect(jsAnalyze(r.calls).modelPack["a.model.yml"]).toContain("UNSTAGED-MARKER");
  });

  it("#E9 a git-ignored model file is not applied", () => {
    const repo = modelRepo({ "a.model.yml": modelYaml(1) });
    write(repo.dir, ".gitignore", `node_modules\n${MODEL_DIR}/x.model.yml\n`);
    write(repo.dir, `${MODEL_DIR}/x.model.yml`, modelYaml(1));
    const r = run(repo, [], { plan: bothLanguages([]) });
    expect(r.status).toBe(0);
    expect(Object.keys(jsAnalyze(r.calls).modelPack)).not.toContain("x.model.yml");
  });

  it("#E10 versions.models is sha256 over the files in byte-wise sorted path order", () => {
    const a = modelYaml(1, "# a\n");
    const b = modelYaml(2, "# b\n");
    const repo = modelRepo({ "b.model.yml": b, "a.model.yml": a });
    const r = run(repo, ["--json"], { plan: bothLanguages([]) });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).versions.models).toBe(createHash("sha256").update(a).update(b).digest("hex"));
  });

  it("a repo without model files runs without the pack flags", () => {
    const repo = seeded();
    const r = run(repo, ["--json"], { plan: bothLanguages([]) });
    expect(r.status).toBe(0);
    expect(jsAnalyze(r.calls).argv.some((a) => a.startsWith("--additional-packs"))).toBe(false);
    expect(resolveExt(r.calls)).toHaveLength(0);
    expect(JSON.parse(r.stdout).versions.models).toBeNull();
  });
});

describe("local model pack — verification (#X1–#X4)", () => {
  const failsBeforeAnalysis = (r) => {
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(MODEL_PACK);
    expect(r.stderr).not.toContain("SKIPPED");
    expect(analyzes(r.calls)).toHaveLength(0);
  };

  it("#X1 a rowCount below the file's data rows is exit 2", () => {
    const repo = modelRepo({ "a.model.yml": modelYaml(10) });
    failsBeforeAnalysis(run(repo, [], { plan: { ...bothLanguages([]), resolveExtensions: { rowCountDelta: -3 } } }));
  });

  it("#X2 a copied file the resolver does not list is exit 2", () => {
    const repo = modelRepo({ "a.model.yml": modelYaml(2) });
    failsBeforeAnalysis(run(repo, [], { plan: { ...bothLanguages([]), resolveExtensions: { omitFile: "a.model.yml" } } }));
  });

  it("#X3 an unresolvable pack is an error, not a skip — also with --json", () => {
    const repo = modelRepo();
    const stderr = `ERROR: Could not find extension pack '${MODEL_PACK}'`;
    const plan = { ...bothLanguages([]), resolveExtensions: { exit: 2, stderr } };
    failsBeforeAnalysis(run(repo, [], { plan }));
    const j = run(repo, ["--json"], { plan });
    expect(j.status).toBe(2);
    expect(j.stderr).not.toMatch(/^CODEQL SKIPPED:/m);
    expect(JSON.parse(j.stdout).status).toBe("error");
  });

  it("#X4 unparsable resolver output is exit 2", () => {
    const repo = modelRepo();
    failsBeforeAnalysis(run(repo, [], { plan: { ...bothLanguages([]), resolveExtensions: { stdout: "not json at all" } } }));
  });
});

describe("run record (#E15)", () => {
  it("#E15 last-run.json carries headCommit and clean", () => {
    const repo = seeded();
    const head = gitOut(repo.dir, ["rev-parse", "HEAD"]).trim();
    const recorded = () => JSON.parse(readFileSync(join(stateDirOf(repo), "last-run.json"), "utf8"));
    expect(run(repo, [], { plan: bothLanguages([]) }).status).toBe(0);
    expect(recorded()).toMatchObject({ headCommit: head, clean: true }); // the baseline file itself never counts
    write(repo.dir, "untracked.js", "x\n");
    expect(run(repo, [], { plan: bothLanguages([]) }).status).toBe(0);
    expect(recorded()).toMatchObject({ headCommit: head, clean: false });
  });
});
