/**
 * One config read per spawn: the timeout that armed a spawn's watchdog is the
 * same value every TTL recorded for that spawn derives from, even when the
 * operator changes the setting mid-spawn.
 *
 * See change: fix-spawn-correlation-ttl-coupling (test-plan E7-E9, D1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../spawn-process/spawn-failure-log.js", () => ({
  appendSpawnFailure: vi.fn(),
}));

const configState = { spawnRegisterTimeoutMs: 30_000 };

vi.mock("@blackbelt-technology/pi-dashboard-shared/config.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@blackbelt-technology/pi-dashboard-shared/config.js")
  >();
  return {
    ...actual,
    loadConfig: () => ({ ...configState }) as any,
  };
});

import { createPendingClientCorrelations } from "../pending/pending-client-correlations.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { deriveSpawnCorrelationTtlMs } from "../spawn-process/spawn-recovery-window.js";
import {
  _setSpawnRegisterWatchdogForTests,
  armSpawnWatchdog,
  SpawnRegisterWatchdog,
} from "../spawn-process/spawn-register-watchdog.js";

/** Stand-in for a handler: one read, threaded into both the arm and the TTL. */
function armAndRecord(
  readTimeoutMs: number,
  correlations: ReturnType<typeof createPendingClientCorrelations>,
  mutateConfigBeforeRecord?: () => void,
): void {
  const effective = armSpawnWatchdog(
    "/p/x",
    "headless",
    { success: true, spawnToken: "tok" },
    undefined,
    readTimeoutMs,
  );
  mutateConfigBeforeRecord?.();
  correlations.record("tok", "req-1", deriveSpawnCorrelationTtlMs(effective!));
}

describe("spawn correlation TTL — one config read per spawn", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    configState.spawnRegisterTimeoutMs = 30_000;
    _setSpawnRegisterWatchdogForTests(new SpawnRegisterWatchdog(30_000));
  });
  afterEach(() => {
    _setSpawnRegisterWatchdogForTests(null);
    vi.useRealTimers();
  });

  // E7 — armed from 120_000, config lowered before record: TTL follows the ARM.
  it("config lowered between arm and record → TTL still derived from the armed value", () => {
    const correlations = createPendingClientCorrelations();
    armAndRecord(120_000, correlations, () => {
      configState.spawnRegisterTimeoutMs = 30_000;
    });
    // 185_000, not 95_000: still alive one tick before the derived TTL.
    vi.advanceTimersByTime(184_999);
    expect(correlations.consume("tok")).toBe("req-1");
    correlations.dispose();
  });

  // E8 — armed from 30_000, config raised before record: arm and TTL agree.
  it("config raised between arm and record → TTL still derived from the armed value", () => {
    const correlations = createPendingClientCorrelations();
    armAndRecord(30_000, correlations, () => {
      configState.spawnRegisterTimeoutMs = 120_000;
    });
    vi.advanceTimersByTime(95_001);
    expect(correlations.consume("tok")).toBeUndefined();
    correlations.dispose();
  });

  it("armSpawnWatchdog reports the timeout it actually armed with", () => {
    expect(armSpawnWatchdog("/p/x", "headless", { success: true }, undefined, 90_000)).toBe(90_000);
    // Clamped, and falling back to the config read only when given nothing.
    expect(armSpawnWatchdog("/p/y", "headless", { success: true }, undefined, 1)).toBe(5_000);
    configState.spawnRegisterTimeoutMs = 90_000;
    expect(armSpawnWatchdog("/p/z", "headless", { success: true })).toBe(90_000);
    // A failed spawn arms nothing and derives nothing.
    expect(armSpawnWatchdog("/p/w", "headless", { success: false })).toBeUndefined();
  });

  // E9 — the resume/fork and degrade recording paths derive too, no 60_000 literal.
  it("resume/fork and degrade paths both survive a register at t+70s under a 90_000 timeout", () => {
    const correlations = createPendingClientCorrelations();
    const forks = createPendingForkRegistry();
    const ttl = deriveSpawnCorrelationTtlMs(90_000);
    correlations.record("tok-resume", "req-resume", ttl);
    correlations.record("tok-degrade", "req-degrade", ttl);
    forks.recordFork("tok-resume", "parent-1", ttl);

    vi.advanceTimersByTime(70_000);

    expect(correlations.consume("tok-resume")).toBe("req-resume");
    expect(correlations.consume("tok-degrade")).toBe("req-degrade");
    expect(forks.consumeFork("tok-resume")).toBe("parent-1");
    expect(ttl).not.toBe(60_000);
    correlations.dispose();
    forks.dispose();
  });
});

/**
 * The correlation is consumed exactly once — by the register broadcast path,
 * never by the watchdog. See change: fix-spawn-correlation-ttl-coupling
 * (test-plan E15, X4, D2).
 */
describe("spawn correlation — consumed once, by the broadcast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _setSpawnRegisterWatchdogForTests(null);
  });
  afterEach(() => {
    _setSpawnRegisterWatchdogForTests(null);
    vi.useRealTimers();
  });

  /** The event-wiring consume-and-broadcast, reduced to its correlation step. */
  function broadcastSessionAdded(
    correlations: ReturnType<typeof createPendingClientCorrelations>,
    spawnToken: string,
  ): { type: string; spawnRequestId?: string } {
    const spawnRequestId = correlations.consume(spawnToken);
    return { type: "session_added", ...(spawnRequestId ? { spawnRequestId } : {}) };
  }

  // E15 — clearByToken recovers the banner; the broadcast still gets the id.
  it("a late clearByToken leaves the correlation for the broadcast to consume", () => {
    const messages: string[] = [];
    const ws = { readyState: 1, send: (raw: string) => messages.push(raw) } as any;
    const watchdog = new SpawnRegisterWatchdog(10_000, {
      findPidsBySpawnToken: () => [],
      kill: () => {},
    });
    const correlations = createPendingClientCorrelations();
    correlations.record("tok_e15", "req-15", deriveSpawnCorrelationTtlMs(10_000));
    watchdog.arm({ cwd: "/p/e15", mechanism: "tmux", ws, spawnToken: "tok_e15", timeoutMs: 10_000 });

    vi.advanceTimersByTime(10_001);
    watchdog.clearByToken("tok_e15");

    expect(messages.filter((m) => m.includes("spawn_register_recovered"))).toHaveLength(1);
    expect(broadcastSessionAdded(correlations, "tok_e15").spawnRequestId).toBe("req-15");
    // And only once.
    expect(broadcastSessionAdded(correlations, "tok_e15").spawnRequestId).toBeUndefined();
    correlations.dispose();
  });

  // X4 — arm-before-record (resume path), register in the final ms of the window.
  it("arm-before-record still resolves a register in the last ms of the recovery window", () => {
    const correlations = createPendingClientCorrelations();
    const effective = armSpawnWatchdog(
      "/p/x4",
      "headless",
      { success: true, spawnToken: "tok_x4" },
      undefined,
      90_000,
    );
    // The resume path records AFTER the arm — the ordering margin is what keeps
    // the correlation alive to the very end of the window.
    vi.advanceTimersByTime(3);
    correlations.record("tok_x4", "req-x4", deriveSpawnCorrelationTtlMs(effective!));

    // Fire at 90s, register in the final ms of the 60s recovery window.
    vi.advanceTimersByTime(90_000 + 60_000 - 1 - 3);
    expect(correlations.consume("tok_x4")).toBe("req-x4");
    correlations.dispose();
  });
});
