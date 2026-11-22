/**
 * Nightly full-suite report (change: speed-up-ci-affected-tests, D6;
 * test-plan X9–X11, task 4.3).
 *
 * A regression that affected-only selection lets through surfaces here, so
 * the issue must name WHERE to bisect: the develop range since the last green
 * SCHEDULED run. A dispatch run never anchors (it may have run on any branch
 * or at any time), a non-ancestor anchor is skipped, and a job that produced
 * no report is listed as such — never counted as passing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFER_DEADLINE_UTC_MINUTE,
  buildIssueBody,
  main,
  rangeText,
  readReports,
  resolveAnchor,
  summarizeReports,
  syncIssue,
  timingsFrom,
} from "../test-selection/nightly-report.mjs";

const ROOT = "/w/repo";
const B = "bbbbbbb";

const run = (over) => ({ id: 1, event: "schedule", head_branch: "develop", conclusion: "success", head_sha: "aaaaaaa", ...over });

describe("anchor resolution (X9)", () => {
  const ancestorOf = (set) => (sha) => set.has(sha);

  it("X9a: a green scheduled develop run whose SHA is an ancestor anchors A..B", () => {
    const a = resolveAnchor({ runs: [run({ head_sha: "aaaaaaa" })], headSha: B, isAncestor: ancestorOf(new Set(["aaaaaaa"])) });
    expect(a).toEqual({ kind: "range", a: "aaaaaaa", b: B });
    expect(rangeText(a)).toContain("aaaaaaa..bbbbbbb");
  });

  it("X9b: no green scheduled run → no green anchor", () => {
    const a = resolveAnchor({ runs: [run({ conclusion: "failure" })], headSha: B, isAncestor: () => true });
    expect(a.kind).toBe("none");
    expect(rangeText(a)).toMatch(/no green anchor/);
  });

  it("X9c: a green dispatch run (feature branch) never anchors", () => {
    const runs = [run({ event: "workflow_dispatch", head_branch: "os/feature", head_sha: "ccccccc" }), run({ event: "workflow_dispatch", head_sha: "ddddddd" })];
    const a = resolveAnchor({ runs, headSha: B, isAncestor: () => true });
    expect(a.kind).toBe("none");
    expect(rangeText(a)).toMatch(/no green anchor/);
  });

  it("X9d: the last green scheduled run is at B → no new commits", () => {
    const a = resolveAnchor({ runs: [run({ head_sha: B })], headSha: B, isAncestor: () => true });
    expect(a.kind).toBe("same");
    expect(rangeText(a)).toMatch(/no new commits/);
  });

  it("a non-ancestor anchor (history rewritten) is skipped for the next older one", () => {
    const runs = [run({ id: 3, head_sha: "rewritten" }), run({ id: 2, head_sha: "aaaaaaa" })];
    const a = resolveAnchor({ runs, headSha: B, isAncestor: ancestorOf(new Set(["aaaaaaa"])) });
    expect(a).toEqual({ kind: "range", a: "aaaaaaa", b: B });
  });

  it("the current run is never its own anchor", () => {
    const a = resolveAnchor({ runs: [run({ id: 99, head_sha: B })], headSha: B, currentRunId: 99, isAncestor: () => true });
    expect(a.kind).toBe("none");
  });
});

describe("report summary (X10)", () => {
  const rep = (files) => ({ testResults: files.map(([f, status]) => ({ name: `${ROOT}/${f}`, status, startTime: 0, endTime: 1500 })) });
  const expected = ["unit-1", "unit-2", "unit-3", "unit-4", "real-process", "ci-scenarios"];

  it("X10: an expected job with no report is listed as no report, never passing", () => {
    const s = summarizeReports({
      expected,
      reports: { "unit-1": rep([["a.test.ts", "passed"]]), "unit-2": rep([]), "unit-4": rep([]), "real-process": rep([]), "ci-scenarios": rep([]) },
      root: ROOT,
    });
    expect(s.noReport).toEqual(["unit-3"]);
    expect(s.red).toBe(true);
    expect(buildIssueBody({ summary: s, range: "x", runUrl: "u", sha: B })).toMatch(/unit-3.*no report/);
  });

  it("failing files are listed per job; an all-passing complete set is green", () => {
    const s = summarizeReports({
      expected: ["unit-1", "real-process"],
      reports: { "unit-1": rep([["a.test.ts", "failed"], ["b.test.ts", "passed"]]), "real-process": rep([["k.test.ts", "passed"]]) },
      root: ROOT,
    });
    expect(s.failing).toEqual([{ job: "unit-1", file: "a.test.ts" }]);
    expect(s.red).toBe(true);
    const green = summarizeReports({ expected: ["unit-1"], reports: { "unit-1": rep([["b.test.ts", "passed"]]) }, root: ROOT });
    expect(green.red).toBe(false);
    expect(buildIssueBody({ summary: green, range: "r", runUrl: "u", sha: B })).toMatch(/is green at/);
    expect(buildIssueBody({ summary: s, range: "r", runUrl: "u", sha: B })).toMatch(/is red at/);
  });

  it("review B2: a job that failed after writing an all-passing report is red", () => {
    const s = summarizeReports({
      expected: ["unit-1"],
      reports: { "unit-1": rep([["b.test.ts", "passed"]]) },
      root: ROOT,
      needs: { select: { result: "success" }, unit: { result: "failure" }, "real-process": { result: "success" } },
    });
    expect(s.red).toBe(true);
    expect(s.failedJobs).toEqual(["unit: failure"]);
    expect(buildIssueBody({ summary: s, range: "r", runUrl: "u", sha: B })).toContain("unit: failure");
  });

  it("all jobs successful and reports clean is green", () => {
    const s = summarizeReports({
      expected: ["unit-1"],
      reports: { "unit-1": rep([["b.test.ts", "passed"]]) },
      root: ROOT,
      needs: { select: { result: "success" }, unit: { result: "success" } },
    });
    expect(s.red).toBe(false);
  });

  it("review r2 B1: a truncated report artifact is 'no report' while the other jobs are still read", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nightly-reports-"));
    fs.mkdirSync(path.join(dir, "vitest-report-unit-1"));
    fs.writeFileSync(path.join(dir, "vitest-report-unit-1", "vitest.json"), '{"testResults": [');
    fs.mkdirSync(path.join(dir, "vitest-report-unit-2"));
    fs.writeFileSync(path.join(dir, "vitest-report-unit-2", "vitest.json"), JSON.stringify(rep([["x.test.ts", "failed"]])));
    const reports = readReports(dir, ["unit-1", "unit-2"]);
    expect(reports["unit-1"]).toBeNull();
    const s = summarizeReports({ expected: ["unit-1", "unit-2"], reports, root: ROOT });
    expect(s.noReport).toEqual(["unit-1"]);
    expect(s.failing).toEqual([{ job: "unit-2", file: "x.test.ts" }]);
    expect(s.red).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("emits refreshed timings from every report", () => {
    const t = timingsFrom({ "unit-1": rep([["a.test.ts", "passed"]]), "unit-2": null }, ROOT);
    expect(t).toEqual({ "a.test.ts": 1.5 });
  });

  it("skips a result without finite timestamps (the timing map stays numeric)", () => {
    const broken = { testResults: [{ name: `${ROOT}/b.test.ts`, status: "passed" }, { name: `${ROOT}/c.test.ts`, status: "passed", startTime: 0, endTime: 2000 }] };
    expect(timingsFrom({ "unit-1": broken }, ROOT)).toEqual({ "c.test.ts": 2 });
  });
});

describe("issue lifecycle (X11)", () => {
  function fakeApi(open = []) {
    const calls = [];
    const issues = [...open];
    return {
      calls,
      listOpen: async () => issues.filter((i) => i.state === "open"),
      create: async (title, body) => {
        const i = { number: 100 + issues.length, state: "open", title, body };
        issues.push(i);
        calls.push(["create", i.number]);
        return i;
      },
      update: async (n, body) => calls.push(["update", n, body]),
      comment: async (n, body) => calls.push(["comment", n, body]),
      close: async (n) => {
        issues.find((i) => i.number === n).state = "closed";
        calls.push(["close", n]);
      },
    };
  }

  it("X11a: none open + red → create", async () => {
    const api = fakeApi();
    await syncIssue({ api, red: true, body: "b", sha: B });
    expect(api.calls.map((c) => c[0])).toEqual(["create"]);
  });

  it("X11b: open + red → update the same issue, no second issue", async () => {
    const api = fakeApi([{ number: 7, state: "open" }]);
    await syncIssue({ api, red: true, body: "b2", sha: B });
    expect(api.calls.filter((c) => c[0] === "create")).toEqual([]);
    expect(api.calls.some((c) => c[0] === "update" && c[1] === 7)).toBe(true);
  });

  it("X11c: open + green → comment naming the green SHA, then close", async () => {
    const api = fakeApi([{ number: 7, state: "open" }]);
    await syncIssue({ api, red: false, body: "", sha: B });
    expect(api.calls[0][0]).toBe("comment");
    expect(api.calls[0][2]).toContain(B);
    expect(api.calls[1]).toEqual(["close", 7]);
  });

  it("none open + green → nothing", async () => {
    const api = fakeApi();
    await syncIssue({ api, red: false, body: "", sha: B });
    expect(api.calls).toEqual([]);
  });
});

// ── group 5.3 / 6.1 — reporter interface, attempt-aware main, watchdog ─────────
// (change: stabilize-blocking-test-lanes, design.md "Reporter interface" + D7;
// test-plan E61–E64, E67–E71, E73–E82, E84–E99, X5–X8). `main` takes the GitHub
// API client, the clock and the environment, so every scenario is a pure call.

const CWD = process.cwd();
const SERVER = "https://github.com";
const REPO = "o/r";
const RUN_ID = "555";
const RUN_URL = `${SERVER}/${REPO}/actions/runs/${RUN_ID}`;
const CREATED = "2026-11-22T03:00:00Z";
const at = (hhmm, day = "2026-11-22") => new Date(`${day}T${hhmm}:00Z`);
const ALL_JOBS = ["unit-1", "unit-2", "unit-3", "unit-4", "real-process", "ci-scenarios", "budget"];
const GREEN_NEEDS = Object.fromEntries(["select", "unit", "real-process", "ci-scenarios", "budget"].map((j) => [j, { result: "success" }]));

const asr = (title, status) => ({ fullName: title, title, status });
const res = (file, status, asserts = []) => ({ name: `${CWD}/${file}`, status, startTime: 0, endTime: 1000, assertionResults: asserts });
const PASS = (file = "ok.test.ts") => [res(file, "passed", [asr("fine", "passed")])];

/** Every expected job gets a clean report unless overridden; `null` = no artifact. */
function writeReports(dir, over = {}, jobs = ALL_JOBS) {
  for (const job of jobs) {
    const results = job in over ? over[job] : PASS(`${job}.test.ts`);
    if (results === null) continue;
    fs.mkdirSync(path.join(dir, `vitest-report-${job}`), { recursive: true });
    fs.writeFileSync(path.join(dir, `vitest-report-${job}`, "vitest.json"), JSON.stringify({ testResults: results }));
  }
}

class HttpError extends Error {}

function fakeGh({ open = [], runs = [], run = { created_at: CREATED }, workflows = {}, attempt1 = { event: "schedule", conclusion: "failure" }, scheduled = [], fail = {} } = {}) {
  const calls = [];
  const issues = open.map((i) => ({ state: "open", body: "", ...i }));
  const rec = (name, ...a) => calls.push([name, ...a]);
  const trip = (key, ...a) => {
    if (fail[key]) throw new HttpError(`${key} ${a.join(" ")}: HTTP ${fail[key]}`);
  };
  return {
    calls,
    issuesState: issues,
    runs: async () => (rec("runs"), runs),
    run: async (id) => (rec("run", String(id)), trip("run"), run),
    runAttempt: async (id, n) => (rec("runAttempt", String(id), n), trip("runAttempt"), attempt1),
    workflow: async (file) => {
      rec("workflow", file);
      if (fail.workflow?.[file]) throw new HttpError(`workflow ${file}: HTTP ${fail.workflow[file]}`);
      return { state: workflows[file] ?? "active" };
    },
    scheduledRuns: async () => (rec("scheduledRuns"), trip("scheduledRuns"), scheduled),
    issues: {
      listOpen: async () => (rec("listOpen"), issues.filter((i) => i.state === "open")),
      create: async (title, body) => {
        const i = { number: 100 + issues.length, state: "open", title, body };
        issues.push(i);
        rec("create", i.number);
        return i;
      },
      update: async (n, body) => {
        issues.find((i) => i.number === n).body = body;
        rec("update", n);
      },
      comment: async (n, body) => rec("comment", n, body),
      close: async (n) => {
        issues.find((i) => i.number === n).state = "closed";
        rec("close", n);
      },
    },
  };
}
const issueCalls = (api) => api.calls.filter(([c]) => ["create", "update", "comment", "close"].includes(c));

const tmpDirs = [];
const tmp = (prefix = "nightly-main-") => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Run `main` in report mode against a fresh reports dir. */
async function runReport({ results, jobs, needs = GREEN_NEEDS, event = "schedule", attempt, flags = ["--defer-first-attempt"], previous, api = fakeGh(), now = at("04:00"), extra = [] } = {}) {
  const dir = tmp();
  writeReports(dir, results, jobs);
  const summaryFile = path.join(tmp(), "summary.md");
  const env = {
    GITHUB_SHA: B,
    GITHUB_REPOSITORY: REPO,
    GITHUB_RUN_ID: RUN_ID,
    GITHUB_SERVER_URL: SERVER,
    GITHUB_EVENT_NAME: event,
    GITHUB_STEP_SUMMARY: summaryFile,
    NEEDS_JSON: JSON.stringify(needs),
    ...(attempt ? { GITHUB_RUN_ATTEMPT: String(attempt) } : {}),
  };
  const argv = ["--reports", dir, "--expected", (jobs ?? ALL_JOBS).join(","), ...flags, ...extra];
  let prevDir;
  if (previous !== undefined) {
    prevDir = tmp("nightly-prev-");
    if (previous !== null) fs.writeFileSync(path.join(prevDir, "attempt-1.json"), typeof previous === "string" ? previous : JSON.stringify(previous));
    argv.push("--previous", prevDir);
  }
  const out = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  const code = await main(argv, { api, now: () => now, env });
  const summary = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, "utf8") : "";
  const recordFile = path.join(dir, "attempt-1.json");
  const record = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, "utf8")) : null;
  return { code, api, dir, summary, stdout: out.join("\n"), record };
}

const FAIL_UNIT2 = { "unit-2": [res("a.test.ts", "failed", [asr("A one", "failed"), asr("A two", "passed")])] };
const prevRecord = (over = {}) => ({ deferred: true, failingTests: [], failedJobs: [], noReport: [], ...over });
const issueTitleCalls = (api) => issueCalls(api).map(([c]) => c);

describe("summarizeReports failingTests (6.1, X5)", () => {
  const rep = (...results) => ({ testResults: results });
  const base = (reports) => summarizeReports({ expected: Object.keys(reports), reports, root: CWD });

  it("lists every failed assertion with job, file and test name; passing ones are not listed", () => {
    const s = base({ "unit-2": rep(res("a.test.ts", "failed", [asr("A one", "failed"), asr("A two", "passed"), asr("A three", "failed")])) });
    expect(s.failingTests).toEqual([
      { job: "unit-2", file: "a.test.ts", test: "A one" },
      { job: "unit-2", file: "a.test.ts", test: "A three" },
    ]);
    expect(s.failing).toEqual([{ job: "unit-2", file: "a.test.ts" }]);
  });

  it("X5: a file that failed with no failed assertion (broken import) has test: null", () => {
    const s = base({ budget: rep(res("kb-search-perf.budget.test.ts", "failed", [])) });
    expect(s.failingTests).toEqual([{ job: "budget", file: "kb-search-perf.budget.test.ts", test: null }]);
  });

  it("a green report has no failingTests", () => {
    expect(base({ "unit-1": rep(...PASS("p.test.ts")) }).failingTests).toEqual([]);
  });
});

describe("DEFER_DEADLINE_UTC_MINUTE", () => {
  it("is 04:05 UTC (minute 245 of the UTC day)", () => {
    expect(DEFER_DEADLINE_UTC_MINUTE).toBe(245);
  });
});

describe("flag reader and usage error (E61–E63, 5.3)", () => {
  it("E61a/b: a missing --reports or --expected prints a usage line, exits 1, writes no timings.json and makes no fetch call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in a usage error"));
    const err = [];
    vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const flagsOf of [(d) => ["--expected", "unit-1"], (d) => ["--reports", d]]) {
      const dir = path.join(tmp(), "reports");
      const code = await main(flagsOf(dir), { env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: REPO } });
      expect(code).toBe(1);
      expect(fs.existsSync(path.join(dir, "timings.json"))).toBe(false);
    }
    expect(err.filter((l) => /^usage:/.test(l))).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("E61: the CLI itself prints a usage line and exits 1", () => {
    const script = fileURLToPath(new URL("../test-selection/nightly-report.mjs", import.meta.url));
    let status = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [script, "--expected", "unit-1"], { stdio: "pipe", env: { PATH: process.env.PATH } });
    } catch (e) {
      status = e.status;
      stderr = String(e.stderr);
    }
    expect(status).toBe(1);
    expect(stderr).toMatch(/usage:/);
  });

  it("a value flag followed by another flag has no value (usage error)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["--reports", "--expected", "unit-1"], { env: {} })).toBe(1);
  });

  it("E62: an unknown flag changes no output, file, API call or exit code", async () => {
    const a = await runReport({ results: FAIL_UNIT2, flags: [] });
    const b = await runReport({ results: FAIL_UNIT2, flags: [], extra: ["--foo", "bar"] });
    expect(b.code).toBe(a.code);
    expect(b.stdout).toBe(a.stdout);
    expect(b.summary).toBe(a.summary);
    expect(b.api.calls).toEqual(a.api.calls);
    const files = (d) => fs.readdirSync(d).sort().map((f) => [f, fs.statSync(path.join(d, f)).isDirectory() ? "dir" : fs.readFileSync(path.join(d, f), "utf8")]);
    expect(files(b.dir)).toEqual(files(a.dir));
  });

  it("E63a: --watchdog needs neither --reports nor --expected", async () => {
    const api = fakeGh({ scheduled: [] });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await main(["--watchdog"], { api, now: () => at("08:47"), env: { GITHUB_REPOSITORY: REPO, GITHUB_SERVER_URL: SERVER } });
    expect(code).toBe(0);
    expect(err).not.toHaveBeenCalled();
    expect(api.calls.map(([c]) => c)).toContain("scheduledRuns");
  });

  it("E63b: --dry-run without --watchdog is ignored: report mode behaves as without it", async () => {
    const a = await runReport({ results: FAIL_UNIT2, flags: [] });
    const b = await runReport({ results: FAIL_UNIT2, flags: [], extra: ["--dry-run"] });
    expect(b.code).toBe(a.code);
    expect(b.stdout).toBe(a.stdout);
    expect(b.api.calls).toEqual(a.api.calls);
    expect(issueTitleCalls(b.api)).toEqual(["create"]);
  });
});

describe("no group-6 flag keeps today's behaviour (E64, E73)", () => {
  it("E64: GITHUB_RUN_ATTEMPT=2 without --defer-first-attempt: no record read or written, verdict from this attempt only", async () => {
    const previous = prevRecord({ failingTests: [{ job: "unit-2", file: "gone.test.ts", test: "X" }] });
    const r = await runReport({ results: FAIL_UNIT2, flags: [], attempt: 2, previous, api: fakeGh() });
    expect(r.record).toBeNull();
    expect(r.code).toBe(1);
    expect(r.stdout).not.toMatch(/Passed on rerun/);
    expect(r.api.calls.map(([c]) => c)).not.toContain("runAttempt");
    expect(issueTitleCalls(r.api)).toEqual(["create"]);
    const green = await runReport({ flags: [], attempt: 2, previous: null });
    expect(green.code).toBe(0);
  });

  it("E73: attempt 1, scheduled, red, no --defer-first-attempt: no attempt-1.json, issue synced as today", async () => {
    const r = await runReport({ results: FAIL_UNIT2, flags: [], attempt: 1 });
    expect(r.record).toBeNull();
    expect(r.code).toBe(1);
    expect(issueTitleCalls(r.api)).toEqual(["create"]);
    expect(r.api.calls.map(([c]) => c)).not.toContain("workflow");
  });
});

describe("attempt 1 with --defer-first-attempt (E67–E71, E74, X8)", () => {
  it("E67: red scheduled attempt at 04:05 with both workflows active defers: record written, no issue call, exit 1", async () => {
    const r = await runReport({ results: { ...FAIL_UNIT2, "unit-4": null }, needs: { ...GREEN_NEEDS, unit: { result: "failure" } }, attempt: 1, now: at("04:05") });
    expect(r.code).toBe(1);
    expect(issueCalls(r.api)).toEqual([]);
    expect(r.api.calls).toContainEqual(["workflow", "nightly-tests-rerun.yml"]);
    expect(r.api.calls).toContainEqual(["workflow", "nightly-tests-watchdog.yml"]);
    expect(r.record).toEqual({
      deferred: true,
      failingTests: [{ job: "unit-2", file: "a.test.ts", test: "A one" }],
      failedJobs: ["unit: failure"],
      noReport: ["unit-4"],
    });
    expect(r.summary).toMatch(/deferred to (the )?rerun/i);
    expect(r.summary).toContain("a.test.ts");
  });

  it("E68: the deadline is inclusive at minute 245: 04:04 defers, 04:06 does not", async () => {
    const early = await runReport({ results: FAIL_UNIT2, attempt: 1, now: at("04:04") });
    expect(early.record.deferred).toBe(true);
    expect(issueCalls(early.api)).toEqual([]);
    const late = await runReport({ results: FAIL_UNIT2, attempt: 1, now: at("04:06") });
    expect(late.record.deferred).toBe(false);
    expect(issueTitleCalls(late.api)).toEqual(["create"]);
    expect(late.code).toBe(1);
  });

  it("a reporter a few seconds past 04:05 does not defer", async () => {
    const r = await runReport({ results: FAIL_UNIT2, attempt: 1, now: new Date("2026-11-22T04:05:30Z") });
    expect(r.record.deferred).toBe(false);
  });

  it("E69: a green attempt writes deferred: false, comments the green SHA and closes the open issue; exit 0", async () => {
    const api = fakeGh({ open: [{ number: 7 }] });
    const r = await runReport({ attempt: 1, now: at("04:05"), api });
    expect(r.code).toBe(0);
    expect(r.record.deferred).toBe(false);
    const comment = api.calls.find(([c]) => c === "comment");
    expect(comment[2]).toContain(B);
    expect(api.calls).toContainEqual(["close", 7]);
  });

  it("E70: a dispatch run never defers and never touches the issue API; exit 1", async () => {
    const r = await runReport({ results: FAIL_UNIT2, event: "workflow_dispatch", attempt: 1, now: at("04:05") });
    expect(r.record.deferred).toBe(false);
    expect(issueCalls(r.api)).toEqual([]);
    expect(r.code).toBe(1);
  });

  it("E71: an inactive rerun workflow (disabled_manually) means no deferral: issue created", async () => {
    const api = fakeGh({ workflows: { "nightly-tests-rerun.yml": "disabled_manually" } });
    const r = await runReport({ results: FAIL_UNIT2, attempt: 1, now: at("04:00"), api });
    expect(r.record.deferred).toBe(false);
    expect(issueTitleCalls(api)).toEqual(["create"]);
  });

  it("an inactive watchdog workflow also means no deferral", async () => {
    const api = fakeGh({ workflows: { "nightly-tests-watchdog.yml": "disabled_inactivity" } });
    const r = await runReport({ results: FAIL_UNIT2, attempt: 1, now: at("04:00"), api });
    expect(r.record.deferred).toBe(false);
  });

  it("E74: a reporter at 00:30 UTC the next day is past 04:05 of the run's creation date: no deferral", async () => {
    const r = await runReport({ results: FAIL_UNIT2, attempt: 1, now: at("00:30", "2026-11-23") });
    expect(r.record.deferred).toBe(false);
    expect(issueTitleCalls(r.api)).toEqual(["create"]);
    expect(r.code).toBe(1);
  });

  it("an HTTP error reading the run means no deferral", async () => {
    const r = await runReport({ results: FAIL_UNIT2, attempt: 1, api: fakeGh({ fail: { run: 500 } }) });
    expect(r.record.deferred).toBe(false);
    expect(issueTitleCalls(r.api)).toEqual(["create"]);
  });

  it.each([404, 500])("X8: a %i answer for the watchdog workflow counts as not active: deferred false, issue created", async (status) => {
    const api = fakeGh({ fail: { workflow: { "nightly-tests-watchdog.yml": status } } });
    const r = await runReport({ results: FAIL_UNIT2, attempt: 1, now: at("04:00"), api });
    expect(r.record.deferred).toBe(false);
    expect(issueTitleCalls(api)).toEqual(["create"]);
    expect(r.code).toBe(1);
  });

  it("the missing GITHUB_RUN_ATTEMPT is attempt 1", async () => {
    const r = await runReport({ results: FAIL_UNIT2, now: at("04:00") });
    expect(r.record?.deferred).toBe(true);
  });
});

describe("attempt >= 2 with --previous (E75–E79, E85–E89, X5)", () => {
  const prevTests = (...t) => prevRecord({ failingTests: t });

  it("E75: attempt 2 green: lists the flaky test in the summary, comments it and closes the open issue", async () => {
    const api = fakeGh({ open: [{ number: 7 }] });
    const previous = prevTests({ job: "budget", file: "packages/server/src/__tests__/kb-search-perf.budget.test.ts", test: "P1" });
    const r = await runReport({ attempt: 2, previous, api });
    expect(r.code).toBe(0);
    expect(r.summary).toMatch(/Passed on rerun \(flaky\)/);
    expect(r.summary).toContain("kb-search-perf.budget.test.ts");
    expect(r.summary).toContain("P1");
    const comment = api.calls.find(([c]) => c === "comment");
    expect(comment[2]).toContain("kb-search-perf.budget.test.ts");
    expect(api.calls).toContainEqual(["close", 7]);
    expect(api.calls.map(([c]) => c)).not.toContain("create");
  });

  it("E76: X fails again, Y passes: X under failing tests, Y only under Passed on rerun", async () => {
    const api = fakeGh({ open: [{ number: 7 }] });
    const previous = prevTests({ job: "unit-2", file: "x.test.ts", test: "X1" }, { job: "unit-3", file: "y.test.ts", test: "Y1" });
    const r = await runReport({ attempt: 2, previous, api, results: { "unit-2": [res("x.test.ts", "failed", [asr("X1", "failed")])] } });
    expect(r.code).toBe(1);
    const body = api.issuesState[0].body;
    const [failingPart, flakyPart] = body.split("### Passed on rerun (flaky)");
    expect(failingPart).toContain("x.test.ts");
    expect(failingPart).not.toContain("y.test.ts");
    expect(flakyPart).toContain("y.test.ts");
    expect(flakyPart).not.toContain("x.test.ts");
  });

  it("E77: a hung job (previous failedJobs + noReport) that now succeeds with a report is listed in jobsPassedOnRerun with its attempt-1 result", async () => {
    const previous = prevRecord({ failedJobs: ["real-process: cancelled"], noReport: ["real-process"] });
    const r = await runReport({ attempt: 2, previous });
    expect(r.code).toBe(0);
    expect(r.summary).toMatch(/Passed on rerun \(flaky\)/);
    expect(r.summary).toMatch(/real-process.*cancelled/);
  });

  it("E77b: a previous failedJobs entry without a result suffix is still matched", async () => {
    const r = await runReport({ attempt: 2, previous: prevRecord({ failedJobs: ["real-process"], noReport: ["real-process"] }) });
    expect(r.summary).toMatch(/real-process/);
    expect(r.code).toBe(0);
  });

  it("E77c: a sharded job (needs key `unit`) that failed on attempt 1 and now has all four shard reports passes on rerun", async () => {
    const r = await runReport({ attempt: 2, previous: prevRecord({ failedJobs: ["unit: failure"] }) });
    expect(r.summary).toMatch(/unit.*failure/);
    expect(r.code).toBe(0);
  });

  it("E78: a job that succeeded but still has no report is not in jobsPassedOnRerun; the run is red", async () => {
    const api = fakeGh();
    const r = await runReport({ attempt: 2, previous: prevRecord({ noReport: ["unit-4"] }), results: { "unit-4": null }, api });
    expect(r.code).toBe(1);
    expect(api.issuesState[0].body).not.toMatch(/Passed on rerun/);
    expect(api.issuesState[0].body).toMatch(/unit-4: no report/);
  });

  it("E79: a manual re-run (record deferred: false) judges on its own verdict, still showing the lists", async () => {
    const previous = prevRecord({ deferred: false, failingTests: [{ job: "unit-2", file: "a.test.ts", test: "A one" }] });
    const r = await runReport({ attempt: 2, previous });
    expect(r.code).toBe(0);
    expect(r.summary).toMatch(/Passed on rerun \(flaky\)/);
    expect(r.summary).toContain("a.test.ts");
  });

  it("E79b: a manual re-run that is red carries the lists in the issue body", async () => {
    const api = fakeGh();
    const previous = prevRecord({ deferred: false, failingTests: [{ job: "unit-3", file: "y.test.ts", test: "Y1" }] });
    const r = await runReport({ attempt: 2, previous, api, results: FAIL_UNIT2 });
    expect(r.code).toBe(1);
    expect(api.issuesState[0].body).toMatch(/Passed on rerun \(flaky\)[\s\S]*y\.test\.ts/);
  });

  it("E85: a previous test: null entry (import error) whose file now passes is listed with no test name", async () => {
    const previous = prevTests({ job: "unit-1", file: "f.test.ts", test: null });
    const r = await runReport({ attempt: 2, previous, results: { "unit-1": PASS("f.test.ts") } });
    expect(r.code).toBe(0);
    expect(r.summary).toContain("f.test.ts");
    expect(r.summary).not.toMatch(/null|undefined/);
  });

  it("a previous test: null entry whose file now fails a named test is still failing, not passed on rerun", async () => {
    const previous = prevTests({ job: "unit-1", file: "f.test.ts", test: null });
    const api = fakeGh();
    const r = await runReport({ attempt: 2, previous, api, results: { "unit-1": [res("f.test.ts", "failed", [asr("now a named failure", "failed")])] } });
    expect(r.code).toBe(1);
    expect(api.issuesState[0].body).not.toMatch(/Passed on rerun/);
  });

  it("a previous failure whose job has no report now is not passed on rerun", async () => {
    const previous = prevTests({ job: "unit-1", file: "f.test.ts", test: "T" });
    const r = await runReport({ attempt: 2, previous, results: { "unit-1": null } });
    expect(r.code).toBe(1);
    expect(r.summary).not.toMatch(/Passed on rerun/);
  });

  it("E86: a real-process test that failed both in-job tries and passes on rerun is under Passed on rerun; no issue; green", async () => {
    const previous = prevTests({ job: "real-process", file: "real.test.ts", test: "T" });
    const api = fakeGh();
    const r = await runReport({ attempt: 2, previous, api, results: { "real-process": [res("real.test.ts", "passed", [asr("T", "passed")])] } });
    expect(r.code).toBe(0);
    expect(r.summary).toMatch(/Passed on rerun[\s\S]*real\.test\.ts/);
    expect(issueCalls(api)).toEqual([]);
  });

  it("E87: attempt 2 red with one open issue updates that issue; the open count stays 1", async () => {
    const api = fakeGh({ open: [{ number: 7 }] });
    await runReport({ attempt: 2, previous: prevRecord(), api, results: FAIL_UNIT2 });
    expect(issueTitleCalls(api)).toContain("update");
    expect(issueTitleCalls(api)).not.toContain("create");
    expect(api.issuesState.filter((i) => i.state === "open")).toHaveLength(1);
  });

  it("E88: attempt 2 red with no earlier green scheduled run: the issue says no green anchor, names the files and the run URL", async () => {
    const api = fakeGh({ runs: [] });
    await runReport({ attempt: 2, previous: prevRecord(), api, results: FAIL_UNIT2 });
    const body = api.issuesState[0].body;
    expect(body).toMatch(/no green anchor/);
    expect(body).toContain("a.test.ts");
    expect(body).toContain(RUN_URL);
  });

  it("E89: the range anchors on the older green scheduled run, never the newer green dispatch run", async () => {
    const runs = [
      { id: 90, event: "workflow_dispatch", head_branch: "os/feature", conclusion: "success", head_sha: "ddddddd" },
      { id: 80, event: "schedule", head_branch: "develop", conclusion: "success", head_sha: "aaaaaaa" },
    ];
    // is-ancestor runs against the real git repo: use a SHA that is an ancestor of HEAD
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const root = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], { encoding: "utf8" }).trim().split("\n")[0];
    runs[1].head_sha = root;
    const api = fakeGh({ runs });
    const dir = tmp();
    writeReports(dir, FAIL_UNIT2);
    const out = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    const env = { GITHUB_SHA: head, GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: RUN_ID, GITHUB_SERVER_URL: SERVER, GITHUB_EVENT_NAME: "schedule", GITHUB_RUN_ATTEMPT: "2", NEEDS_JSON: JSON.stringify(GREEN_NEEDS) };
    const prev = tmp();
    fs.writeFileSync(path.join(prev, "attempt-1.json"), JSON.stringify(prevRecord()));
    const code = await main(["--reports", dir, "--expected", ALL_JOBS.join(","), "--defer-first-attempt", "--previous", prev], { api, now: () => at("06:00"), env });
    expect(code).toBe(1);
    const body = api.issuesState[0].body;
    expect(body).toContain(`${root}..${head}`);
    expect(body).not.toContain("ddddddd");
  });

  it("X5: a broken-import budget file is named by the issue after attempt 2 (test: null in the record)", async () => {
    const broken = { budget: [res("kb-search-perf.budget.test.ts", "failed", [])] };
    const a1 = await runReport({ results: broken, attempt: 1, now: at("04:00") });
    expect(a1.record.failingTests).toEqual([{ job: "budget", file: "kb-search-perf.budget.test.ts", test: null }]);
    const api = fakeGh();
    await runReport({ results: broken, attempt: 2, previous: a1.record, api });
    expect(api.issuesState[0].body).toContain("kb-search-perf.budget.test.ts");
    expect(api.issuesState[0].body).not.toMatch(/Passed on rerun/);
  });
});

describe("attempt >= 2 without a usable record (E80–E82, E84, X6)", () => {
  const UNAVAILABLE_RED = "first-attempt record unavailable — passed-on-rerun not computed";

  it("E80: no record, attempt 1 was a dispatch run: judged on its own verdict, summary explains", async () => {
    const api = fakeGh({ attempt1: { event: "workflow_dispatch", conclusion: "failure" } });
    const r = await runReport({ attempt: 2, previous: null, api });
    expect(r.code).toBe(0);
    expect(r.summary).toContain("first-attempt record unavailable; attempt 1 did not defer (workflow_dispatch, failure)");
    expect(api.calls).toContainEqual(["runAttempt", RUN_ID, 1]);
  });

  it("E81: no record, attempt 1 was a green scheduled run: green on its own verdict", async () => {
    const api = fakeGh({ attempt1: { event: "schedule", conclusion: "success" } });
    const r = await runReport({ attempt: 2, previous: null, api });
    expect(r.code).toBe(0);
    expect(r.summary).toContain("attempt 1 did not defer (schedule, success)");
  });

  it("E80b: a did-not-defer attempt 1 with a red attempt 2 reports red on its own, issue without the unavailable note", async () => {
    const api = fakeGh({ attempt1: { event: "workflow_dispatch", conclusion: "failure" } });
    const r = await runReport({ attempt: 2, previous: null, api, results: FAIL_UNIT2 });
    expect(r.code).toBe(1);
    expect(api.issuesState[0].body).not.toContain(UNAVAILABLE_RED);
  });

  it("E82: a truncated record on a scheduled failed attempt 1 is fail-closed: red even when attempt 2 is green", async () => {
    const api = fakeGh({ attempt1: { event: "schedule", conclusion: "failure" } });
    const r = await runReport({ attempt: 2, previous: '{"deferred": tr', api });
    expect(r.code).toBe(1);
    expect(r.summary).toContain(UNAVAILABLE_RED);
    expect(api.issuesState[0].body).toContain(UNAVAILABLE_RED);
  });

  it("a record that is valid JSON but has no boolean `deferred` counts as unparsable", async () => {
    const r = await runReport({ attempt: 2, previous: { failingTests: [] }, api: fakeGh({ attempt1: { event: "schedule", conclusion: "failure" } }) });
    expect(r.code).toBe(1);
  });

  it("E84: --defer-first-attempt on attempt 2 without --previous is treated as a missing record", async () => {
    const red = await runReport({ attempt: 2, api: fakeGh({ attempt1: { event: "schedule", conclusion: "failure" } }) });
    expect(red.code).toBe(1);
    expect(red.summary).toContain(UNAVAILABLE_RED);
    const ok = await runReport({ attempt: 2, api: fakeGh({ attempt1: { event: "workflow_dispatch", conclusion: "failure" } }) });
    expect(ok.code).toBe(0);
  });

  it("X6: no record and GET attempts/1 fails with HTTP 500: red with the unavailable note", async () => {
    const api = fakeGh({ fail: { runAttempt: 500 } });
    const r = await runReport({ attempt: 2, previous: null, api });
    expect(r.code).toBe(1);
    expect(api.issuesState[0].body).toContain(UNAVAILABLE_RED);
  });

  it("a manual attempt 2 of a dispatch run never touches the issue API even when forced red", async () => {
    const api = fakeGh({ fail: { runAttempt: 500 } });
    const r = await runReport({ attempt: 2, previous: null, api, event: "workflow_dispatch" });
    expect(r.code).toBe(1);
    expect(issueCalls(api)).toEqual([]);
  });
});

describe("buildIssueBody / syncIssue passed-on-rerun (6.1)", () => {
  const green = { failing: [], noReport: [], failedJobs: [], red: false };

  it("adds a `### Passed on rerun (flaky)` section with both lists only when one is non-empty", () => {
    const plain = buildIssueBody({ summary: green, range: "r", runUrl: "u", sha: B });
    expect(plain).not.toMatch(/Passed on rerun/);
    const body = buildIssueBody({
      summary: { ...green, passedOnRerun: [{ job: "unit-2", file: "a.test.ts", test: "A" }], jobsPassedOnRerun: [{ job: "real-process", attempt1: "cancelled" }] },
      range: "r",
      runUrl: "u",
      sha: B,
    });
    expect(body).toMatch(/### Passed on rerun \(flaky\)/);
    expect(body).toContain("a.test.ts");
    expect(body).toMatch(/real-process.*cancelled/);
  });

  it("the green close comment lists both lists", async () => {
    const api = fakeGh({ open: [{ number: 7 }] }).issues;
    const calls = [];
    await syncIssue({
      api: { ...api, comment: async (n, b) => calls.push(b) },
      red: false,
      body: "",
      sha: B,
      passedOnRerun: [{ job: "unit-2", file: "a.test.ts", test: "A" }],
      jobsPassedOnRerun: [{ job: "real-process", attempt1: "cancelled" }],
    });
    expect(calls[0]).toContain(B);
    expect(calls[0]).toContain("a.test.ts");
    expect(calls[0]).toContain("real-process");
  });
});

describe("--watchdog (E90–E99, X7)", () => {
  const NOW = at("08:47");
  const ago = (h, m = 0) => new Date(NOW.getTime() - (h * 60 + m) * 60000).toISOString();
  const wrun = (over = {}) => ({ id: 555, event: "schedule", head_branch: "develop", status: "completed", conclusion: "failure", run_attempt: 1, head_sha: B, created_at: ago(4, 47), run_started_at: ago(4, 47), ...over });
  const ENV = { GITHUB_REPOSITORY: REPO, GITHUB_SERVER_URL: SERVER, GITHUB_TOKEN: "t" };
  async function runWatchdog(api, extra = []) {
    const out = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    const code = await main(["--watchdog", ...extra], { api, now: () => NOW, env: ENV });
    return { code, out: out.join("\n") };
  }

  it("E90: red latest scheduled run, no open issue: issue created with URL, attempt, status, conclusion and reason; exit 1", async () => {
    const api = fakeGh({ scheduled: [wrun({ run_attempt: 2 })] });
    const r = await runWatchdog(api);
    expect(r.code).toBe(1);
    expect(issueTitleCalls(api)).toEqual(["create"]);
    const body = api.issuesState[0].body;
    expect(body).toContain(RUN_URL);
    expect(body).toMatch(/attempt:? `?2/i);
    expect(body).toMatch(/status:? `?completed/i);
    expect(body).toMatch(/conclusion:? `?failure/i);
    expect(body).toContain("rerun not performed or not reported");
  });

  it("E91: a successful latest run: exit 0, no issue write", async () => {
    const api = fakeGh({ scheduled: [wrun({ conclusion: "success" })] });
    const r = await runWatchdog(api);
    expect(r.code).toBe(0);
    expect(issueCalls(api)).toEqual([]);
  });

  it("E92: an open issue already naming the run URL: exit 0, no issue write", async () => {
    const api = fakeGh({ scheduled: [wrun()], open: [{ number: 7, body: `Nightly red. Run: ${RUN_URL}\n` }] });
    const r = await runWatchdog(api);
    expect(r.code).toBe(0);
    expect(issueCalls(api)).toEqual([]);
  });

  it("E92b: an open issue naming a run whose id merely starts with this id does not count", async () => {
    const api = fakeGh({ scheduled: [wrun()], open: [{ number: 7, body: `Run: ${RUN_URL}9` }] });
    const r = await runWatchdog(api);
    expect(r.code).toBe(1);
    expect(issueTitleCalls(api)).toContain("update");
  });

  it("E93: the open issue names an older run URL: the same issue is updated, no second issue; exit 1", async () => {
    const api = fakeGh({ scheduled: [wrun()], open: [{ number: 7, body: `Run: ${SERVER}/${REPO}/actions/runs/444` }] });
    const r = await runWatchdog(api);
    expect(r.code).toBe(1);
    expect(issueTitleCalls(api)).toContain("update");
    expect(issueTitleCalls(api)).not.toContain("create");
    expect(api.issuesState[0].body).toContain(RUN_URL);
  });

  it("E94: only a closed issue names the URL: treated as unreported, issue created", async () => {
    const api = fakeGh({ scheduled: [wrun()], open: [{ number: 7, state: "closed", body: RUN_URL }] });
    const r = await runWatchdog(api);
    expect(r.code).toBe(1);
    expect(issueTitleCalls(api)).toEqual(["create"]);
  });

  it("E95: 23 h 59 min old reports (exit 1); 24 h 01 min old exits 0", async () => {
    const fresh = fakeGh({ scheduled: [wrun({ created_at: ago(23, 59), run_started_at: ago(23, 59) })] });
    expect((await runWatchdog(fresh)).code).toBe(1);
    const stale = fakeGh({ scheduled: [wrun({ created_at: ago(24, 1), run_started_at: ago(24, 1) })] });
    expect((await runWatchdog(stale)).code).toBe(0);
    expect(issueCalls(stale)).toEqual([]);
  });

  it("E96: an in-progress run is reported by the watchdog; attempt 2 later comments and closes that issue", async () => {
    const api = fakeGh({ scheduled: [wrun({ status: "in_progress", conclusion: null })] });
    expect((await runWatchdog(api)).code).toBe(1);
    expect(api.issuesState[0].state).toBe("open");
    const r = await runReport({ attempt: 2, previous: prevRecord(), api });
    expect(r.code).toBe(0);
    expect(api.calls).toContainEqual(["close", api.issuesState[0].number]);
    expect(api.issuesState[0].state).toBe("closed");
  });

  it("E97: a cancelled latest run, no issue: issue created; exit 1", async () => {
    const api = fakeGh({ scheduled: [wrun({ conclusion: "cancelled" })] });
    expect((await runWatchdog(api)).code).toBe(1);
    expect(issueTitleCalls(api)).toEqual(["create"]);
  });

  it("E98: --dry-run prints the decision, writes nothing and returns the same exit code", async () => {
    const api = fakeGh({ scheduled: [wrun()] });
    const r = await runWatchdog(api, ["--dry-run"]);
    expect(r.code).toBe(1);
    expect(issueCalls(api)).toEqual([]);
    expect(r.out).toContain(RUN_URL);
    expect(r.out).toContain("rerun not performed or not reported");
  });

  it("--dry-run of a nothing-to-report night prints that and exits 0", async () => {
    const r = await runWatchdog(fakeGh({ scheduled: [wrun({ conclusion: "success" })] }), ["--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/nothing to report/i);
  });

  it("E99: only schedule runs on develop are judged: a red newer dispatch run is skipped for the green schedule run", async () => {
    const api = fakeGh({
      scheduled: [wrun({ id: 600, event: "workflow_dispatch", conclusion: "failure" }), wrun({ id: 590, head_branch: "os/x", conclusion: "failure" }), wrun({ id: 580, conclusion: "success" })],
    });
    const r = await runWatchdog(api);
    expect(r.code).toBe(0);
    expect(issueCalls(api)).toEqual([]);
  });

  it("no scheduled run at all: nothing to report, exit 0", async () => {
    expect((await runWatchdog(fakeGh({ scheduled: [] }))).code).toBe(0);
  });

  it("X7: a 502 listing the runs rejects (the entry point exits 1) and writes no issue", async () => {
    const api = fakeGh({ fail: { scheduledRuns: 502 } });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(main(["--watchdog"], { api, now: () => NOW, env: ENV })).rejects.toThrow(/502/);
    expect(issueCalls(api)).toEqual([]);
  });
});
