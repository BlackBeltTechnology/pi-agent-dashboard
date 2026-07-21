/**
 * Tests for SpawnRegisterWatchdog.
 * Uses vitest fake timers. See change: spawn-failure-diagnostics.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WebSocket from "ws";

// Silence appendSpawnFailure in unit tests.
vi.mock("../spawn-process/spawn-failure-log.js", () => ({
  appendSpawnFailure: vi.fn(),
}));

import { SpawnRegisterWatchdog } from "../spawn-process/spawn-register-watchdog.js";

function makeMockWs(readyState: number = WebSocket.OPEN): { ws: WebSocket; messages: string[] } {
  const messages: string[] = [];
  const ws = {
    readyState,
    send: vi.fn((data: string) => messages.push(data)),
  } as unknown as WebSocket;
  return { ws, messages };
}

describe("SpawnRegisterWatchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clamps timeoutMs below 5000 to 5000", () => {
    const w = new SpawnRegisterWatchdog(1000);
    expect(w.timeoutMs).toBe(5000);
  });

  it("clamps timeoutMs above 120000 to 120000", () => {
    const w = new SpawnRegisterWatchdog(999999);
    expect(w.timeoutMs).toBe(120000);
  });

  it("headless arm + clearByPid cancels watchdog", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000);
    w.arm({ pid: 123, cwd: "/p/x", mechanism: "headless", ws });
    w.clearByPid(123);
    vi.advanceTimersByTime(15000);
    expect(messages).toHaveLength(0);
  });

  it("headless arm + clearByCwd (pid mismatch) still cancels watchdog", () => {
    // Regression: Unix headless wraps pi in `sh -c "… | pi"`, so spawnResult.pid
    // is the sh wrapper while session_register reports pi's real pid. Watchdog
    // must clear via cwd even when pid was indexed at arm time.
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000);
    w.arm({ pid: 51250, cwd: "/p/x", mechanism: "headless", ws });
    w.clearByCwd("/p/x");
    vi.advanceTimersByTime(15000);
    expect(messages).toHaveLength(0);
  });

  it("tmux arm + clearByCwd cancels watchdog", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000);
    w.arm({ cwd: "/p/x", mechanism: "tmux", ws });
    w.clearByCwd("/p/x");
    vi.advanceTimersByTime(15000);
    expect(messages).toHaveLength(0);
  });

  it("arm without clear fires spawn_register_timeout", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000);
    w.arm({ pid: 42, cwd: "/p/y", mechanism: "headless", ws });
    vi.advanceTimersByTime(10001);
    expect(messages).toHaveLength(1);
    const msg = JSON.parse(messages[0]!);
    expect(msg.type).toBe("spawn_register_timeout");
    expect(msg.cwd).toBe("/p/y");
    expect(msg.pid).toBe(42);
  });

  it("tmux timeout omits pid", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000);
    w.arm({ cwd: "/p/z", mechanism: "tmux", ws });
    vi.advanceTimersByTime(10001);
    expect(messages).toHaveLength(1);
    const msg = JSON.parse(messages[0]!);
    expect(msg.pid).toBeUndefined();
  });

  it("clear on unknown key is a no-op", () => {
    const w = new SpawnRegisterWatchdog(10000);
    expect(() => w.clearByPid(999)).not.toThrow();
    expect(() => w.clearByCwd("/never/seen")).not.toThrow();
  });

  it("timeout fires silently when ws is closed", () => {
    const { ws, messages } = makeMockWs(WebSocket.CLOSED);
    const w = new SpawnRegisterWatchdog(10000);
    w.arm({ cwd: "/p/q", mechanism: "tmux", ws });
    expect(() => vi.advanceTimersByTime(10001)).not.toThrow();
    expect(messages).toHaveLength(0);
  });

  it("late clearByCwd within 60s emits spawn_register_recovered", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000);
    w.arm({ cwd: "/p/r", mechanism: "tmux", ws });

    // Fire the watchdog.
    vi.advanceTimersByTime(10001);
    expect(messages[0]).toContain("spawn_register_timeout");

    // Late registration within 60s.
    vi.advanceTimersByTime(5000);
    w.clearByCwd("/p/r");

    expect(messages).toHaveLength(2);
    const recovery = JSON.parse(messages[1]!);
    expect(recovery.type).toBe("spawn_register_recovered");
    expect(recovery.cwd).toBe("/p/r");
  });

  it("late clear past 60s TTL is silent", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000);
    w.arm({ cwd: "/p/s", mechanism: "tmux", ws });

    vi.advanceTimersByTime(10001);
    expect(messages).toHaveLength(1);

    // Past 60s TTL.
    vi.advanceTimersByTime(61000);
    w.clearByCwd("/p/s");

    // No recovery message.
    expect(messages).toHaveLength(1);
  });

  it("recovery skipped when ws closed at recovery time", () => {
    const messages: string[] = [];
    // Start with OPEN, then we'll swap to CLOSED.
    const ws = {
      readyState: WebSocket.OPEN,
      send: vi.fn((data: string) => messages.push(data)),
    } as unknown as WebSocket;

    const w = new SpawnRegisterWatchdog(10000);
    w.arm({ cwd: "/p/t", mechanism: "tmux", ws });
    vi.advanceTimersByTime(10001);

    // Close the ws before recovery.
    (ws as unknown as { readyState: number }).readyState = WebSocket.CLOSED;

    vi.advanceTimersByTime(5000);
    w.clearByCwd("/p/t");

    // Only the timeout message was sent (before ws was closed).
    const recoveries = messages.filter((m) => m.includes("spawn_register_recovered"));
    expect(recoveries).toHaveLength(0);
  });
});

// See change: spawn-correlation-token — third index by token.
describe("SpawnRegisterWatchdog: byToken index", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clearByToken cancels the watchdog", () => {
    const w = new SpawnRegisterWatchdog(30_000);
    const { ws, messages } = makeMockWs();
    w.arm({ pid: 100, cwd: "/p", mechanism: "headless", ws, spawnToken: "tok_a" });
    w.clearByToken("tok_a");
    vi.advanceTimersByTime(60_000);
    expect(messages.filter((m) => m.includes("spawn_register_timeout"))).toHaveLength(0);
  });

  it("clearByToken removes entry from cwd and pid indices too", () => {
    const w = new SpawnRegisterWatchdog(30_000);
    const { ws } = makeMockWs();
    w.arm({ pid: 100, cwd: "/p", mechanism: "headless", ws, spawnToken: "tok_a" });
    w.clearByToken("tok_a");
    // Subsequent clearByPid / clearByCwd are no-ops (entry already removed).
    w.clearByPid(100);
    w.clearByCwd("/p");
    // No exception, no double-clear.
    expect(true).toBe(true);
  });

  it("clearByPid also clears the token index", () => {
    const w = new SpawnRegisterWatchdog(30_000);
    const { ws, messages } = makeMockWs();
    w.arm({ pid: 100, cwd: "/p", mechanism: "headless", ws, spawnToken: "tok_a" });
    w.clearByPid(100);
    // Token-keyed clear is now a no-op (already cleaned up).
    w.clearByToken("tok_a");
    vi.advanceTimersByTime(60_000);
    expect(messages.filter((m) => m.includes("spawn_register_timeout"))).toHaveLength(0);
  });

  it("tmux arm without pid: token clears watchdog", () => {
    const w = new SpawnRegisterWatchdog(30_000);
    const { ws, messages } = makeMockWs();
    w.arm({ cwd: "/p", mechanism: "tmux", ws, spawnToken: "tok_b" });
    w.clearByToken("tok_b");
    vi.advanceTimersByTime(60_000);
    expect(messages.filter((m) => m.includes("spawn_register_timeout"))).toHaveLength(0);
  });

  it("late clearByToken after timeout emits recovered", () => {
    const w = new SpawnRegisterWatchdog(30_000);
    const { ws, messages } = makeMockWs();
    w.arm({ pid: 100, cwd: "/p", mechanism: "headless", ws, spawnToken: "tok_c" });
    vi.advanceTimersByTime(31_000); // timeout fires
    expect(messages.filter((m) => m.includes("spawn_register_timeout"))).toHaveLength(1);
    w.clearByToken("tok_c");
    expect(messages.filter((m) => m.includes("spawn_register_recovered"))).toHaveLength(1);
  });

  it("two simultaneous arms with distinct tokens, distinct cwds: token-clears each independently", () => {
    const w = new SpawnRegisterWatchdog(30_000);
    const { ws: ws1, messages: m1 } = makeMockWs();
    const { ws: ws2, messages: m2 } = makeMockWs();
    w.arm({ pid: 100, cwd: "/p1", mechanism: "headless", ws: ws1, spawnToken: "tok_x" });
    w.arm({ pid: 200, cwd: "/p2", mechanism: "headless", ws: ws2, spawnToken: "tok_y" });
    w.clearByToken("tok_y");
    vi.advanceTimersByTime(31_000);
    // Only the first arm's timeout fired (second was cleared).
    expect(m1.filter((m) => m.includes("spawn_register_timeout"))).toHaveLength(1);
    expect(m2.filter((m) => m.includes("spawn_register_timeout"))).toHaveLength(0);
  });

  it("arm without spawnToken behaves as before", () => {
    const w = new SpawnRegisterWatchdog(30_000);
    const { ws, messages } = makeMockWs();
    w.arm({ pid: 100, cwd: "/p", mechanism: "headless", ws });
    // Token-clear with empty / unknown token is a no-op.
    w.clearByToken("tok_unknown");
    vi.advanceTimersByTime(31_000);
    expect(messages.filter((m) => m.includes("spawn_register_timeout"))).toHaveLength(1);
  });
});
