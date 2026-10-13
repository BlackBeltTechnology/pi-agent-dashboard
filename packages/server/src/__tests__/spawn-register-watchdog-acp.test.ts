/**
 * An adapter that never registers is reclaimed through the keeper pid (the
 * token probe cannot identify a `node` adapter) and the spawn error surfaces.
 * See change: add-acp-session-driver (test-plan #X8, D2).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { _setSpawnRegisterWatchdogForTests, SpawnRegisterWatchdog } from "../spawn-process/spawn-register-watchdog.js";

afterEach(() => {
  vi.useRealTimers();
  _setSpawnRegisterWatchdogForTests(null);
});

describe("watchdog reclaim for an ACP durable spawn (X8)", () => {
  it("kills the keeper pid when the token probe misses, and reports the failure", async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    const wd = new SpawnRegisterWatchdog(5_000, { findPidsBySpawnToken: () => [], kill });
    const sent: any[] = [];
    const ws = { readyState: 1, send: (d: string) => sent.push(JSON.parse(d)) };
    wd.arm({ pid: 4242, cwd: "/work", mechanism: "headless", spawnToken: "tok", timeoutMs: 5_000, ws } as never);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(kill).toHaveBeenCalledWith(4242);
    expect(sent.some((m) => m.type === "spawn_register_timeout")).toBe(true);
  });

  it("registering by token before the timeout cancels the reclaim", async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    const wd = new SpawnRegisterWatchdog(5_000, { findPidsBySpawnToken: () => [], kill });
    wd.arm({ pid: 4242, cwd: "/work", mechanism: "headless", spawnToken: "tok", timeoutMs: 5_000 } as never);
    expect(wd.clearByToken("tok")).toBe(true);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(kill).not.toHaveBeenCalled();
  });
});
