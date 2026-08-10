/**
 * Tests for the cwd-keyed worktree-init run store.
 *
 * Pins the lifecycle the friendly feedback surfaces depend on:
 *  - startRun → running; progress updates lastLine
 *  - done → flashes then auto-collapses
 *  - failed → sticky (no timer), Retry via startRun replaces it
 *  - seed() rehydrates running / done / failed from active-inits
 *  - dispatchInitEvent by cwd reaches the store (cross-tab / reconnect)
 *
 * See change: friendlier-worktree-init.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetInitBusForTests, dispatchInitEvent } from "../git/worktree-init-bus.js";
import { DONE_FLASH_MS, initStore, RECONCILE_GRACE_MS } from "../git/worktree-init-store.js";

beforeEach(() => { initStore.__resetForTests(); __resetInitBusForTests(); });
afterEach(() => { initStore.__resetForTests(); __resetInitBusForTests(); vi.useRealTimers(); });

describe("worktree-init store", () => {
  it("startRun registers a running entry", () => {
    initStore.startRun("/w/a");
    expect(initStore.getRun("/w/a")?.phase).toBe("running");
  });

  it("progress events update lastLine + logTail (cwd-addressed)", () => {
    initStore.startRun("/w/a");
    dispatchInitEvent({ type: "worktree_init_progress", requestId: "", cwd: "/w/a", line: "installing\nresolving deps…" });
    const run = initStore.getRun("/w/a");
    expect(run?.lastLine).toBe("resolving deps…");
    expect(run?.logTail).toContain("installing");
  });

  it("done flashes then auto-collapses", () => {
    vi.useFakeTimers();
    initStore.startRun("/w/a");
    initStore.markDone("/w/a");
    expect(initStore.getRun("/w/a")?.phase).toBe("done");
    vi.advanceTimersByTime(DONE_FLASH_MS + 10);
    expect(initStore.getRun("/w/a")).toBeUndefined();
  });

  it("failed is sticky (never auto-collapses)", () => {
    vi.useFakeTimers();
    initStore.startRun("/w/a");
    initStore.markFailed("/w/a", "script_nonzero_exit", "exit 1", "boom");
    vi.advanceTimersByTime(DONE_FLASH_MS * 5);
    const run = initStore.getRun("/w/a");
    expect(run?.phase).toBe("failed");
    expect(run?.code).toBe("script_nonzero_exit");
    expect(run?.stderr).toBe("boom");
  });

  it("Retry (startRun) replaces a failed entry with running", () => {
    initStore.startRun("/w/a");
    initStore.markFailed("/w/a", "x", "y");
    initStore.startRun("/w/a");
    expect(initStore.getRun("/w/a")?.phase).toBe("running");
  });

  it("dismiss clears a run", () => {
    initStore.startRun("/w/a");
    initStore.markFailed("/w/a", "x", "y");
    initStore.dismiss("/w/a");
    expect(initStore.getRun("/w/a")).toBeUndefined();
  });

  it("seed rehydrates running and failed runs", () => {
    initStore.seed([
      { cwd: "/w/run", phase: "running", startedAt: 100, lastLine: "npm ci…" },
      { cwd: "/w/fail", phase: "failed", startedAt: 50, code: "script_nonzero_exit" },
    ]);
    expect(initStore.getRun("/w/run")?.phase).toBe("running");
    expect(initStore.getRun("/w/run")?.lastLine).toBe("npm ci…");
    expect(initStore.getRun("/w/fail")?.phase).toBe("failed");
  });

  it("a done event mid-run transitions to done (streaming after reconnect)", () => {
    initStore.startRun("/w/a");
    dispatchInitEvent({ type: "worktree_init_done", requestId: "", cwd: "/w/a", durationMs: 5 });
    expect(initStore.getRun("/w/a")?.phase).toBe("done");
  });

  it("a failed event mid-run transitions to failed-sticky", () => {
    initStore.startRun("/w/a");
    dispatchInitEvent({
      type: "worktree_init_failed",
      requestId: "",
      cwd: "/w/a",
      code: "script_nonzero_exit",
      message: "exit 1",
      stderr: "trace",
    });
    const run = initStore.getRun("/w/a");
    expect(run?.phase).toBe("failed");
    expect(run?.stderr).toBe("trace");
  });

  it("getAllSnapshot reflects concurrent runs", () => {
    initStore.startRun("/w/a");
    initStore.startRun("/w/b");
    expect(initStore.getAllSnapshot().map((r) => r.cwd).sort()).toEqual(["/w/a", "/w/b"]);
  });

  it("reconcile prunes a stale running run the server no longer reports", () => {
    // A run that started long ago (past the grace) and is absent from the
    // server snapshot = finished + evicted while ws was down → prune.
    initStore.startRun("/w/stale");
    const run = initStore.getRun("/w/stale");
    if (run) run.startedAt = Date.now() - (RECONCILE_GRACE_MS + 1000);
    initStore.reconcile([]); // empty snapshot must NOT be a no-op
    expect(initStore.getRun("/w/stale")).toBeUndefined();
  });

  it("reconcile spares a just-started optimistic run within the grace window", () => {
    initStore.startRun("/w/fresh"); // startedAt = now
    initStore.reconcile([]);
    expect(initStore.getRun("/w/fresh")?.phase).toBe("running");
  });

  it("reconcile preserves client failed-sticky state absent from the server", () => {
    initStore.startRun("/w/fail");
    initStore.markFailed("/w/fail", "script_nonzero_exit", "exit 1");
    initStore.reconcile([]);
    expect(initStore.getRun("/w/fail")?.phase).toBe("failed");
  });

  it("reconcile upserts server-reported running runs", () => {
    initStore.reconcile([{ cwd: "/w/new", phase: "running", startedAt: 1, lastLine: "npm ci" }]);
    expect(initStore.getRun("/w/new")?.phase).toBe("running");
  });
});
