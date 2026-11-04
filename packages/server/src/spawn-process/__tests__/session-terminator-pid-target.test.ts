/**
 * The terminator resolves the recorded pid's target ONCE, before its registry
 * rung, and only `host` is probed or signalled (unattended); an operator may
 * also signal `unknown` on a Windows server (Q8). Non-local operator shutdowns
 * are `not-local`, but the registry rung still runs (S8).
 * Test-plan rows X1–X15, X100–X102. See change: scope-pids-to-namespace.
 */
import type { DashboardSession, PidNamespace } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import type { ServerPidContext } from "../../session/pid-target.js";
import * as pidTarget from "../../session/pid-target.js";
import { createSessionTerminator, type TerminateOptions } from "../session-terminator.js";

const T = 1_700_000_000_000;
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

const UNATTENDED: TerminateOptions = { operator: false, verifyIdentity: true, graceMs: 0 };
const OPERATOR: TerminateOptions = { operator: true, verifyIdentity: false, graceMs: 0 };

function setup(o: {
  session?: Partial<DashboardSession> | null;
  ctx?: ServerPidContext;
  registryPid?: number;
  /** the registry kill removes the entry (getPid → undefined afterwards) */
  registryKillDeletes?: boolean;
  alive?: number[];
  esrch?: boolean;
  tokenPids?: number[];
  resolveSpy?: typeof pidTarget.resolvePidTarget;
} = {}) {
  const alive = new Set(o.alive ?? [4242]);
  const record =
    o.session === null
      ? undefined
      : ({ id: "s1", status: "active", cwd: "/home/u/p", pid: 4242, pidRecordedAt: T, ...o.session } as DashboardSession);
  let regPid = o.registryPid;
  const sessionManager = {
    get: (id: string) => (id === "s1" ? record : undefined),
    update: vi.fn((_id: string, u: Partial<DashboardSession>) => {
      if (record) Object.assign(record, u);
    }),
  };
  const signalZero = vi.fn((pid: number) => (o.esrch || !alive.has(pid) ? ("esrch" as const) : ("alive" as const)));
  const killProcess = vi.fn(async (pid: number) => {
    alive.delete(pid);
    return { ok: true, forced: false };
  });
  const processStartedAt = vi.fn(() => T);
  const registry = {
    getPid: vi.fn(() => regPid),
    killBySessionId: vi.fn(async () => {
      if (o.registryKillDeletes) regPid = undefined;
      return true;
    }),
    killByToken: vi.fn(async () => true),
  };
  const resolve = vi.fn(o.resolveSpy ?? pidTarget.resolvePidTarget);
  const { terminate } = createSessionTerminator({
    sessionManager,
    headlessPidRegistry: registry,
    signalZero,
    killProcess: killProcess as never,
    processStartedAt,
    findPidsBySpawnToken: () => o.tokenPids ?? [],
    platform: (o.ctx ?? SL).platform as NodeJS.Platform,
    pidContext: o.ctx ?? SL,
    resolvePidTarget: resolve,
    sleep: async () => {},
    warn: () => {},
  });
  const spiesZero = () => {
    expect(signalZero).not.toHaveBeenCalled();
    expect(processStartedAt).not.toHaveBeenCalled();
    expect(killProcess).not.toHaveBeenCalled();
  };
  return { terminate, signalZero, killProcess, processStartedAt, registry, resolve, spiesZero, record };
}

const FOREIGN = { originDeviceId: "dev-remote-1" };

describe("terminator — unattended paths refuse every non-host target before liveness", () => {
  it("X1: foreign refused before any probe", async () => {
    const w = setup({ session: FOREIGN });
    const r = await w.terminate("s1", UNATTENDED);
    expect(r).toMatchObject({ outcome: "refused-identity", terminated: false });
    w.spiesZero();
  });

  it("X2: foreign with a token-linked registry entry — the registry rung still runs", async () => {
    const w = setup({ session: FOREIGN, registryPid: 7777 });
    const r = await w.terminate("s1", UNATTENDED);
    expect(w.registry.killBySessionId).toHaveBeenCalledTimes(1);
    expect(r.outcome).toBe("refused-identity");
    expect(w.killProcess).not.toHaveBeenCalled();
  });

  it("X3: WSL on a win32 server is never probed", async () => {
    const w = setup({ ctx: SW, session: { pidNamespace: RL_WSL } });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("refused-identity");
    w.spiesZero();
  });

  it("X4: legacy WSL (POSIX cwd) on win32", async () => {
    const w = setup({ ctx: SW, session: { cwd: "/home/u/p" } });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("refused-identity");
    w.spiesZero();
  });

  it("X5: unknown on win32 — refusal precedes the liveness probe", async () => {
    const w = setup({ ctx: SW, session: { cwd: "C:\\p" } });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("refused-identity");
    expect(w.signalZero).not.toHaveBeenCalled();
  });

  it("X6: unknown on POSIX (server without nsId)", async () => {
    const w = setup({ ctx: { platform: "linux", hostId: "boot-A" }, session: { pidNamespace: RL } });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("refused-identity");
    w.spiesZero();
  });

  it("X7: host unchanged — killed and confirmed dead", async () => {
    const w = setup({ session: { pidNamespace: RL } });
    const r = await w.terminate("s1", UNATTENDED);
    expect(w.killProcess).toHaveBeenCalledWith(4242, expect.anything());
    expect(w.killProcess).toHaveBeenCalledTimes(1);
    expect(r.outcome).toBe("confirmed-dead");
  });

  it("X12: absent `operator` is unattended", async () => {
    const w = setup({ session: FOREIGN });
    expect((await w.terminate("s1", { verifyIdentity: false })).outcome).toBe("refused-identity");
    w.spiesZero();
  });
});

describe("terminator — operator path", () => {
  it("X8: non-local targets are `not-local`, no signal", async () => {
    const cases: Array<[ServerPidContext, Partial<DashboardSession>]> = [
      [SL, FOREIGN],
      [SW, { pidNamespace: RL_WSL }],
      [SW, { cwd: "/home/u/p" }],
    ];
    for (const [ctx, session] of cases) {
      const w = setup({ ctx, session });
      expect(await w.terminate("s1", OPERATOR)).toEqual({ outcome: "not-local", terminated: false, pid: 4242 });
      w.spiesZero();
    }
  });

  it("X9: unknown on win32 keeps today's signal (Q8)", async () => {
    const w = setup({ ctx: SW, session: { cwd: "C:\\p" } });
    await w.terminate("s1", OPERATOR);
    expect(w.killProcess).toHaveBeenCalledWith(4242, expect.anything());
    expect(w.killProcess).toHaveBeenCalledTimes(1);
  });

  it("X10: unknown on POSIX is `not-local`", async () => {
    const w = setup({ ctx: { platform: "linux", hostId: "boot-A" }, session: { pidNamespace: RL } });
    expect((await w.terminate("s1", OPERATOR)).outcome).toBe("not-local");
    expect(w.killProcess).not.toHaveBeenCalled();
  });

  it("X11: `operator` is independent of `verifyIdentity`", async () => {
    const guarded = setup({ session: { pidNamespace: RL } });
    await guarded.terminate("s1", { operator: true, verifyIdentity: true, graceMs: 0 });
    expect(guarded.processStartedAt).toHaveBeenCalledTimes(1);
    const unguarded = setup({ session: { pidNamespace: RL } });
    await unguarded.terminate("s1", { operator: true, verifyIdentity: false, graceMs: 0 });
    expect(unguarded.processStartedAt).not.toHaveBeenCalled();
  });

  it("X13: resolves once, before the registry rung, with the registry pid as ownEntryPid", async () => {
    const w = setup({ ctx: SW, session: { cwd: "/home/u/p" }, registryPid: 4242, registryKillDeletes: true });
    await w.terminate("s1", OPERATOR);
    expect(w.resolve).toHaveBeenCalledTimes(1);
    expect(w.resolve.mock.calls[0][2]).toBe(4242);
    expect(w.resolve.mock.results[0].value).toEqual({ kind: "host" });
    expect(w.resolve.mock.invocationCallOrder[0]).toBeLessThan(w.registry.killBySessionId.mock.invocationCallOrder[0]);
    expect(w.killProcess).toHaveBeenCalledTimes(1);
  });

  it("X100: an operator `not-local` still runs the registry rung (S8)", async () => {
    const w = setup({ session: FOREIGN, registryPid: 9999 });
    const r = await w.terminate("s1", OPERATOR);
    expect(w.registry.killBySessionId).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ outcome: "not-local", terminated: false });
    w.spiesZero();
  });

  it("X101: Q8 matrix on win32 — operator signals, unattended refuses", async () => {
    const op = setup({ ctx: SW, session: { cwd: "C:\\p" } });
    await op.terminate("s1", OPERATOR);
    expect(op.killProcess).toHaveBeenCalledTimes(1);
    const un = setup({ ctx: SW, session: { cwd: "C:\\p" } });
    expect((await un.terminate("s1", UNATTENDED)).outcome).toBe("refused-identity");
    un.spiesZero();
  });
});

describe("terminator — idempotency and no-target paths", () => {
  it("X14: refusals are idempotent", async () => {
    const w = setup({ session: FOREIGN });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("refused-identity");
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("refused-identity");
    expect((await w.terminate("s1", OPERATOR)).outcome).toBe("not-local");
    expect((await w.terminate("s1", OPERATOR)).outcome).toBe("not-local");
    w.spiesZero();
  });

  it("X15: a dead-looking foreign pid is never reported confirmed-dead", async () => {
    for (const opts of [UNATTENDED, OPERATOR]) {
      const w = setup({ session: FOREIGN, esrch: true });
      const r = await w.terminate("s1", opts);
      expect(r.terminated).toBe(false);
      expect(r.outcome).not.toBe("confirmed-dead");
      expect(w.signalZero).not.toHaveBeenCalled();
    }
  });

  it("X102: token-only terminate resolves no target", async () => {
    const w = setup({ session: null });
    const r = await w.terminate("", { spawnToken: "T1", operator: false });
    expect(w.registry.killByToken).toHaveBeenCalledWith("T1");
    expect(w.resolve).not.toHaveBeenCalled();
    expect(w.signalZero).not.toHaveBeenCalled();
    expect(w.killProcess).not.toHaveBeenCalled();
    expect(r.outcome).toBe("no-identity");
  });
});
