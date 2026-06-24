/**
 * Run-store tests: result capture, auto-archive empty, retention prune.
 * See change: add-automation-plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startRun, finishRun, listRuns, pruneRuns, makeRunId, countFindings } from "../server/run-store.js";

let base: string;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "auto-runs-"));
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("run-store", () => {
  it("starts a running record then captures result.md on finish", () => {
    const rec = startRun(base, "nightly", { runId: "2026-06-19-nightly", sessionId: "sess1" });
    expect(rec.status).toBe("running");
    expect(rec.sessionId).toBe("sess1");

    const done = finishRun(base, "2026-06-19-nightly", { status: "done", result: "Found 2 bugs" });
    expect(done?.status).toBe("done");
    expect(done?.archived).toBeUndefined();
    const md = fs.readFileSync(path.join(rec.dir, "result.md"), "utf-8");
    expect(md).toContain("Found 2 bugs");
  });

  it("auto-archives a run with empty findings", () => {
    startRun(base, "nightly", { runId: "2026-06-19-nightly" });
    const done = finishRun(base, "2026-06-19-nightly", { status: "done", result: "   " });
    expect(done?.archived).toBe(true);
    expect(done?.findings).toBe(0);
  });

  it("counts top-level bullet lines as findings on finish", () => {
    startRun(base, "nightly", { runId: "2026-06-19-nightly" });
    const done = finishRun(base, "2026-06-19-nightly", {
      status: "done",
      result: "Summary\n- bug one\n- bug two\n  - nested (ignored)\n* bug three",
    });
    expect(done?.findings).toBe(3);
    expect(done?.archived).toBeUndefined();
  });

  it("countFindings: top-level bullets only, 0 when empty", () => {
    expect(countFindings("")).toBe(0);
    expect(countFindings("- a\n* b\n   - nested\nprose")).toBe(2);
  });

  it("records an error status + message", () => {
    startRun(base, "nightly", { runId: "2026-06-19-nightly" });
    const rec = finishRun(base, "2026-06-19-nightly", { status: "error", error: "role @gone unresolved" });
    expect(rec?.status).toBe("error");
    expect(rec?.error).toContain("@gone");
  });

  it("prunes oldest-first beyond retention (101st run trims to 100)", () => {
    const retention = 100;
    for (let i = 0; i < 100; i++) {
      const d = new Date(2026, 0, 1 + i);
      const runId = makeRunId("nightly", d);
      startRun(base, "nightly", { runId, at: d });
      finishRun(base, runId, { status: "done", result: `run ${i}`, retention, at: d });
    }
    expect(listRuns(base, "nightly")).toHaveLength(100);

    // 101st run
    const d101 = new Date(2026, 5, 1);
    const runId = makeRunId("nightly", d101);
    startRun(base, "nightly", { runId, at: d101 });
    finishRun(base, runId, { status: "done", result: "run 100", retention, at: d101 });

    const after = listRuns(base, "nightly");
    expect(after).toHaveLength(100);
    // oldest (Jan 1) pruned; newest (Jun 1) retained
    expect(after[after.length - 1]!.runId).toBe(runId);
    expect(after.find((r) => r.runId === makeRunId("nightly", new Date(2026, 0, 1)))).toBeUndefined();
  });

  it("scopes retention per automation", () => {
    startRun(base, "a", { runId: "2026-01-01-a", at: new Date(2026, 0, 1) });
    finishRun(base, "2026-01-01-a", { status: "done", result: "x" });
    startRun(base, "b", { runId: "2026-01-01-b", at: new Date(2026, 0, 1) });
    finishRun(base, "2026-01-01-b", { status: "done", result: "y" });
    expect(pruneRuns(base, "a", 100)).toBe(0);
    expect(listRuns(base).length).toBe(2);
  });
});
