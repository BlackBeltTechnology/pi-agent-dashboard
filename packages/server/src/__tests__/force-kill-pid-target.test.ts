/**
 * Force-kill resolves the recorded pid's target before it closes the bridge or
 * signals anything. A non-local target (and `unknown` on POSIX) is REFUSED: no
 * signal, no WebSocket close, not marked ended, `success:false`. `unknown` on a
 * Windows server keeps today's signal (Q8). No pid ⇒ the no-pid branch runs
 * first (S2).
 * Test-plan rows E91, X30–X41, X103. See change: scope-pids-to-namespace.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DashboardSession, PidNamespace } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerPidContext } from "../session/pid-target.js";
import * as pidTarget from "../session/pid-target.js";

const order: string[] = [];
const killProcessSpy = vi.fn(async (pid: number, _opts?: unknown) => {
  order.push(`kill:${pid}`);
  return { ok: true, forced: false };
});
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, killProcess: (pid: number, opts?: unknown) => killProcessSpy(pid, opts) };
});

const { forceKillSession } = await import("../browser-handlers/session-action-handler.js");
const { shutdownSession } = await import("../browser-handlers/session-action-handler.js");

const SL: ServerPidContext = { platform: "linux", hostId: "boot-A", nsId: "pid:[4026531836]" };
const SW: ServerPidContext = { platform: "win32", hostId: "WINBOX" };
const RL: PidNamespace = { platform: "linux", kind: "host", hostId: "boot-A", nsId: "pid:[4026531836]" };
const RL_WSL: PidNamespace = {
  platform: "linux",
  kind: "wsl",
  distro: "Ubuntu-24.04",
  hostId: "boot-W",
  nsId: "pid:[4026531840]",
};

function make(over: Partial<DashboardSession>, ctx: ServerPidContext = SL, registryPid?: number) {
  let record: DashboardSession = { id: "s1", cwd: "/home/u/p", status: "active", pid: 4242, ...over } as DashboardSession;
  const broadcasts: Array<{ type: string; updates?: Record<string, unknown> }> = [];
  const resolve = vi.fn(pidTarget.resolvePidTarget);
  const deps = {
    sessionManager: {
      get: vi.fn(() => record),
      update: vi.fn((_id: string, u: Partial<DashboardSession>) => {
        record = { ...record, ...u };
      }),
      unregister: vi.fn(),
    },
    piGateway: {
      closeSession: vi.fn(() => {
        order.push("close");
        return true;
      }),
      sendToSession: vi.fn(),
    },
    headlessPidRegistry: {
      getPid: vi.fn(() => registryPid),
      killBySessionId: vi.fn(async () => false),
    },
    broadcast: vi.fn((m: { type: string; updates?: Record<string, unknown> }) => broadcasts.push(m)),
    pidContext: ctx,
    resolvePidTarget: (...a: Parameters<typeof pidTarget.resolvePidTarget>) => {
      order.push("resolve");
      return resolve(...a);
    },
  };
  const replace = (next: DashboardSession) => {
    record = next;
  };
  return { deps: deps as never, raw: deps, broadcasts, resolve, current: () => record, replace };
}

function expectRefused(r: { success: boolean; message: string }, w: ReturnType<typeof make>) {
  expect(r.success).toBe(false);
  expect(r.message).toMatch(/not on this host/);
  expect(killProcessSpy).not.toHaveBeenCalled();
  expect(w.raw.piGateway.closeSession).not.toHaveBeenCalled();
  expect(w.current().status).toBe("active");
  expect(w.broadcasts.some((b) => b.type === "session_updated" && b.updates?.status === "ended")).toBe(false);
}

beforeEach(() => {
  order.length = 0;
  killProcessSpy.mockClear();
});

describe("force-kill — refusals", () => {
  it("X30: a remote-origin session is refused", async () => {
    const w = make({ originDeviceId: "dev-remote-1" });
    expectRefused(await forceKillSession("s1", w.deps), w);
  });

  it("X31: WSL on a win32 server never reaches taskkill", async () => {
    const w = make({ pidNamespace: RL_WSL }, SW);
    expectRefused(await forceKillSession("s1", w.deps), w);
  });

  it("X32: legacy WSL (POSIX cwd) on win32 is refused", async () => {
    const w = make({ cwd: "/home/u/p" }, SW);
    expectRefused(await forceKillSession("s1", w.deps), w);
  });

  it("X33: unknown on POSIX is refused", async () => {
    const w = make({ pidNamespace: RL }, { platform: "linux", hostId: "boot-A" });
    expectRefused(await forceKillSession("s1", w.deps), w);
  });

  it("X36: the refusal never closes the bridge, even after awaits", async () => {
    const w = make({ originDeviceId: "dev-remote-1" });
    await forceKillSession("s1", w.deps);
    await new Promise((r) => setTimeout(r, 20));
    expect(w.raw.piGateway.closeSession).not.toHaveBeenCalled();
    expect(w.raw.sessionManager.update).not.toHaveBeenCalled();
  });

  it("X39: a refused force-kill does not run the registry rung either", async () => {
    const w = make({ originDeviceId: "dev-remote-1" }, SL, 4242);
    await forceKillSession("s1", w.deps);
    expect(killProcessSpy).not.toHaveBeenCalled();
    expect(w.raw.headlessPidRegistry.killBySessionId).not.toHaveBeenCalled();
  });

  it("X38: force-kill refused, then shutdown reports the orphan", async () => {
    const w = make({ originDeviceId: "dev-remote-1" });
    expect((await forceKillSession("s1", w.deps)).success).toBe(false);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await shutdownSession("s1", w.deps);
    err.mockRestore();
    expect(w.broadcasts.map((b) => b.type)).toEqual(["session_orphaned", "session_removed"]);
    expect(w.broadcasts[0]).toMatchObject({ pid: 4242 });
  });
});

describe("force-kill — signalled targets", () => {
  it("X34: unknown on win32 keeps today's signal (Q8)", async () => {
    const w = make({ cwd: "C:\\p" }, SW);
    const r = await forceKillSession("s1", w.deps);
    expect(killProcessSpy).toHaveBeenCalledTimes(1);
    expect(killProcessSpy).toHaveBeenCalledWith(4242, { timeoutMs: 2000 });
    expect(w.raw.piGateway.closeSession).toHaveBeenCalledTimes(1);
    expect(w.current().status).toBe("ended");
    expect(r.success).toBe(true);
  });

  it("X35: host — resolve, then kill, then close", async () => {
    const w = make({ pidNamespace: RL });
    const r = await forceKillSession("s1", w.deps);
    expect(order).toEqual(["resolve", "kill:4242", "close"]);
    expect(r.success).toBe(true);
  });

  it("E91: an old bridge on a POSIX server is killed as before", async () => {
    const w = make({});
    await forceKillSession("s1", w.deps);
    expect(killProcessSpy).toHaveBeenCalledWith(4242, { timeoutMs: 2000 });
  });

  it("X37: the kill uses the snapshot taken at resolution, not a replaced record", async () => {
    const w = make({ pid: 100, pidNamespace: RL });
    killProcessSpy.mockImplementationOnce(async (pid: number) => {
      order.push(`kill:${pid}`);
      w.replace({ id: "s1", cwd: "/x", status: "active", pid: 5555, pidNamespace: RL_WSL } as DashboardSession);
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, forced: false };
    });
    await forceKillSession("s1", w.deps);
    expect(killProcessSpy.mock.calls.map((c) => c[0])).toEqual([100]);
  });
});

describe("force-kill — no pid (S2)", () => {
  it("X103: no pid ⇒ the WS-only branch, before any resolution", async () => {
    for (const over of [
      { pid: undefined, originDeviceId: "dev-remote-1" },
      { pid: undefined, pidNamespace: RL_WSL },
    ] as Array<Partial<DashboardSession>>) {
      const w = make(over, SW);
      const r = await forceKillSession("s1", w.deps);
      expect(w.resolve).not.toHaveBeenCalled();
      expect(w.raw.piGateway.closeSession).toHaveBeenCalledTimes(1);
      expect(r).toMatchObject({ success: true, message: expect.stringMatching(/no PID/) });
      expect(killProcessSpy).not.toHaveBeenCalled();
    }
  });
});

/**
 * @structural-pin the no-direct-process-kill invariant is a property of the handler source text, not of runtime behaviour
 */
describe("force-kill — regression invariants", () => {
  it("X41/X75: the handler calls no process.kill directly", () => {
    const src = readFileSync(join(__dirname, "..", "browser-handlers", "session-action-handler.ts"), "utf8");
    expect(src).not.toMatch(/process\.kill\(/);
  });
});
