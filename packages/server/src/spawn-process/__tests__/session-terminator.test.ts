/**
 * Shared session terminator (test-plan #X1–#X6, #E4–#E11, #E23–#E31, #P1, #P3).
 *
 * The OS boundary (liveness, signalling, start time, token scan) is a fake
 * process table; the terminator itself runs for real.
 * See change: fix-session-reclaim-tmux.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import {
  createSessionTerminator,
  IDENTITY_TOLERANCE_MS,
  type TerminateOptions,
} from "../session-terminator.js";

const T = 1_700_000_000_000;

interface World {
  alive: Set<number>;
  /** pids that exit when killProcess is called on them. */
  dieOnKill: Set<number>;
  /** pids that exit when the registry kill runs. */
  dieOnRegistryKill: Set<number>;
  eperm: Set<number>;
  started: Map<number, number | null>;
  tokenPids: Map<string, number[]>;
}

function setup(
  opts: {
    session?: Partial<DashboardSession> | null;
    registryPid?: number;
    registryKillResult?: boolean;
    world?: Partial<World>;
    platform?: NodeJS.Platform;
  } = {},
) {
  const world: World = {
    alive: new Set(),
    dieOnKill: new Set(),
    dieOnRegistryKill: new Set(),
    eperm: new Set(),
    started: new Map(),
    tokenPids: new Map(),
    ...opts.world,
  };
  const record: DashboardSession | undefined =
    opts.session === null
      ? undefined
      : ({ id: "s1", status: "idle", pid: 100, pidRecordedAt: T, ...opts.session } as DashboardSession);
  const updates: Array<Partial<DashboardSession>> = [];
  const sessionManager = {
    get: (id: string) => (id === "s1" ? record : undefined),
    update: vi.fn((_id: string, u: Partial<DashboardSession>) => {
      updates.push(u);
      if (record) Object.assign(record, u);
    }),
  };
  const killProcess = vi.fn(async (pid: number) => {
    if (world.dieOnKill.has(pid)) world.alive.delete(pid);
    return { ok: world.alive.has(pid) ? false : true, forced: false };
  });
  const signalZero = vi.fn((pid: number) =>
    world.alive.has(pid) ? (world.eperm.has(pid) ? ("other-errno" as const) : ("alive" as const)) : ("esrch" as const),
  );
  const registry = {
    getPid: vi.fn(() => opts.registryPid),
    killBySessionId: vi.fn(async () => {
      for (const p of world.dieOnRegistryKill) world.alive.delete(p);
      return opts.registryKillResult ?? opts.registryPid !== undefined;
    }),
    killByToken: vi.fn(async () => false),
  };
  const warn = vi.fn();
  const { terminate } = createSessionTerminator({
    sessionManager,
    headlessPidRegistry: registry,
    signalZero,
    killProcess: killProcess as never,
    processStartedAt: (pid) => (world.started.has(pid) ? (world.started.get(pid) ?? null) : null),
    findPidsBySpawnToken: (tok) => world.tokenPids.get(tok) ?? [],
    platform: opts.platform ?? "linux",
    sleep: async () => {},
    warn,
  });
  return { terminate, world, record, updates, sessionManager, killProcess, signalZero, registry, warn };
}

const unattended: TerminateOptions = { graceMs: 0, verifyIdentity: true, stampManualClose: true };

describe("session terminator — registry miss (the #459 bug)", () => {
  // X1 / task 1.3: no registry entry, live verified session.pid.
  it("kills a verified session.pid with no registry entry and confirms death", async () => {
    const h = setup({ world: { alive: new Set([100]), dieOnKill: new Set([100]), started: new Map([[100, T - 5000]]) } });
    const r = await h.terminate("s1", unattended);
    expect(h.registry.killBySessionId).toHaveBeenCalledWith("s1"); // attempt, returns false
    expect(h.killProcess).toHaveBeenCalledWith(100, { timeoutMs: 2000 });
    expect(r).toEqual({ outcome: "confirmed-dead", terminated: true, pid: 100 });
  });

  // X2 / task 1.2: registry "issued" is not "dead".
  it("does not read a registry hit as a verdict: survivor is unconfirmed", async () => {
    const h = setup({
      registryPid: 100,
      registryKillResult: true,
      world: { alive: new Set([100]), started: new Map([[100, T - 5000]]) },
    });
    const r = await h.terminate("s1", unattended);
    expect(r).toMatchObject({ outcome: "unconfirmed", terminated: false, pid: 100 });
  });

  // X3: registry pid used when the record holds none.
  it("falls back to the registry pid when the record has no pid", async () => {
    const h = setup({ session: { pid: undefined }, registryPid: 777, world: { alive: new Set([777]) } });
    const r = await h.terminate("s1", unattended);
    expect(r).toMatchObject({ outcome: "unconfirmed", pid: 777 });
  });

  // X4 / P3: already gone after the registry kill → one probe, no signal, no guard.
  it("reports confirmed-dead with exactly one probe and no signal when already gone", async () => {
    const h = setup({
      registryPid: 100,
      world: { alive: new Set([100]), dieOnRegistryKill: new Set([100]), started: new Map([[100, T + 99999]]) },
    });
    const r = await h.terminate("s1", unattended);
    expect(r.outcome).toBe("confirmed-dead");
    expect(h.signalZero).toHaveBeenCalledTimes(1);
    expect(h.killProcess).not.toHaveBeenCalled();
  });

  // X6: EPERM-live is alive, never dead.
  it("never reads an EPERM-live pid as dead", async () => {
    const h = setup({
      world: { alive: new Set([100]), eperm: new Set([100]), started: new Map([[100, T - 1]]) },
    });
    h.killProcess.mockResolvedValue({ ok: false, forced: false });
    const r = await h.terminate("s1", unattended);
    expect(r.outcome).toBe("unconfirmed");
    expect(r.terminated).toBe(false);
  });
});

describe("session terminator — identity guard", () => {
  // E4 boundary: <= pidRecordedAt + 2000
  it.each([
    [T + IDENTITY_TOLERANCE_MS - 1, true],
    [T + IDENTITY_TOLERANCE_MS, true],
    [T + IDENTITY_TOLERANCE_MS + 1, false],
    [T - 3_600_000, true], // E5: pi started an hour before it registered
  ])("start time %s → signalled=%s", async (started, signalled) => {
    const h = setup({ world: { alive: new Set([100]), dieOnKill: new Set([100]), started: new Map([[100, started]]) } });
    const r = await h.terminate("s1", unattended);
    if (signalled) {
      expect(h.killProcess).toHaveBeenCalledWith(100, { timeoutMs: 2000 });
    } else {
      expect(r.outcome).toBe("refused-identity");
      expect(h.killProcess).not.toHaveBeenCalled();
      expect(h.warn.mock.calls.join("\n")).toContain("pid reused");
    }
  });

  // E6 / E7: unverifiable start time ⇒ refuse with a diagnostic naming the platform.
  it.each(["linux", "win32"] as const)("refuses an unverifiable start time on %s", async (platform) => {
    const h = setup({ platform, world: { alive: new Set([100]) } }); // started map empty → null
    const r = await h.terminate("s1", unattended);
    expect(r).toMatchObject({ outcome: "refused-identity", terminated: false, pid: 100 });
    expect(h.killProcess).not.toHaveBeenCalled();
    expect(h.warn.mock.calls.join("\n")).toContain(`identity unverifiable on ${platform}`);
  });

  // E8: no stamp ⇒ unverifiable.
  it("refuses a record that has a pid but no pidRecordedAt", async () => {
    const h = setup({
      session: { pidRecordedAt: undefined },
      world: { alive: new Set([100]), started: new Map([[100, T - 1]]) },
    });
    const r = await h.terminate("s1", unattended);
    expect(r.outcome).toBe("refused-identity");
    expect(h.killProcess).not.toHaveBeenCalled();
  });

  // X5: dies between the liveness probe and the identity check.
  it("reports confirmed-dead, not refused, when the pid dies before the identity check", async () => {
    const h = setup({ world: { alive: new Set([100]) } });
    let probes = 0;
    h.signalZero.mockImplementation(() => (++probes === 1 ? "alive" : "esrch"));
    const r = await h.terminate("s1", unattended);
    expect(r.outcome).toBe("confirmed-dead");
    expect(h.killProcess).not.toHaveBeenCalled();
  });

  // E9 / E10: a registry-reached pid is exempt (restored entries included).
  it("does not start-time-check a registry-owned pid", async () => {
    const h = setup({
      session: { pid: undefined },
      registryPid: 555,
      world: { alive: new Set([555]), dieOnKill: new Set([555]), started: new Map([[555, T + 10 ** 9]]) },
    });
    const r = await h.terminate("s1", unattended);
    expect(h.killProcess).toHaveBeenCalledWith(555, { timeoutMs: 2000 });
    expect(r.outcome).toBe("confirmed-dead");
  });

  // E11: the operator path keeps its shipped signalling.
  it("skips the guard when verifyIdentity is false (shutdown)", async () => {
    const h = setup({ platform: "win32", world: { alive: new Set([100]), dieOnKill: new Set([100]) } });
    const r = await h.terminate("s1", { graceMs: 0, verifyIdentity: false });
    expect(h.killProcess).toHaveBeenCalledWith(100, { timeoutMs: 2000 });
    expect(r.outcome).toBe("confirmed-dead");
  });
});

describe("session terminator — no identity / token rung", () => {
  // E23
  it("reports no-identity and signals nothing when no pid is held", async () => {
    const h = setup({ session: { pid: undefined } });
    const r = await h.terminate("s1", unattended);
    expect(r).toEqual({ outcome: "no-identity", terminated: false });
    expect(h.killProcess).not.toHaveBeenCalled();
  });

  // E24
  it("reclaims a never-registered spawn by token", async () => {
    const h = setup({
      session: null,
      world: { alive: new Set([9]), dieOnKill: new Set([9]), tokenPids: new Map([["tok-12345678", [9]]]) },
    });
    const r = await h.terminate("s1", { ...unattended, spawnToken: "tok-12345678" });
    expect(h.killProcess).toHaveBeenCalledTimes(1);
    expect(h.killProcess).toHaveBeenCalledWith(9, { timeoutMs: 2000 });
    expect(r.outcome).toBe("confirmed-dead");
  });

  // E25
  it("is no-identity when the token matches nothing", async () => {
    const h = setup({ session: null });
    const r = await h.terminate("s1", { ...unattended, spawnToken: "tok-12345678" });
    expect(r.outcome).toBe("no-identity");
    expect(h.killProcess).not.toHaveBeenCalled();
  });

  // E26
  it("is unconfirmed while any token-matched pid survives", async () => {
    const h = setup({
      session: null,
      world: {
        alive: new Set([1, 2]),
        dieOnKill: new Set([1]),
        tokenPids: new Map([["tok-12345678", [1, 2]]]),
      },
    });
    const r = await h.terminate("s1", { ...unattended, spawnToken: "tok-12345678" });
    expect(h.killProcess).toHaveBeenCalledWith(1, { timeoutMs: 2000 });
    expect(h.killProcess).toHaveBeenCalledWith(2, { timeoutMs: 2000 });
    expect(r).toMatchObject({ outcome: "unconfirmed", pid: 2 });
  });

  it("supports a token-only call (empty session id)", async () => {
    const h = setup({
      world: { alive: new Set([9]), dieOnKill: new Set([9]), tokenPids: new Map([["tok-12345678", [9]]]) },
    });
    const r = await h.terminate("", { ...unattended, spawnToken: "tok-12345678" });
    expect(r.outcome).toBe("confirmed-dead");
    expect(h.registry.killBySessionId).not.toHaveBeenCalled();
    expect(h.sessionManager.update).not.toHaveBeenCalled();
  });
});

describe("session terminator — manual close stamp (D10)", () => {
  // E27
  it("stamps manual before signalling", async () => {
    const h = setup({ world: { alive: new Set([100]), dieOnKill: new Set([100]), started: new Map([[100, T]]) } });
    let reasonAtSignal: unknown;
    h.killProcess.mockImplementation(async (pid: number) => {
      reasonAtSignal = h.record?.closedReason;
      h.world.alive.delete(pid);
      return { ok: true, forced: false };
    });
    await h.terminate("s1", unattended);
    expect(reasonAtSignal).toBe("manual");
    expect(h.record?.closedReason).toBe("manual");
  });

  // E28
  it("withdraws the stamp when the kill is not confirmed and the record has not ended", async () => {
    const h = setup({ world: { alive: new Set([100]), started: new Map([[100, T]]) } });
    await h.terminate("s1", unattended);
    expect(h.record?.closedReason).toBeUndefined();
  });

  // E29
  it("never overwrites or withdraws an existing reason", async () => {
    const h = setup({
      session: { closedReason: "process_gone" },
      world: { alive: new Set([100]), started: new Map([[100, T]]) },
    });
    await h.terminate("s1", unattended);
    expect(h.record?.closedReason).toBe("process_gone");
  });

  // E30
  it("keeps the stamp when the record ended during an unconfirmed kill", async () => {
    const h = setup({ world: { alive: new Set([100]), started: new Map([[100, T]]) } });
    h.killProcess.mockImplementation(async () => {
      if (h.record) h.record.status = "ended";
      return { ok: false, forced: false };
    });
    await h.terminate("s1", unattended);
    expect(h.record?.closedReason).toBe("manual");
  });

  // E31
  it("does not touch the session manager when there is no record", async () => {
    const h = setup({
      session: null,
      world: { alive: new Set([9]), dieOnKill: new Set([9]), tokenPids: new Map([["tok-12345678", [9]]]) },
    });
    await expect(h.terminate("s1", { ...unattended, spawnToken: "tok-12345678" })).resolves.toBeDefined();
    expect(h.sessionManager.update).not.toHaveBeenCalled();
  });

  it("does not stamp for the operator path", async () => {
    const h = setup({ world: { alive: new Set([100]), dieOnKill: new Set([100]) } });
    await h.terminate("s1", { graceMs: 0, verifyIdentity: false });
    expect(h.sessionManager.update).not.toHaveBeenCalled();
  });
});

describe("session terminator — grace window", () => {
  // P1: the reaper passes graceMs 0 → no wait before signalling.
  it("signals immediately with graceMs 0 (no SHUTDOWN_GRACE_MS wait)", async () => {
    const h = setup({ world: { alive: new Set([100]), dieOnKill: new Set([100]), started: new Map([[100, T]]) } });
    await h.terminate("s1", { ...unattended, graceMs: 0 });
    expect(h.killProcess).toHaveBeenCalledTimes(1);
  });

  it("returns confirmed-dead without signalling when the pid exits inside the grace window", async () => {
    let t = 0;
    const world: World = {
      alive: new Set([100]),
      dieOnKill: new Set(),
      dieOnRegistryKill: new Set(),
      eperm: new Set(),
      started: new Map(),
      tokenPids: new Map(),
    };
    const killProcess = vi.fn(async () => ({ ok: true, forced: false }));
    const { terminate } = createSessionTerminator({
      sessionManager: { get: () => ({ id: "s1", pid: 100 }) as DashboardSession, update: vi.fn() },
      headlessPidRegistry: { getPid: () => undefined, killBySessionId: async () => false },
      signalZero: (pid) => (world.alive.has(pid) ? "alive" : "esrch"),
      killProcess: killProcess as never,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
        if (t >= 300) world.alive.delete(100);
      },
    });
    const r = await terminate("s1", { graceMs: 1500, verifyIdentity: false });
    expect(r.outcome).toBe("confirmed-dead");
    expect(killProcess).not.toHaveBeenCalled();
  });
});
