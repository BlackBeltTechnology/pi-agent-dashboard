/**
 * Unit tests for boot-parent-liveness.
 *
 * Tier 1 (all platforms) is exercised by mocking the shared `isProcessAlive`.
 * On CI (macOS/Linux) the win32 Tier-2 koffi branch never runs, so
 * `computeBootParentAlive()` always resolves via Tier 1 — which is exactly the
 * fallback path we assert here. Tier-2 happy-path is Windows-manual-QA only
 * (koffi/kernel32 cannot be faithfully mocked cross-platform).
 *
 * See change: electron-attach-ownership-fixes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const isProcessAlive = vi.fn<(pid: number) => boolean>();

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/process.js")>();
  return { ...actual, isProcessAlive: (pid: number) => isProcessAlive(pid) };
});

import { startEphemeralParentWatch } from "../lifecycle/ephemeral-parent-watch.js";
import { bootParentPid } from "../lifecycle/boot-parent-liveness.js";

describe("computeBootParentAlive (Tier 1)", () => {
  beforeEach(() => {
    isProcessAlive.mockReset();
  });

  it("returns true when isProcessAlive(bootParentPid) is true", async () => {
    isProcessAlive.mockReturnValue(true);
    const { computeBootParentAlive } = await import("../lifecycle/boot-parent-liveness.js");
    expect(computeBootParentAlive()).toBe(true);
  });

  it("returns false when isProcessAlive(bootParentPid) is false", async () => {
    isProcessAlive.mockReturnValue(false);
    const { computeBootParentAlive } = await import("../lifecycle/boot-parent-liveness.js");
    expect(computeBootParentAlive()).toBe(false);
  });

  it("does not throw and returns a boolean", async () => {
    isProcessAlive.mockReturnValue(true);
    const { computeBootParentAlive } = await import("../lifecycle/boot-parent-liveness.js");
    expect(typeof computeBootParentAlive()).toBe("boolean");
  });

  it("bootParentPid is a number and readLivePpid returns a number", async () => {
    const mod = await import("../lifecycle/boot-parent-liveness.js");
    expect(typeof mod.bootParentPid).toBe("number");
    expect(typeof mod.readLivePpid()).toBe("number");
  });
});

// ─── fix-autostart-discovery-precedence (D5/D6, folded test-plan X4–X10) ────

const ESRCH = Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
const EPERM = Object.assign(new Error("kill EPERM"), { code: "EPERM" });
const EINVAL = Object.assign(new Error("kill EINVAL"), { code: "EINVAL" });

describe("isBootParentProvablyDead — kill-decision liveness (D6)", () => {
  it("X4-unit: ESRCH is proof of absence → dead", async () => {
    const { isBootParentProvablyDead } = await import("../lifecycle/boot-parent-liveness.js");
    expect(isBootParentProvablyDead({ kill: (_pid, _signal) => { throw ESRCH; } })).toBe(true);
  });

  it("X6-unit: EPERM (alive but hardened/other-user) is NOT death → alive", async () => {
    const { isBootParentProvablyDead } = await import("../lifecycle/boot-parent-liveness.js");
    expect(isBootParentProvablyDead({ kill: () => { throw EPERM; } })).toBe(false);
  });

  it("any non-ESRCH errno is NOT death → alive", async () => {
    const { isBootParentProvablyDead } = await import("../lifecycle/boot-parent-liveness.js");
    expect(isBootParentProvablyDead({ kill: () => { throw EINVAL; } })).toBe(false);
  });

  it("X7-unit: a signal-0 success on a recycled PID reads alive → exit deferred", async () => {
    const { isBootParentProvablyDead } = await import("../lifecycle/boot-parent-liveness.js");
    expect(isBootParentProvablyDead({ kill: () => { /* alive */ } })).toBe(false);
  });

  it("X8-unit: the reuse-immune Tier-2 verdict is authoritative over a Tier-1 alive", async () => {
    const { isBootParentProvablyDead } = await import("../lifecycle/boot-parent-liveness.js");
    expect(
      isBootParentProvablyDead({
        tier2SignalledExit: () => true, // original parent exited
        kill: () => { /* Tier-1 reads the RECYCLED pid as alive */ },
      }),
    ).toBe(true);
  });

  it("Tier-2 alive wins too (authoritative in both directions)", async () => {
    const { isBootParentProvablyDead } = await import("../lifecycle/boot-parent-liveness.js");
    expect(
      isBootParentProvablyDead({
        tier2SignalledExit: () => false,
        kill: () => { throw ESRCH; }, // Tier-1 disagrees — ignored
      }),
    ).toBe(false);
  });

  it("Tier-2 unavailable (null) falls back to Tier-1", async () => {
    const { isBootParentProvablyDead } = await import("../lifecycle/boot-parent-liveness.js");
    expect(
      isBootParentProvablyDead({ tier2SignalledExit: () => null, kill: () => { throw ESRCH; } }),
    ).toBe(true);
  });
});

describe("ephemeral parent watch (D5)", () => {
  const tick = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));

  function makeWatchDeps(over: Partial<Parameters<typeof startEphemeralParentWatch>[0]> = {}) {
    return {
      isEphemeral: over.isEphemeral ?? (() => true),
      isParentProvablyDead: over.isParentProvablyDead ?? (() => true),
      onParentDead: over.onParentDead ?? (async () => {}),
      intervalMs: 5,
      // CodeRabbit fix: a no-op default keeps non-fallback tests from
      // scheduling the PRODUCTION process.exit(0) fallback (it fires 5s
      // after a resolved graceful stop and is NOT cancelled by watch.stop()
      // — a reused vitest worker would be terminated mid-run). The fallback
      // test overrides this explicitly.
      hardExit: vi.fn(),
      log: over.log ?? (() => {}),
      ...over,
    };
  }

  it("X4: ephemeral + proven-dead parent → graceful stop invoked, naming the parent", async () => {
    const onParentDead = vi.fn(async () => {});
    const log = vi.fn();
    const watch = startEphemeralParentWatch(makeWatchDeps({ onParentDead, log }));
    watch.start();
    await tick();
    watch.stop();

    expect(onParentDead).toHaveBeenCalledTimes(1);
    const line = log.mock.calls.map((c) => c[0] as string).join("\n");
    expect(line).toMatch(/boot parent/i);
    expect(line).toContain(String(bootParentPid));
  });

  it("X5: NOT ephemeral → dead parent never stops the server (watch never arms)", async () => {
    const onParentDead = vi.fn(async () => {});
    const watch = startEphemeralParentWatch(
      makeWatchDeps({ isEphemeral: () => false, onParentDead }),
    );
    watch.start();
    await tick();
    watch.stop();

    expect(onParentDead).not.toHaveBeenCalled();
  });

  it("X6/X7: alive-biased probe (EPERM/recycled PID) → no stop", async () => {
    const onParentDead = vi.fn(async () => {});
    const watch = startEphemeralParentWatch(
      makeWatchDeps({ isParentProvablyDead: () => false, onParentDead }),
    );
    watch.start();
    await tick();
    watch.stop();

    expect(onParentDead).not.toHaveBeenCalled();
  });

  it("X8: Tier-2-dead verdict (via the injected kill-decision probe) → stop fires", async () => {
    const onParentDead = vi.fn(async () => {});
    // The consumer composes the kill-decision helper; tier-2 authority was
    // proven at unit level above. Here the composed verdict is "dead".
    const watch = startEphemeralParentWatch(
      makeWatchDeps({ isParentProvablyDead: () => true, onParentDead }),
    );
    watch.start();
    await tick();
    watch.stop();

    expect(onParentDead).toHaveBeenCalledTimes(1);
  });

  it("X9: not inferred — env var alone never arms the watch (flag-only opt-in)", async () => {
    const prev = process.env.PI_DASHBOARD_EPHEMERAL;
    process.env.PI_DASHBOARD_EPHEMERAL = "1";
    try {
      const { buildConfig } = await import("../cli.js");
      const config = buildConfig({});
      // Flag NOT passed → NOT ephemeral, no matter what the env says.
      expect(config.ephemeral).toBeFalsy();
      // …and a server so configured is unaffected by a dead parent (X5 path).
      const onParentDead = vi.fn(async () => {});
      const watch = startEphemeralParentWatch(
        makeWatchDeps({ isEphemeral: () => config.ephemeral === true, onParentDead }),
      );
      watch.start();
      await tick();
      watch.stop();
      expect(onParentDead).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.PI_DASHBOARD_EPHEMERAL;
      else process.env.PI_DASHBOARD_EPHEMERAL = prev;
    }
  });

  it("fires at most once, then disarms itself", async () => {
    const onParentDead = vi.fn(async () => {});
    const watch = startEphemeralParentWatch(makeWatchDeps({ onParentDead }));
    watch.start();
    await tick(80);
    watch.stop();

    expect(onParentDead).toHaveBeenCalledTimes(1);
  });

  it("doubt-review fix: arms a hard-exit fallback after the graceful stop resolves", async () => {
    const onParentDead = vi.fn(async () => {});
    const hardExit = vi.fn();
    const log = vi.fn();
    const watch = startEphemeralParentWatch(
      makeWatchDeps({ onParentDead, hardExit, log, exitGraceMs: 10 }),
    );
    watch.start();
    await tick(40); // tick fires → graceful stop resolves → grace elapses
    watch.stop();

    expect(onParentDead).toHaveBeenCalledTimes(1);
    expect(hardExit).toHaveBeenCalledTimes(1); // zombie-handle last resort
    const line = log.mock.calls.map((c) => c[0] as string).join("\n");
    expect(line).toMatch(/exiting hard/);
  });

  it("X10: ephemeral state is visible in /api/health", async () => {
    const { createTestServer } = await import("../test-support/test-server.js");
    const handle = await createTestServer({ ephemeral: true });
    try {
      const res = await fetch(`http://127.0.0.1:${handle.httpPort}/api/health`);
      const body = await res.json() as Record<string, unknown>;
      expect(body.ephemeral).toBe(true);
    } finally {
      await handle.stop();
    }
  });

  it("X10b: a default (non-ephemeral) server reports ephemeral: false", async () => {
    const { createTestServer } = await import("../test-support/test-server.js");
    const handle = await createTestServer();
    try {
      const res = await fetch(`http://127.0.0.1:${handle.httpPort}/api/health`);
      const body = await res.json() as Record<string, unknown>;
      expect(body.ephemeral).toBe(false);
    } finally {
      await handle.stop();
    }
  });
});
