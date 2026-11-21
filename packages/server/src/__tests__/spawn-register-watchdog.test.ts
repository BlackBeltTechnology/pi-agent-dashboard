/**
 * Tests for SpawnRegisterWatchdog.
 * Uses vitest fake timers. See change: spawn-failure-diagnostics.
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

// Silence appendSpawnFailure in unit tests.
vi.mock("../spawn-process/spawn-failure-log.js", () => ({
  appendSpawnFailure: vi.fn(),
}));

import { appendSpawnFailure } from "../spawn-process/spawn-failure-log.js";
import { normalizeCwdKey, SpawnRegisterWatchdog } from "../spawn-process/spawn-register-watchdog.js";

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

  it("echoes the arming requestId on spawn_register_timeout (redesign-directory-home-split)", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000, { findPidsBySpawnToken: () => [], kill: () => undefined });
    w.arm({ pid: 7, cwd: "/p/x", mechanism: "headless", ws, requestId: "req-1" });
    vi.advanceTimersByTime(15000);
    expect(JSON.parse(messages[0] ?? "{}")).toMatchObject({ type: "spawn_register_timeout", requestId: "req-1" });
  });

  it("omits requestId when the spawn carried none", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000, { findPidsBySpawnToken: () => [], kill: () => undefined });
    w.arm({ pid: 8, cwd: "/p/y", mechanism: "headless", ws });
    vi.advanceTimersByTime(15000);
    expect(JSON.parse(messages[0] ?? "{}")).not.toHaveProperty("requestId");
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

/**
 * The watchdog SHALL reclaim a spawn that never registered — not merely report
 * it.
 *
 * Measured in the E2E harness: three tmux panes sat forever on pi's interactive
 * "Trust project folder?" prompt for an untrusted cwd. Each pi had zero open
 * sockets, so `session_register` never fired, the dashboard never held a record,
 * the reaper had nothing to reap and shutdown was never asked to end them —
 * ~127 MB each, indefinitely. The watchdog SAW it (one `REGISTER_TIMEOUT` in
 * spawn-failures.log) and did nothing.
 *
 * The kill is keyed on the spawn token in the process environment, because for
 * a tmux spawn that is the only handle: `tmux new-window` returns tmux's pid,
 * and the pane's command line carries nothing identifying.
 *
 * See change: fix-tmux-session-shutdown-leak (design D5).
 */
describe("SpawnRegisterWatchdog: reclaims a spawn that never registered", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const TOKEN = "fe487887-9973-4805-ab90-17f3d889ef68";

  it("terminates every pid carrying the spawn token when the watchdog fires", () => {
    const { ws, messages } = makeMockWs();
    const findPids = vi.fn(() => [18163, 18674]);
    const kill = vi.fn();
    const w = new SpawnRegisterWatchdog(10000, { findPidsBySpawnToken: findPids, kill });

    w.arm({ cwd: "/fixtures/kb-parent", mechanism: "tmux", ws, spawnToken: TOKEN });
    vi.advanceTimersByTime(10001);

    expect(findPids).toHaveBeenCalledWith(TOKEN);
    expect(kill.mock.calls.map((c) => c[0])).toEqual([18163, 18674]);
    // The diagnostic is NOT replaced by the kill — reporting is how the leak
    // becomes visible; the kill is how it stops costing 127 MB.
    expect(JSON.parse(messages[0]!).type).toBe("spawn_register_timeout");
  });

  it("kills the headless spawn pid when there is no token", () => {
    const { ws } = makeMockWs();
    const findPids = vi.fn(() => []);
    const kill = vi.fn();
    const w = new SpawnRegisterWatchdog(10000, { findPidsBySpawnToken: findPids, kill });

    w.arm({ pid: 4242, cwd: "/p/headless", mechanism: "headless", ws });
    vi.advanceTimersByTime(10001);

    expect(kill.mock.calls.map((c) => c[0])).toEqual([4242]);
  });

  it("kills nothing when a session registers in time", () => {
    const { ws } = makeMockWs();
    const kill = vi.fn();
    const w = new SpawnRegisterWatchdog(10000, {
      findPidsBySpawnToken: () => [18163],
      kill,
    });

    w.arm({ cwd: "/p/ok", mechanism: "tmux", ws, spawnToken: TOKEN });
    w.clearByToken(TOKEN);
    vi.advanceTimersByTime(15000);

    expect(kill).not.toHaveBeenCalled();
  });

  it("never lets a failing kill break the diagnostic", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000, {
      findPidsBySpawnToken: () => [1],
      kill: () => {
        throw new Error("EPERM");
      },
    });

    w.arm({ cwd: "/p/boom", mechanism: "tmux", ws, spawnToken: TOKEN });
    expect(() => vi.advanceTimersByTime(10001)).not.toThrow();
    expect(messages).toHaveLength(1);
  });

  it("a closed browser socket does not skip the kill", () => {
    // The diagnostic goes to the originating WebSocket, but the leak is real
    // whether or not anyone is listening. Ordering the kill after the early
    // `readyState` return would have made a disconnected tab leak silently.
    const { ws } = makeMockWs(WebSocket.CLOSED);
    const kill = vi.fn();
    const w = new SpawnRegisterWatchdog(10000, {
      findPidsBySpawnToken: () => [18830],
      kill,
    });

    w.arm({ cwd: "/p/closed", mechanism: "tmux", ws, spawnToken: TOKEN });
    vi.advanceTimersByTime(10001);

    expect(kill.mock.calls.map((c) => c[0])).toEqual([18830]);
  });
});

/**
 * Concurrent spawns into the SAME cwd must each stay watched.
 *
 * `arm()` indexes by cwd and replaced the prior entry, cancelling its timer. In
 * the harness three spawns into `/fixtures/kb-parent` therefore produced ONE
 * `REGISTER_TIMEOUT` for THREE leaked pi: two of them were silently unwatched,
 * so no diagnostic and — now that firing reclaims — no kill would ever reach
 * them. An entry that carries its own spawn token has strong identity and must
 * keep its timer; `clearByToken` on a real registration cancels exactly the one
 * that registered.
 *
 * See change: fix-tmux-session-shutdown-leak.
 */
describe("SpawnRegisterWatchdog: concurrent spawns in one cwd", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const CWD = "/fixtures/kb-parent";
  const T1 = "aaaaaaaa-1111-4805-ab90-17f3d889ef68";
  const T2 = "bbbbbbbb-2222-4805-ab90-17f3d889ef68";
  const T3 = "cccccccc-3333-4805-ab90-17f3d889ef68";

  it("fires once per spawn, not once per cwd", () => {
    const { ws, messages } = makeMockWs();
    const killed: number[] = [];
    const pidsFor: Record<string, number[]> = { [T1]: [18163], [T2]: [18674], [T3]: [18830] };
    const w = new SpawnRegisterWatchdog(10000, {
      findPidsBySpawnToken: (t) => pidsFor[t] ?? [],
      kill: (pid) => killed.push(pid),
    });

    for (const token of [T1, T2, T3]) {
      w.arm({ cwd: CWD, mechanism: "tmux", ws, spawnToken: token });
    }
    vi.advanceTimersByTime(10001);

    expect(killed.sort()).toEqual([18163, 18674, 18830]);
    expect(messages).toHaveLength(3);
  });

  it("the one that registers is spared; its siblings are still reclaimed", () => {
    const { ws } = makeMockWs();
    const killed: number[] = [];
    const pidsFor: Record<string, number[]> = { [T1]: [18163], [T2]: [18674], [T3]: [18830] };
    const w = new SpawnRegisterWatchdog(10000, {
      findPidsBySpawnToken: (t) => pidsFor[t] ?? [],
      kill: (pid) => killed.push(pid),
    });

    for (const token of [T1, T2, T3]) {
      w.arm({ cwd: CWD, mechanism: "tmux", ws, spawnToken: token });
    }
    w.clearByToken(T2); // this pi answered the trust prompt and registered
    vi.advanceTimersByTime(10001);

    expect(killed.sort()).toEqual([18163, 18830]);
  });
});

/**
 * The reclaim must never target the dashboard's own process.
 *
 * The spawn token is an ordinary environment variable and is therefore
 * INHERITED — by the tmux server, by the dashboard's own node process, by every
 * shell in between. A token lookup that was not narrowed returned five pids for
 * one token, and handing that set to the kill path took the entire container
 * down. The probe narrows to leaf `pi`; this is the second, unconditional net.
 *
 * See change: fix-tmux-session-shutdown-leak.
 */
describe("SpawnRegisterWatchdog: never kills the server itself", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips our own pid and our parent even if the probe returns them", () => {
    const { ws } = makeMockWs();
    const killed: number[] = [];
    const w = new SpawnRegisterWatchdog(10000, {
      findPidsBySpawnToken: () => [process.pid, process.ppid, 18163],
      kill: (pid) => killed.push(pid),
    });

    w.arm({
      cwd: "/p/inherit",
      mechanism: "tmux",
      ws,
      spawnToken: "fe487887-9973-4805-ab90-17f3d889ef68",
    });
    vi.advanceTimersByTime(10001);

    expect(killed).toEqual([18163]);
  });
});

/**
 * Recovery identity, cwd normalization and observability.
 *
 * See change: fix-spawn-correlation-ttl-coupling (test-plan E14, E16-E21,
 * E36, E37, X1-X3, X11).
 */
describe("SpawnRegisterWatchdog: recovery identity and observability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(appendSpawnFailure).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function recoveries(messages: string[]): string[] {
    return messages.filter((m) => m.includes("spawn_register_recovered"));
  }

  // E14 — the fire must not touch the correlation map. The watchdog has no
  // reference to it at all; this pins that absence.
  it("firing leaves a separately-held correlation entry untouched", async () => {
    const { createPendingClientCorrelations } = await import(
      "../pending/pending-client-correlations.js"
    );
    const correlations = createPendingClientCorrelations();
    correlations.record("tok_e14", "req-1", 95_000);

    const { ws } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000);
    w.arm({ cwd: "/p/e14", mechanism: "headless", ws, spawnToken: "tok_e14" });
    vi.advanceTimersByTime(10_001);

    expect(correlations.size()).toBe(1);
    expect(correlations.consume("tok_e14")).toBe("req-1");
    correlations.dispose();
  });

  // E16 — two same-cwd fires no longer collapse into one recovery record.
  it("two same-cwd fires with distinct tokens keep independent recovery entries", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000);
    w.arm({ cwd: "/p/e16", mechanism: "tmux", ws, spawnToken: "tok_A" });
    w.arm({ cwd: "/p/e16", mechanism: "tmux", ws, spawnToken: "tok_B" });
    vi.advanceTimersByTime(10_001);
    expect(w._recentlyFiredSize()).toBe(2);

    w.clearByToken("tok_A");
    expect(recoveries(messages)).toHaveLength(1);
    // B's fire is intact and still recoverable on its own token.
    expect(w._recentlyFiredSize()).toBe(1);
    w.clearByToken("tok_B");
    expect(recoveries(messages)).toHaveLength(2);
  });

  // E17 — a cwd clear must not claim a token-indexed fire.
  it("clearByCwd emits no recovery for a fire that has a token", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000);
    w.arm({ cwd: "/p/e17", mechanism: "tmux", ws, spawnToken: "tok_e17" });
    vi.advanceTimersByTime(10_001);

    expect(w.clearByCwd("/p/e17")).toBe(false);
    expect(recoveries(messages)).toHaveLength(0);
    // The token entry survives and can still recover.
    expect(w.clearByToken("tok_e17")).toBe(true);
    expect(recoveries(messages)).toHaveLength(1);
  });

  // E18 — one fire, at most one recovery.
  it("clearByToken then clearByCwd emits exactly one recovery", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000);
    w.arm({ cwd: "/p/e18", mechanism: "tmux", ws, spawnToken: "tok_e18" });
    vi.advanceTimersByTime(10_001);

    w.clearByToken("tok_e18");
    w.clearByCwd("/p/e18");
    expect(recoveries(messages)).toHaveLength(1);
  });

  // E19 — the recovered message carries no requestId (D2).
  it("the recovered message has no requestId field", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000);
    w.arm({ cwd: "/p/e19", mechanism: "tmux", ws, spawnToken: "tok_e19" });
    vi.advanceTimersByTime(10_001);
    w.clearByToken("tok_e19");

    const msg = JSON.parse(recoveries(messages)[0]!);
    expect(msg).not.toHaveProperty("requestId");
    expect(msg.cwd).toBe("/p/e19");
  });

  // E20 — /tmp vs /private/tmp, the miss that actually happens on macOS.
  it("arm on a symlinked cwd is cancelled by a clear on its real path", (ctx) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "wd-e20-")));
    const link = join(mkdtempSync(join(tmpdir(), "wd-e20-link-")), "alias");
    try {
      symlinkSync(dir, link);
    } catch {
      // Unprivileged Windows cannot create a symlink; the normalization itself
      // is covered by the fallback cases below.
      ctx.skip();
      return;
    }

    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000);
    w.arm({ cwd: link, mechanism: "tmux", ws });
    expect(w.clearByCwd(dir)).toBe(true);
    vi.advanceTimersByTime(15_000);
    expect(messages).toHaveLength(0);
  });

  // E21 / X3 — normalization can never throw; it falls back to the raw string.
  it("arm on a non-existent path is cancelled by the identical raw string", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000);
    const ghost = join(tmpdir(), "wd-e21-does-not-exist", "nested");
    expect(() => w.arm({ cwd: ghost, mechanism: "tmux", ws })).not.toThrow();
    expect(w.clearByCwd(ghost)).toBe(true);
    vi.advanceTimersByTime(15_000);
    expect(messages).toHaveLength(0);
  });

  // X3 — an EACCES (not ENOENT) realpath failure takes the same fallback.
  it("falls back to the raw string when realpath fails with EACCES", () => {
    const parent = mkdtempSync(join(tmpdir(), "wd-x3-"));
    const child = join(parent, "inner");
    mkdirSync(child);
    chmodSync(parent, 0o000);
    try {
      // Precondition: the path really is unreadable, so this exercises the
      // EACCES branch rather than silently passing on a resolvable path.
      let code: string | undefined;
      try {
        realpathSync(child);
      } catch (err) {
        code = (err as NodeJS.ErrnoException).code;
      }
      if (code !== "EACCES" && code !== "EPERM") return; // running as root

      expect(normalizeCwdKey(child)).toBe(child);
      const { ws, messages } = makeMockWs();
      const w = new SpawnRegisterWatchdog(10_000);
      expect(() => w.arm({ cwd: child, mechanism: "tmux", ws })).not.toThrow();
      expect(w.clearByCwd(child)).toBe(true);
      vi.advanceTimersByTime(15_000);
      expect(messages).toHaveLength(0);
    } finally {
      chmodSync(parent, 0o700);
    }
  });

  // E36 — the failure entry gains the join key.
  it("the persisted REGISTER_TIMEOUT carries the spawnToken", () => {
    const { ws } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000);
    w.arm({ cwd: "/p/e36", mechanism: "tmux", ws, spawnToken: "tok_e36" });
    vi.advanceTimersByTime(10_001);

    const entry = vi.mocked(appendSpawnFailure).mock.calls.at(-1)![0];
    expect(entry.code).toBe("REGISTER_TIMEOUT");
    expect(entry.spawnToken).toBe("tok_e36");
  });

  // E37 — the recorded timeout is the per-entry one, not the constructor default.
  it("names the effective per-entry timeout, not the constructor default", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(30_000);
    w.arm({ cwd: "/p/e37", mechanism: "tmux", ws, timeoutMs: 90_000 });
    vi.advanceTimersByTime(90_001);

    const entry = vi.mocked(appendSpawnFailure).mock.calls.at(-1)![0];
    expect(entry.message).toContain("90000");
    expect(entry.message).not.toContain("30000");
    expect(JSON.parse(messages[0]!).timeoutMs).toBe(90_000);
  });

  // X1 — nothing ever clears: the fire record is evicted on the window closing.
  it("evicts the fire record once the recovery window closes, with no recovery", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000);
    w.arm({ cwd: "/p/x1", mechanism: "tmux", ws, spawnToken: "tok_x1" });
    vi.advanceTimersByTime(10_001);
    expect(w._recentlyFiredSize()).toBe(1);

    vi.advanceTimersByTime(60_001);
    expect(w._recentlyFiredSize()).toBe(0);
    expect(recoveries(messages)).toHaveLength(0);
    expect(w.clearByToken("tok_x1")).toBe(false);
    expect(recoveries(messages)).toHaveLength(0);
  });

  // X2 — a closed socket at recovery time: silent, entry still consumed.
  it("a late clear on a closed socket deletes the entry and does not throw", () => {
    const messages: string[] = [];
    const ws = {
      readyState: WebSocket.OPEN,
      send: vi.fn((data: string) => messages.push(data)),
    } as unknown as WebSocket;
    const w = new SpawnRegisterWatchdog(10_000);
    w.arm({ cwd: "/p/x2", mechanism: "tmux", ws, spawnToken: "tok_x2" });
    vi.advanceTimersByTime(10_001);
    (ws as unknown as { readyState: number }).readyState = WebSocket.CLOSED;

    expect(() => w.clearByToken("tok_x2")).not.toThrow();
    expect(recoveries(messages)).toHaveLength(0);
    expect(w._recentlyFiredSize()).toBe(0);
  });

  // X11 — a fire that never recovers gets no companion record.
  it("a never-recovered fire appends no REGISTER_RECOVERED companion", () => {
    const { ws } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000, {
      findPidsBySpawnToken: () => [4242],
      kill: () => {},
    });
    w.arm({ cwd: "/p/x11", mechanism: "tmux", ws, spawnToken: "tok_x11" });
    vi.advanceTimersByTime(70_002);

    const codes = vi.mocked(appendSpawnFailure).mock.calls.map((c) => c[0].code);
    expect(codes).toContain("REGISTER_TIMEOUT");
    expect(codes).not.toContain("REGISTER_RECOVERED");
  });

  it("a recovered fire appends a companion joined by token", () => {
    const { ws } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000);
    w.arm({ cwd: "/p/rec", mechanism: "tmux", ws, spawnToken: "tok_rec" });
    vi.advanceTimersByTime(10_001);
    w.clearByToken("tok_rec");

    const entry = vi.mocked(appendSpawnFailure).mock.calls.at(-1)![0];
    expect(entry.code).toBe("REGISTER_RECOVERED");
    expect(entry.spawnToken).toBe("tok_rec");
    expect(entry.message).toContain("tier token");
  });

  // Review finding: two TOKEN-LESS same-cwd fires share one `recentlyFired`
  // key, so the first fire's evict timer must not evict the second's record
  // early and silently truncate its recovery window.
  it("a second token-less same-cwd fire keeps its full recovery window", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000);

    w.arm({ cwd: "/p/evict", mechanism: "tmux", ws });
    vi.advanceTimersByTime(10_001); // fire #1 at t≈10s
    expect(w._recentlyFiredSize()).toBe(1);

    // A second token-less spawn into the same cwd fires 30s later.
    vi.advanceTimersByTime(30_000);
    w.arm({ cwd: "/p/evict", mechanism: "tmux", ws });
    vi.advanceTimersByTime(10_001); // fire #2 at t≈50s
    expect(w._recentlyFiredSize()).toBe(1);

    // Past fire #1's eviction deadline, but well inside fire #2's window.
    vi.advanceTimersByTime(25_000);
    expect(w._recentlyFiredSize()).toBe(1);
    expect(w.clearByCwd("/p/evict")).toBe(true);
    expect(messages.filter((m) => m.includes("spawn_register_recovered"))).toHaveLength(1);
  });

  it("the recovery companion names the spawn mechanism, not \"unknown\"", () => {
    const { ws } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10_000);
    w.arm({ cwd: "/p/mech", mechanism: "tmux", ws, spawnToken: "tok_mech" });
    vi.advanceTimersByTime(10_001);
    w.clearByToken("tok_mech");

    const entry = vi.mocked(appendSpawnFailure).mock.calls.at(-1)![0];
    expect(entry.code).toBe("REGISTER_RECOVERED");
    expect(entry.strategy).toBe("tmux");
  });
});

/**
 * Honest watchdog wording: the timeout message and failure record carry the
 * reclaim evidence (`terminated`, `terminatedPids`). "Signalled" = termination
 * dispatched without throwing — not a verified exit.
 *
 * See change: fix-session-bridge-registration (D3; test-plan E18-E22, X1-X5).
 */
describe("SpawnRegisterWatchdog: terminated evidence on the timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(appendSpawnFailure).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const TOKEN = "0f0f0f0f-aaaa-bbbb-cccc-1234567890ab";

  function lastFailure() {
    return vi.mocked(appendSpawnFailure).mock.calls.at(-1)![0];
  }

  // E18
  it("reports terminated:true and the signalled pids on message and log entry", () => {
    const { ws, messages } = makeMockWs();
    const kill = vi.fn();
    const w = new SpawnRegisterWatchdog(10000, { findPidsBySpawnToken: () => [4242], kill });
    w.arm({ pid: 4242, cwd: "/p/e18", mechanism: "headless", ws, spawnToken: TOKEN });
    vi.advanceTimersByTime(10001);

    const msg = JSON.parse(messages[0]!);
    expect(msg.terminated).toBe(true);
    expect(msg.terminatedPids).toEqual([4242]);
    const entry = lastFailure();
    expect(entry.code).toBe("REGISTER_TIMEOUT");
    expect(entry.terminated).toBe(true);
    expect(entry.terminatedPids).toEqual([4242]);
  });

  // E19
  it("omits terminated/terminatedPids when there is nothing to signal (tmux, no pid)", () => {
    const { ws, messages } = makeMockWs();
    const kill = vi.fn();
    const w = new SpawnRegisterWatchdog(10000, { findPidsBySpawnToken: () => [], kill });
    w.arm({ cwd: "/p/e19", mechanism: "tmux", ws });
    vi.advanceTimersByTime(10001);

    const msg = JSON.parse(messages[0]!);
    expect("terminated" in msg).toBe(false);
    expect("terminatedPids" in msg).toBe(false);
    const entry = lastFailure();
    expect("terminated" in entry).toBe(false);
    expect("terminatedPids" in entry).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });

  // E20
  it.each([
    { name: "first throws", throwsFor: [1], expected: [2] },
    { name: "second throws", throwsFor: [2], expected: [1] },
  ])("a partial kill failure ($name) still kills every pid and reports the signalled ones", ({
    throwsFor,
    expected,
  }) => {
    const { ws, messages } = makeMockWs();
    const kill = vi.fn((pid: number) => {
      if (throwsFor.includes(pid)) throw new Error("EPERM");
    });
    const w = new SpawnRegisterWatchdog(10000, { findPidsBySpawnToken: () => [1, 2], kill });
    w.arm({ cwd: "/p/e20", mechanism: "tmux", ws, spawnToken: TOKEN });
    vi.advanceTimersByTime(10001);

    expect(kill.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    const msg = JSON.parse(messages[0]!);
    expect(msg.terminated).toBe(true);
    expect(msg.terminatedPids).toEqual(expected);
    expect(lastFailure().terminatedPids).toEqual(expected);
  });

  it("omits the fields when every kill throws, and still emits the message", () => {
    const { ws, messages } = makeMockWs();
    const kill = vi.fn(() => {
      throw new Error("EPERM");
    });
    const w = new SpawnRegisterWatchdog(10000, { findPidsBySpawnToken: () => [1, 2], kill });
    w.arm({ cwd: "/p/e20b", mechanism: "tmux", ws, spawnToken: TOKEN });
    vi.advanceTimersByTime(10001);

    expect(kill).toHaveBeenCalledTimes(2);
    expect(messages).toHaveLength(1);
    const msg = JSON.parse(messages[0]!);
    expect("terminated" in msg).toBe(false);
    expect("terminatedPids" in msg).toBe(false);
    expect("terminated" in lastFailure()).toBe(false);
  });

  // E21
  it("(a) reports all token pids in kill order", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000, {
      findPidsBySpawnToken: () => [18163, 18674],
      kill: vi.fn(),
    });
    w.arm({ cwd: "/p/e21a", mechanism: "tmux", ws, spawnToken: TOKEN });
    vi.advanceTimersByTime(10001);
    expect(JSON.parse(messages[0]!).terminatedPids).toEqual([18163, 18674]);
  });

  it("(b) reports the headless pid when there is no token", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000, {
      findPidsBySpawnToken: () => [],
      kill: vi.fn(),
    });
    w.arm({ pid: 77, cwd: "/p/e21b", mechanism: "headless", ws });
    vi.advanceTimersByTime(10001);
    expect(JSON.parse(messages[0]!).terminatedPids).toEqual([77]);
  });

  it("(c) never kills nor reports our own or our parent pid", () => {
    const { ws, messages } = makeMockWs();
    const kill = vi.fn();
    const w = new SpawnRegisterWatchdog(10000, {
      findPidsBySpawnToken: () => [process.pid, process.ppid, 18163],
      kill,
    });
    w.arm({ cwd: "/p/e21c", mechanism: "tmux", ws, spawnToken: TOKEN });
    vi.advanceTimersByTime(10001);

    expect(kill.mock.calls.map((c) => c[0])).toEqual([18163]);
    expect(JSON.parse(messages[0]!).terminatedPids).toEqual([18163]);
    expect(lastFailure().terminatedPids).toEqual([18163]);
  });

  // E22
  it("counts a pid as signalled when the kill seam returns without throwing (no liveness probe)", () => {
    const { ws, messages } = makeMockWs();
    // Mirrors killProcess resolving `ok:false` for an already-dead pid: the
    // seam is fire-and-forget, so it simply returns.
    const kill = vi.fn(() => undefined);
    const findPids = vi.fn(() => [9001]);
    const w = new SpawnRegisterWatchdog(10000, { findPidsBySpawnToken: findPids, kill });
    w.arm({ cwd: "/p/e22", mechanism: "tmux", ws, spawnToken: TOKEN });
    vi.advanceTimersByTime(10001);

    expect(kill).toHaveBeenCalledTimes(1);
    expect(findPids).toHaveBeenCalledTimes(1);
    expect(JSON.parse(messages[0]!).terminatedPids).toEqual([9001]);
  });

  // X1
  it("a synchronously throwing kill for the only pid leaks no exception and emits no evidence", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000, {
      findPidsBySpawnToken: () => [],
      kill: () => {
        throw new Error("EPERM");
      },
    });
    w.arm({ pid: 31, cwd: "/p/x1", mechanism: "headless", ws });
    expect(() => vi.advanceTimersByTime(10001)).not.toThrow();

    expect(appendSpawnFailure).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(1);
    const msg = JSON.parse(messages[0]!);
    expect("terminated" in msg).toBe(false);
    expect("terminatedPids" in msg).toBe(false);
    expect("terminated" in lastFailure()).toBe(false);
    expect("terminatedPids" in lastFailure()).toBe(false);
  });

  // X2
  it("a failing appendSpawnFailure (disk full) after a successful reclaim still emits the message", () => {
    const { ws, messages } = makeMockWs();
    const kill = vi.fn();
    vi.mocked(appendSpawnFailure).mockImplementationOnce(() => {
      throw new Error("ENOSPC");
    });
    const w = new SpawnRegisterWatchdog(10000, { findPidsBySpawnToken: () => [4242], kill });
    w.arm({ pid: 4242, cwd: "/p/x2", mechanism: "headless", ws });
    expect(() => vi.advanceTimersByTime(10001)).not.toThrow();

    expect(kill).toHaveBeenCalledWith(4242);
    expect(messages).toHaveLength(1);
    const msg = JSON.parse(messages[0]!);
    expect(msg.terminated).toBe(true);
    expect(msg.terminatedPids).toEqual([4242]);
  });

  // X3
  it("reclaims strictly before appending the failure record, which already carries the pids", () => {
    const { ws } = makeMockWs();
    const kill = vi.fn();
    const w = new SpawnRegisterWatchdog(10000, { findPidsBySpawnToken: () => [4242], kill });
    w.arm({ pid: 4242, cwd: "/p/x3", mechanism: "headless", ws });
    vi.advanceTimersByTime(10001);

    const killOrder = kill.mock.invocationCallOrder[0]!;
    const appendOrder = vi.mocked(appendSpawnFailure).mock.invocationCallOrder[0]!;
    expect(killOrder).toBeLessThan(appendOrder);
    expect(lastFailure().terminatedPids).toEqual([4242]);
  });

  // X4
  it("a closed browser socket still kills and records the evidence, but sends nothing", () => {
    const { ws, messages } = makeMockWs(WebSocket.CLOSED);
    const kill = vi.fn();
    const w = new SpawnRegisterWatchdog(10000, { findPidsBySpawnToken: () => [4242], kill });
    w.arm({ pid: 4242, cwd: "/p/x4", mechanism: "headless", ws });
    vi.advanceTimersByTime(10001);

    expect(kill).toHaveBeenCalledWith(4242);
    expect(lastFailure().terminated).toBe(true);
    expect(lastFailure().terminatedPids).toEqual([4242]);
    expect(messages).toHaveLength(0);
  });

  // X5
  it("a throwing findPidsBySpawnToken still logs and emits, with no terminated evidence", () => {
    const { ws, messages } = makeMockWs();
    const w = new SpawnRegisterWatchdog(10000, {
      findPidsBySpawnToken: () => {
        throw new Error("ps unavailable");
      },
      kill: vi.fn(),
    });
    w.arm({ cwd: "/p/x5", mechanism: "tmux", ws, spawnToken: TOKEN });
    expect(() => vi.advanceTimersByTime(10001)).not.toThrow();

    expect(appendSpawnFailure).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(1);
    expect("terminated" in JSON.parse(messages[0]!)).toBe(false);
    expect("terminated" in lastFailure()).toBe(false);
  });
});
