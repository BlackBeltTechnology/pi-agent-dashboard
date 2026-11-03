/**
 * `scripts/codeql-local.mjs --mirror-dismissal` against a FAKE `codeql` and a FAKE `gh`
 * (test-plan #M1–#M17). The mirror records a GitHub dismissal in `codeql-baseline.json` only
 * when GitHub itself confirms it for the exact (rule, file, lines, commit).
 *
 * See change: codeql-model-pack-and-mirror.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baselineOf, entry, ghAlert, git, gitOut, makeRepo, run, sarifOf, stateDirOf, write, writeBaselineFile } from "./fixtures/codeql-harness.mjs";

const PI = "js/path-injection";
const BASELINE = "codeql-baseline.json";
const KEY = [PI, "a.js", "aa:1"];
const ORIGINAL = "operator-authz: behind the admission guard";
const bothLanguages = (results) => ({ sarif: { "javascript-typescript": sarifOf(results), actions: sarifOf([]) } });
const readBaseline = (repo) => readFileSync(join(repo.dir, BASELINE), "utf8");

/** A repo with `origin`, a baseline entry for KEY and a recorded clean run at HEAD. */
function setup({ lines = [10, 20], reason = ORIGINAL, extra = [], commitBaseline = false, remote = "git@github.com:o/r.git", dirtyDuringRun = false } = {}) {
  const repo = makeRepo();
  if (remote) git(repo.dir, ["remote", "add", "origin", remote]);
  writeBaselineFile(repo, baselineOf([entry(PI, "a.js", "aa:1", lines.length, reason), ...extra]));
  if (commitBaseline) {
    git(repo.dir, ["add", BASELINE]);
    git(repo.dir, ["commit", "-q", "-m", "baseline"]);
  }
  if (dirtyDuringRun) write(repo.dir, "untracked.js", "x\n");
  const r = run(repo, [], { plan: bothLanguages(lines.map((line) => ({ ruleId: PI, file: "a.js", line, hash: "aa:1" }))) });
  expect(r.status, r.stderr).toBe(0);
  return { repo, head: gitOut(repo.dir, ["rev-parse", "HEAD"]).trim() };
}

/** `gh` plan with dismissed alerts at the recorded commit; per-alert overrides win. */
const alertsAt = (head, defs) => ({ alerts: Object.fromEntries(Object.entries(defs).map(([n, o]) => [n, ghAlert(Number(n), { path: "a.js", sha: head, ...o })])) });
const happy = (head) => alertsAt(head, { 12: { line: 10 }, 13: { line: 20 } });
const mirror = (repo, alert, opts = {}) => run(repo, ["--mirror-dismissal", ...KEY, ...(Array.isArray(alert) ? alert : ["--alert", alert])], opts);

/** Refused: exit 2 and the baseline bytes are exactly what they were. */
const refused = (repo, r, before = readBaseline(repo)) => {
  expect(r.status, r.stderr).toBe(2);
  expect(r.stderr).toMatch(/^CODEQL ERROR: /m);
  expect(r.stderr, "a crash or a broken fake, not a refusal").not.toMatch(/^\s+at |not an executable file.*fake-gh/m);
  expect(readBaseline(repo)).toBe(before);
};

describe("--mirror-dismissal — happy path (#M1, #M17)", () => {
  it("#M1 records the shared GitHub reason and keeps `--prune` usable", () => {
    const { repo, head } = setup();
    const r = mirror(repo, "12,13", { gh: happy(head) });
    expect(r.status, r.stderr).toBe(0);
    const e = JSON.parse(readBaseline(repo)).entries[0];
    expect(e.reason).toBe(`github-dismissed (#12, #13, won't fix): ${ORIGINAL}`);
    expect(e.count).toBe(2);
    expect(r.ghCalls.map((c) => c.argv)).toEqual([
      ["api", "repos/o/r/code-scanning/alerts/12"],
      ["api", "repos/o/r/code-scanning/alerts/13"],
    ]);
    expect(run(repo, ["--prune"]).status).toBe(0); // the hash was re-bound to the mirrored baseline
  });

  it("#M17 a branch whose only baseline change is a mirror passes --check-baseline-diff, also --no-growth", () => {
    const { repo, head } = setup({ commitBaseline: true });
    const live = gitOut(repo.dir, ["rev-parse", "HEAD"]).trim();
    expect(mirror(repo, "12,13", { gh: happy(live) }).status).toBe(0);
    expect(head).toBe(live);
    expect(run(repo, ["--check-baseline-diff", "HEAD"]).status).toBe(0);
    expect(run(repo, ["--check-baseline-diff", "HEAD", "--no-growth"]).status).toBe(0);
  });
});

describe("--mirror-dismissal — GitHub must confirm exactly (#M2–#M7, #M16)", () => {
  const cases = {
    "#M2 one alert short": ["12", () => ({}), /1 alert\(s\) given for an entry of 2/],
    "#M2 one alert too many": ["12,13,14", (h) => alertsAt(h, { 12: { line: 10 }, 13: { line: 20 }, 14: { line: 20 } }), /3 alert\(s\) given/],
    "#M3 two alerts on one line cover one result": ["12,13", (h) => alertsAt(h, { 12: { line: 10 }, 13: { line: 10 } }), /alert lines \[10,10\] differ/],
    "#M4 an alert that is still open": ["12,13", (h) => alertsAt(h, { 12: { line: 10 }, 13: { line: 20, state: "open" } }), /alert #13 is open, not dismissed/],
    "#M5 an alert of another file": ["12,13", (h) => alertsAt(h, { 12: { line: 10 }, 13: { line: 20, path: "b.js" } }), /alert #13 is for file b\.js/],
    "#M5 an alert of another rule": ["12,13", (h) => alertsAt(h, { 12: { line: 10 }, 13: { line: 20, rule: "js/command-line-injection" } }), /alert #13 is for rule js\/command-line-injection/],
    "#M6 an alert from another commit": ["12,13", (h) => alertsAt(h, { 12: { line: 10 }, 13: { line: 20, sha: "1".repeat(40) } }), /alert #13 was analysed at 1{40}/],
    "#M7 different dismissal reasons": ["12,13", (h) => alertsAt(h, { 12: { line: 10, reason: "false positive" }, 13: { line: 20, reason: "won't fix" } }), /different dismissal reasons/],
    "#M7 a reason outside the grammar": ["12,13", (h) => alertsAt(h, { 12: { line: 10, reason: "because" }, 13: { line: 20, reason: "because" } }), /dismissal reason "because"/],
  };
  for (const [name, [alert, plan, why]] of Object.entries(cases)) {
    it(`${name} → exit 2, baseline unchanged`, () => {
      const { repo, head } = setup();
      const r = mirror(repo, alert, { gh: plan(head) });
      refused(repo, r);
      expect(r.stderr).toMatch(why);
    });
  }

  it("#M4 names the alert that is not dismissed", () => {
    const { repo, head } = setup();
    const r = mirror(repo, "12,13", { gh: alertsAt(head, { 12: { line: 10 }, 13: { line: 20, state: "open" } }) });
    refused(repo, r);
    expect(r.stderr).toContain("13");
  });

  it("#M16 a response without most_recent_instance.commit_sha names the field", () => {
    const { repo, head } = setup();
    const gh = alertsAt(head, { 12: { line: 10 }, 13: { line: 20, drop: ["most_recent_instance.commit_sha"] } });
    const r = mirror(repo, "12,13", { gh });
    refused(repo, r);
    expect(r.stderr).toContain("most_recent_instance.commit_sha");
  });
});

describe("--mirror-dismissal — inputs are checked before GitHub is asked (#M8–#M12, #M15)", () => {
  it("#M8 an entry that is untriaged, already mirrored, or absent is refused without a gh call", () => {
    for (const reason of ["untriaged", "github-dismissed (#5, won't fix): x"]) {
      const { repo, head } = setup({ reason });
      const r = mirror(repo, "12,13", { gh: happy(head) });
      refused(repo, r);
      expect(r.ghCalls).toHaveLength(0);
    }
    const { repo, head } = setup();
    const r = run(repo, ["--mirror-dismissal", PI, "a.js", "ff:9", "--alert", "12,13"], { gh: happy(head) });
    refused(repo, r);
    expect(r.ghCalls).toHaveLength(0);
  });

  it("#M9 a dirty run, a legacy record and no record are all refused", () => {
    const dirty = setup({ dirtyDuringRun: true });
    const d = mirror(dirty.repo, "12,13", { gh: happy(dirty.head) });
    refused(dirty.repo, d);
    expect(d.stderr).toMatch(/not on a clean tree/);

    const legacy = setup();
    const lastRun = join(stateDirOf(legacy.repo), "last-run.json");
    const rec = JSON.parse(readFileSync(lastRun, "utf8"));
    delete rec.baselineHash;
    writeFileSync(lastRun, JSON.stringify(rec));
    const l = mirror(legacy.repo, "12,13", { gh: happy(legacy.head) });
    refused(legacy.repo, l);
    expect(l.stderr).toMatch(/legacy record/);

    const none = setup();
    rmSync(join(stateDirOf(none.repo), "last-run.json"));
    const n = mirror(none.repo, "12,13", { gh: happy(none.head) });
    refused(none.repo, n);
    expect(n.stderr).toMatch(/no recorded CodeQL run/);
  });

  it("#M10 every other mode flag is refused with the mirror, and --alert alone is an error", () => {
    const { repo, head } = setup();
    const base = ["--mirror-dismissal", ...KEY, "--alert", "12,13"];
    for (const extra of [["--json"], ["--reason", "x"], ["--prune"], ["--accept"], ["--triage"], ["--write-baseline"], ["--check-baseline-diff", "HEAD"], ["--no-growth"]]) {
      refused(repo, run(repo, [...base, ...extra], { gh: happy(head) }));
    }
    refused(repo, run(repo, ["--alert", "12"], { gh: happy(head) }));
  });

  it("#M11 a malformed alert list never reaches gh", () => {
    const { repo, head } = setup();
    for (const value of ["0", "a", "12,12", "", "-1", "12,,13"]) {
      const r = mirror(repo, [`--alert=${value}`], { gh: happy(head) });
      refused(repo, r);
      expect(r.ghCalls).toHaveLength(0);
    }
  });

  it("#M12 a baseline hand-edited after the run still mirrors, but is not re-bound", () => {
    const other = entry("js/clear-text-logging", "b.js", "bb:1", 1, "untriaged");
    const { repo, head } = setup({ extra: [other] });
    const edited = JSON.parse(readBaseline(repo));
    edited.entries.find((e) => e.file === "b.js").reason = "accepted-risk: edited by hand";
    writeFileSync(join(repo.dir, BASELINE), `${JSON.stringify(edited, null, 2)}\n`);
    const r = mirror(repo, "12,13", { gh: happy(head) });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readBaseline(repo)).entries.find((e) => e.file === "a.js").reason).toMatch(/^github-dismissed \(#12, #13, won't fix\): /);
    const prune = run(repo, ["--prune"]);
    expect(prune.status).toBe(2);
    expect(prune.stderr).toMatch(/re-run the analysis first/);
  });

  it("#M15 an invalid PI_CODEQL_GH_TIMEOUT_MS never reaches gh", () => {
    const { repo, head } = setup();
    for (const value of ["0", "-5", "abc", ""]) {
      const r = mirror(repo, "12,13", { gh: happy(head), env: { PI_CODEQL_GH_TIMEOUT_MS: value } });
      refused(repo, r);
      expect(r.ghCalls).toHaveLength(0);
    }
  });
});

describe("--mirror-dismissal — GitHub CLI failures (#M13, #M14)", () => {
  it("#M13 a gh that fails to authenticate, or a binary that is not executable, is refused", () => {
    const { repo } = setup();
    const gh = { exit: 1, stderr: "gh: To get started with GitHub CLI, please run: gh auth login" };
    const failed = mirror(repo, "12,13", { gh });
    refused(repo, failed);
    expect(failed.stderr).toMatch(/reading alert #12 failed: .*gh auth login/);
    const missing = mirror(repo, "12,13", { env: { PI_CODEQL_GH_BIN: join(repo.root, "no-such-gh") } });
    refused(repo, missing);
    expect(missing.stderr).toContain("PI_CODEQL_GH_BIN");
  });

  it("#M14 a stalled gh is killed by the timeout", () => {
    const { repo, head } = setup();
    const started = Date.now();
    const r = mirror(repo, "12,13", { gh: { ...happy(head), sleepMs: 5000 }, env: { PI_CODEQL_GH_TIMEOUT_MS: "200" } });
    refused(repo, r);
    expect(r.stderr).toMatch(/timed out after 200 ms/);
    expect(Date.now() - started).toBeLessThan(4000);
  });
});

describe("--mirror-dismissal — repository (#M-remote)", () => {
  it("refuses an origin that is not a plain github.com repository", () => {
    for (const remote of ["https://gitlab.com/o/r", "git@github.com:o/..", "https://github.com/o/r/x"]) {
      const { repo, head } = setup({ remote });
      const r = mirror(repo, "12,13", { gh: happy(head) });
      refused(repo, r);
      expect(r.stderr).toMatch(/not a plain github\.com repository URL/);
      expect(r.ghCalls).toHaveLength(0);
    }
  });

  it("refuses a repo without an origin", () => {
    const { repo, head } = setup({ remote: null });
    const r = mirror(repo, "12,13", { gh: happy(head) });
    refused(repo, r);
    expect(r.stderr).toMatch(/not a plain github\.com repository URL/);
    expect(existsSync(join(repo.dir, BASELINE))).toBe(true);
  });
});

// ── One-off GitHub comment sync (test-plan #X10, #X11) ─────────────────────────
// evidence/sync-dismissal-comments.mjs against a PATCH-capable fake `gh`. The
// change folder moves to the archive on ship; the locator follows it.
// See change: fix-codeql-baseline-coverage.
const SYNC_CHANGE = "fix-codeql-baseline-coverage";
function syncScript() {
  const root = join(import.meta.dirname, "..", "..", "openspec", "changes");
  const active = join(root, SYNC_CHANGE, "evidence", "sync-dismissal-comments.mjs");
  if (existsSync(active)) return active;
  const d = readdirSync(join(root, "archive")).find((x) => x.endsWith(`-${SYNC_CHANGE}`));
  return join(root, "archive", d, "evidence", "sync-dismissal-comments.mjs");
}
const FAKE_SYNC_GH = `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const st = JSON.parse(readFileSync(process.env.FAKE_SYNC_STATE, "utf8"));
const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_SYNC_LOG, JSON.stringify(argv) + "\\n");
const n = /alerts\\/(\\d+)$/.exec(argv.find((a) => a.includes("/alerts/")) ?? "")?.[1];
const a = st.alerts[n];
const field = (k) => argv.find((x) => x.startsWith(k + "="))?.slice(k.length + 1);
if (argv.includes("PATCH")) {
  // Real GitHub: re-dismissing a dismissed alert is HTTP 400 (canary #57).
  if (field("state") === "dismissed" && a.state === "dismissed") { process.stderr.write("Alert is already dismissed. (HTTP 400)"); process.exit(1); }
  if (field("state") === "open") Object.assign(a, { state: "open", dismissed_reason: null, dismissed_comment: null });
  else {
    if (st.failPatch?.includes(Number(n))) { process.stderr.write("HTTP 502"); process.exit(1); }
    Object.assign(a, { state: "dismissed", dismissed_reason: field("dismissed_reason"), dismissed_comment: field("dismissed_comment") });
  }
  writeFileSync(process.env.FAKE_SYNC_STATE, JSON.stringify(st));
}
process.stdout.write(JSON.stringify(a));
`;
function syncRun({ table, alerts, failPatch = [], args = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "sync-"));
  const state = join(dir, "state.json");
  const log = join(dir, "calls.jsonl");
  const fake = join(dir, "gh.mjs");
  writeFileSync(fake, FAKE_SYNC_GH);
  const ghSh = join(dir, "gh");
  writeFileSync(ghSh, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`, { mode: 0o755 });
  writeFileSync(state, JSON.stringify({ alerts, failPatch }));
  writeFileSync(join(dir, "table.json"), JSON.stringify(table));
  const go = () => {
    rmSync(log, { force: true });
    const r = spawnSync(process.execPath, [syncScript(), "--table", join(dir, "table.json"), "--log", join(dir, "log.jsonl"), ...args], {
      encoding: "utf8",
      env: { ...process.env, PI_SYNC_GH_BIN: ghSh, FAKE_SYNC_STATE: state, FAKE_SYNC_LOG: log },
    });
    const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { ...r, calls, patches: calls.filter((c) => c.includes("PATCH")), state: () => JSON.parse(readFileSync(state, "utf8")) };
  };
  return { go, setFail: (f) => writeFileSync(state, JSON.stringify({ ...JSON.parse(readFileSync(state, "utf8")), failPatch: f })) };
}
const row = (text = "operator-authz: gate: x y:1; z") => ({ entryKey: "k", dismissedReason: "won't fix", reasonText: text });
const dismissed = (n, o = {}) => ({ number: n, state: "dismissed", dismissed_reason: "won't fix", dismissed_comment: "old", ...o });

describe("sync-dismissal-comments.mjs (#X10, #X11)", () => {
  it("#X10 pre-flight aborts before any PATCH on an open, fixed or re-reasoned alert", () => {
    for (const bad of [{ state: "open", dismissed_reason: null }, { state: "fixed" }, { dismissed_reason: "false positive" }]) {
      const s = syncRun({ table: { 1: row(), 2: row() }, alerts: { 1: dismissed(1), 2: dismissed(2, bad) } }).go();
      expect(s.status, JSON.stringify(bad)).not.toBe(0);
      expect(s.patches).toEqual([]);
    }
  });

  it("#X10 a mid-run 5xx stops non-zero; a re-run re-dismisses the alert it left open and resumes", () => {
    const h = syncRun({ table: { 1: row(), 2: row(), 3: row() }, alerts: { 1: dismissed(1), 2: dismissed(2), 3: dismissed(3) }, failPatch: [2] });
    const first = h.go();
    expect(first.status).not.toBe(0);
    expect(first.stderr).toMatch(/#2 failed after 1 patched \(alert is OPEN\)/);
    expect(first.state().alerts[2].state).toBe("open");
    expect(first.state().alerts[3].dismissed_comment).toBe("old"); // never touched
    h.setFail([]);
    const second = h.go();
    expect(second.status, second.stderr).toBe(0);
    const target = (c) => c.find((a) => a.includes("/alerts/")).replace(/.*\//, "");
    // #1 already done (no call), #2 re-dismissed only, #3 reopened + re-dismissed.
    expect(second.patches.map((c) => [target(c), c.find((a) => a.startsWith("state="))])).toEqual([
      ["2", "state=dismissed"],
      ["3", "state=open"],
      ["3", "state=dismissed"],
    ]);
    const st = second.state();
    for (const n of [1, 2, 3]) {
      expect(st.alerts[n].state).toBe("dismissed");
      expect(st.alerts[n].dismissed_reason).toBe("won't fix");
      expect(st.alerts[n].dismissed_comment).toBe(`${row().reasonText} — See change: ${SYNC_CHANGE}`);
    }
  });

  it("#X10 an open alert the script did not reopen still aborts the pre-flight", () => {
    const s = syncRun({ table: { 1: row() }, alerts: { 1: dismissed(1, { state: "open", dismissed_reason: null }) } }).go();
    expect(s.status).not.toBe(0);
    expect(s.patches).toEqual([]);
  });

  it("#X11 236 chars → a 279-char comment is sent; 237 → refused before any gh call", () => {
    const ok = syncRun({ table: { 1: row("a".repeat(236)) }, alerts: { 1: dismissed(1) } }).go();
    expect(ok.status, ok.stderr).toBe(0);
    const c = ok.patches.flat().find((a) => a.startsWith("dismissed_comment="));
    expect(c.length - "dismissed_comment=".length).toBe(279);
    const bad = syncRun({ table: { 1: row("a".repeat(236)), 2: row("a".repeat(237)) }, alerts: { 1: dismissed(1), 2: dismissed(2) } }).go();
    expect(bad.status).not.toBe(0);
    expect(bad.calls).toEqual([]);
  });

  it("--dry-run reads but never patches", () => {
    const s = syncRun({ table: { 1: row() }, alerts: { 1: dismissed(1) }, args: ["--dry-run"] }).go();
    expect(s.status, s.stderr).toBe(0);
    expect(s.patches).toEqual([]);
    expect(s.stdout).toContain("new: operator-authz: gate:");
  });
});
