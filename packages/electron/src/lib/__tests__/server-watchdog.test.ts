/**
 * Unit tests for makeServerWatchdog + graceful-shutdown flag.
 *
 * Pure: no Electron boot, no fs access. All deps injected.
 * See change: harvest-bootstrap-survivor-fixes (cherry-pick 6b).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeServerWatchdog,
  setGracefulShutdownInProgress,
  isGracefulShutdownInProgress,
  setSpawnedPid,
} from "../server-lifecycle.js";

describe("gracefulShutdownInProgress flag", () => {
  beforeEach(() => {
    // Reset to known state before each test
    setGracefulShutdownInProgress(false);
  });

  it("defaults to false", () => {
    expect(isGracefulShutdownInProgress()).toBe(false);
  });

  it("setGracefulShutdownInProgress(true) flips the flag", () => {
    setGracefulShutdownInProgress(true);
    expect(isGracefulShutdownInProgress()).toBe(true);
  });

  it("setSpawnedPid resets graceful flag to false", () => {
    setGracefulShutdownInProgress(true);
    setSpawnedPid(12345);
    expect(isGracefulShutdownInProgress()).toBe(false);
  });
});

describe("makeServerWatchdog", () => {
  beforeEach(() => {
    setGracefulShutdownInProgress(false);
  });

  it("graceful exit: logs only, does not call onCrash", () => {
    const log = vi.fn();
    const onCrash = vi.fn();
    const watchdog = makeServerWatchdog({
      isGraceful: () => true,
      log,
      onCrash,
    });

    watchdog(0, null);

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).toContain("gracefully");
    expect(onCrash).not.toHaveBeenCalled();
  });

  it("unexpected exit: logs and calls onCrash with code + signal", () => {
    const log = vi.fn();
    const onCrash = vi.fn();
    const watchdog = makeServerWatchdog({
      isGraceful: () => false,
      log,
      onCrash,
    });

    watchdog(1, "SIGTERM");

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0]).toContain("unexpectedly");
    expect(onCrash).toHaveBeenCalledOnce();
    expect(onCrash).toHaveBeenCalledWith(1, "SIGTERM");
  });

  it("unexpected exit with null code: still calls onCrash", () => {
    const log = vi.fn();
    const onCrash = vi.fn();
    const watchdog = makeServerWatchdog({
      isGraceful: () => false,
      log,
      onCrash,
    });

    watchdog(null, "SIGKILL");

    expect(onCrash).toHaveBeenCalledWith(null, "SIGKILL");
  });

  it("onCrash throws: swallowed, secondary failure logged", () => {
    const log = vi.fn();
    const onCrash = vi.fn().mockImplementation(() => {
      throw new Error("window already destroyed");
    });
    const watchdog = makeServerWatchdog({
      isGraceful: () => false,
      log,
      onCrash,
    });

    // Must not throw
    expect(() => watchdog(1, null)).not.toThrow();

    // Two log calls: crash message + secondary failure
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]![0]).toContain("window already destroyed");
  });
});

// ── PID-scoped ownership (X8) ────────────────────────────────────────────────
// See change: electron-runtime-overlay-updates (D3 "switchRuntime").
import { claimCandidate, expectExit, releaseRuntimeSwitchOwnership } from "../server-lifecycle.js";

describe("makeServerWatchdog — PID-scoped ownership (X8)", () => {
  beforeEach(() => {
    setGracefulShutdownInProgress(false);
    releaseRuntimeSwitchOwnership();
  });

  function watch(pid: number) {
    const onCrash = vi.fn();
    const log = vi.fn();
    const onExit = makeServerWatchdog({ isGraceful: isGracefulShutdownInProgress, log, onCrash, getPid: () => pid });
    return { onExit, onCrash, log };
  }

  it("(a) a planned stop of the old PID is graceful — no recovery page", () => {
    const old = watch(100);
    expectExit(100);
    old.onExit(0, null);
    expect(old.onCrash).not.toHaveBeenCalled();
  });

  it("(a') expectExit is PID-scoped: another PID's exit still crashes", () => {
    const other = watch(101);
    expectExit(100);
    other.onExit(1, null);
    expect(other.onCrash).toHaveBeenCalledTimes(1);
  });

  it("(b) a claimed candidate exiting before commit is left to rollback — watchdog silent", () => {
    const cand = watch(200);
    claimCandidate(200);
    cand.onExit(1, null);
    expect(cand.onCrash).not.toHaveBeenCalled();
  });

  it("(c) the committed runtime exiting later reaches onCrash", () => {
    const cand = watch(200);
    claimCandidate(200);
    releaseRuntimeSwitchOwnership(); // commit releases the claim
    cand.onExit(1, null);
    expect(cand.onCrash).toHaveBeenCalledTimes(1);
  });

  it("(d) after an abort, the surviving runtime's crash reaches onCrash", () => {
    const survivor = watch(100);
    expectExit(100); // stop was planned …
    releaseRuntimeSwitchOwnership(); // … but the switch aborted (finally clears)
    survivor.onExit(null, "SIGSEGV");
    expect(survivor.onCrash).toHaveBeenCalledTimes(1);
  });

  it("exit code 75 from the watched server = restart requested (no recovery page)", () => {
    const onCrash = vi.fn();
    const onRestartRequested = vi.fn();
    const onExit = makeServerWatchdog({ isGraceful: () => false, log: vi.fn(), onCrash, onRestartRequested, getPid: () => 300 });
    onExit(75, null);
    expect(onRestartRequested).toHaveBeenCalledTimes(1);
    expect(onCrash).not.toHaveBeenCalled();
  });

  it("exit code 75 without a restart handler is still a crash", () => {
    const onCrash = vi.fn();
    const onExit = makeServerWatchdog({ isGraceful: () => false, log: vi.fn(), onCrash, getPid: () => 300 });
    onExit(75, null);
    expect(onCrash).toHaveBeenCalledTimes(1);
  });

  it("a watchdog without getPid keeps today's behaviour", () => {
    const onCrash = vi.fn();
    const onExit = makeServerWatchdog({ isGraceful: () => false, log: vi.fn(), onCrash });
    expectExit(100);
    onExit(1, null);
    expect(onCrash).toHaveBeenCalledTimes(1);
  });
});
