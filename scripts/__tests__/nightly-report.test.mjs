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
import { describe, expect, it } from "vitest";

import {
  buildIssueBody,
  rangeText,
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

  it("emits refreshed timings from every report", () => {
    const t = timingsFrom({ "unit-1": rep([["a.test.ts", "passed"]]), "unit-2": null }, ROOT);
    expect(t).toEqual({ "a.test.ts": 1.5 });
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
