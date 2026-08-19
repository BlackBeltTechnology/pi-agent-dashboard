/**
 * Run-store tests: result capture, auto-archive empty, retention prune.
 * See change: add-automation-plugin.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countFindings,
  finishParentRun,
  finishRun,
  isSafeRunId,
  listRuns,
  listStaleRunningRuns,
  makeRunId,
  pruneRuns,
  readChildRuns,
  resolveRunDir,
  startChildRun,
  startParentRun,
  startRun,
} from "../server/run-store.js";

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

// See change: add-automation-concurrent-spawn.
describe("run-store — parent/child layout", () => {
  it("E16: writes a parent record with 3 child records carrying their own fields", () => {
    const parent = startParentRun(base, "nightly");
    const labels = ["flows.run:a", "core.skill:b", "flows.run:c"];
    const childIds = labels.map((label, i) =>
      startChildRun(base, parent.runId, "nightly", { sessionId: `sess-${i}`, actionLabel: label }).runId,
    );
    const reloaded = listRuns(base, "nightly").find((r) => r.runId === parent.runId)!;
    expect(reloaded.children).toHaveLength(3);
    const kids = readChildRuns(base, reloaded);
    expect(kids).toHaveLength(3);
    kids.forEach((c, i) => {
      expect(c.status).toBe("running");
      expect(c.sessionId).toBe(`sess-${i}`);
      expect(c.actionLabel).toBe(labels[i]);
      expect(typeof c.startedAt).toBe("number");
      expect(c.parentRunId).toBe(parent.runId);
    });
    expect(childIds).toEqual(reloaded.children);
  });

  it("E22: a child is addressable + finalizable by its own run id", () => {
    const parent = startParentRun(base, "nightly");
    const child = startChildRun(base, parent.runId, "nightly", { actionLabel: "flows.run" });
    const dir = resolveRunDir(base, child.runId);
    expect(dir).toBe(child.dir);
    const done = finishRun(base, child.runId, { status: "done", result: "- found one" });
    expect(done?.status).toBe("done");
    expect(fs.readFileSync(path.join(child.dir, "result.md"), "utf-8")).toContain("found one");
  });

  it("E23: legacy flat records stay listed + resolvable, treated as flat", () => {
    const flat = startRun(base, "old", { runId: "2026-01-01-old" });
    expect(resolveRunDir(base, flat.runId)).toBe(flat.dir);
    const rec = listRuns(base, "old").find((r) => r.runId === flat.runId)!;
    expect(rec.children).toBeUndefined();
  });

  it("X14: retention spares a live (running) occurrence and its children", () => {
    const liveParent = startParentRun(base, "nightly");
    const child = startChildRun(base, liveParent.runId, "nightly", { actionLabel: "flows.run" });
    // 101 terminal parent occurrences of the same automation.
    for (let i = 0; i < 101; i++) {
      const p = startParentRun(base, "nightly");
      finishParentRun(base, p.runId, { status: "done", findings: 0, retention: 100 });
    }
    pruneRuns(base, "nightly", 100);
    expect(resolveRunDir(base, liveParent.runId)).not.toBeNull();
    expect(resolveRunDir(base, child.runId)).not.toBeNull();
  });

  it("rejects a path-traversal runId (no fs walk, returns null)", () => {
    startParentRun(base, "nightly");
    for (const bad of ["../escape", "..", "a/b", "a\\b", "../../etc/passwd"]) {
      expect(isSafeRunId(bad)).toBe(false);
      expect(resolveRunDir(base, bad)).toBeNull();
    }
    expect(isSafeRunId("2026-06-19-nightly-00001")).toBe(true);
  });

  it("X15: the stale sweep enumerates nested children", () => {
    const parent = startParentRun(base, "nightly");
    const child = startChildRun(base, parent.runId, "nightly", {
      actionLabel: "flows.run",
      at: new Date(Date.now() - 10_000),
    });
    const stale = listStaleRunningRuns(base, 1000, Date.now());
    expect(stale.map((r) => r.runId)).toContain(child.runId);
    // The parent itself is never returned by the sweep.
    expect(stale.map((r) => r.runId)).not.toContain(parent.runId);
  });
});
