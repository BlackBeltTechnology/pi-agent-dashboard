/**
 * Terminator dispatch on a Windows server: a `host` pid is verified and
 * tree-killed by ONE `verifyAndKillWindows` call; a WSL pid is decided and
 * killed ENTIRELY inside its distribution (`wslLiveness` + `verifyAndKillWsl`)
 * and never touches the (unrelated, same-numbered) Windows process table.
 * Test-plan rows E8b, E29–E41, X3–X16. See change: add-windows-process-identity.
 */
import type { DashboardSession, PidNamespace } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import type { ServerPidContext } from "../../session/pid-target.js";
import { createSessionTerminator, IDENTITY_TOLERANCE_MS, type TerminateOptions } from "../session-terminator.js";

const T = 1_700_000_000_000;
const D = "Ubuntu-24.04";
const SW: ServerPidContext = { platform: "win32", hostId: "WINBOX" };
const NS_HOST: PidNamespace = { platform: "win32", kind: "host", hostId: "WINBOX" };
const NS_WSL: PidNamespace = { platform: "linux", kind: "wsl", distro: D, hostId: "boot-W", nsId: "pid:[4026531840]" };
const UNATTENDED: TerminateOptions = { operator: false, verifyIdentity: true, graceMs: 0 };
const SHUTDOWN: TerminateOptions = { operator: true, verifyIdentity: false, graceMs: 0 };

type Kill = "killed" | "mismatch" | "absent" | "error";
type Live = "alive" | "absent" | "unknown";

function setup(o: {
  session?: Partial<DashboardSession>;
  platform?: NodeJS.Platform;
  ctx?: ServerPidContext;
  /** Windows pids alive in the host table. */
  alive?: number[];
  winKill?: Kill[];
  wslKill?: Kill[];
  wslLive?: Live[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
} = {}) {
  const alive = new Set(o.alive ?? []);
  const record = { id: "s1", status: "active", cwd: "C:\\p", pid: 4242, pidRecordedAt: T, ...o.session } as DashboardSession;
  const next = <V>(q: V[] | undefined, fallback: V): V => (q && q.length > 1 ? (q.shift() as V) : (q?.[0] ?? fallback));
  const sessionManager = { get: () => record, update: vi.fn() };
  const signalZero = vi.fn((pid: number) => (alive.has(pid) ? ("alive" as const) : ("esrch" as const)));
  const killProcess = vi.fn(async (pid: number) => {
    alive.delete(pid);
    return { ok: true, forced: false };
  });
  const processStartedAt = vi.fn(() => T);
  const verifyAndKillWindows = vi.fn(async (pid: number, _o: unknown) => {
    const r = next(o.winKill, "error" as Kill);
    if (r === "killed") alive.delete(pid);
    return r;
  });
  const verifyAndKillWsl = vi.fn(async (_pid: number, _d: string, _o: unknown) => next(o.wslKill, "error" as Kill));
  const wslLiveness = vi.fn(async (_pid: number, _d: string) => next(o.wslLive, "unknown" as Live));
  const registry = { getPid: vi.fn(() => undefined), killBySessionId: vi.fn(async () => false), killByToken: vi.fn(async () => false) };
  const warn = vi.fn();
  const { terminate } = createSessionTerminator({
    sessionManager,
    headlessPidRegistry: registry,
    signalZero,
    killProcess: killProcess as never,
    processStartedAt,
    verifyAndKillWindows: verifyAndKillWindows as never,
    verifyAndKillWsl: verifyAndKillWsl as never,
    wslLiveness: wslLiveness as never,
    findPidsBySpawnToken: () => [],
    platform: o.platform ?? "win32",
    pidContext: o.ctx ?? SW,
    sleep: o.sleep ?? (async () => {}),
    now: o.now,
    warn,
  });
  return { terminate, signalZero, killProcess, processStartedAt, verifyAndKillWindows, verifyAndKillWsl, wslLiveness, alive, warn };
}

const WSL = { pidNamespace: NS_WSL };
const HOST = { pidNamespace: NS_HOST };

describe("Windows host target, unattended", () => {
  it("E29: ONE verifyAndKillWindows call with maxStartMs = pidRecordedAt + tolerance; no plain kill, no processStartedAt", async () => {
    const w = setup({ session: HOST, alive: [4242], winKill: ["killed"] });
    const r = await w.terminate("s1", UNATTENDED);
    expect(r).toEqual({ outcome: "confirmed-dead", terminated: true, pid: 4242 });
    expect(w.verifyAndKillWindows).toHaveBeenCalledTimes(1);
    expect(w.verifyAndKillWindows).toHaveBeenCalledWith(4242, { maxStartMs: T + IDENTITY_TOLERANCE_MS, timeoutMs: 2000 });
    expect(w.killProcess).not.toHaveBeenCalled();
    expect(w.processStartedAt).not.toHaveBeenCalled();
  });

  it("E30: `killed` but the pid is still alive on re-check → unconfirmed", async () => {
    const w = setup({ session: HOST, alive: [4242], winKill: ["killed"] });
    w.verifyAndKillWindows.mockImplementation(async () => "killed"); // does not remove the pid
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("unconfirmed");
  });

  it("E31: `absent` is an idempotent success (twice), no second signal", async () => {
    const w = setup({ session: HOST, alive: [], winKill: ["absent"] });
    // an already-gone pid is confirmed before any helper runs
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("confirmed-dead");
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("confirmed-dead");
    expect(w.killProcess).not.toHaveBeenCalled();
  });

  it("E31b: `absent` but the pid reads alive on the re-check → unconfirmed", async () => {
    const w = setup({ session: HOST, alive: [4242], winKill: ["absent"] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("unconfirmed");
  });

  it("E32: no pidRecordedAt → refused-identity, no helper call", async () => {
    const w = setup({ session: { ...HOST, pidRecordedAt: undefined }, alive: [4242] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("refused-identity");
    expect(w.verifyAndKillWindows).not.toHaveBeenCalled();
    expect(w.killProcess).not.toHaveBeenCalled();
  });

  it("X3(win): `error` is never read as dead — unconfirmed, no fallback plain kill", async () => {
    const w = setup({ session: HOST, alive: [4242], winKill: ["error"] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("unconfirmed");
    expect(w.killProcess).not.toHaveBeenCalled();
  });

  it("X4(win): `mismatch` is terminal refused-identity with no further signal", async () => {
    const w = setup({ session: HOST, alive: [4242], winKill: ["mismatch"] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("refused-identity");
    expect(w.killProcess).not.toHaveBeenCalled();
  });

  it("X9: an `error` is not sticky — the next reclaim calls the helper again", async () => {
    const w = setup({ session: HOST, alive: [4242], winKill: ["error", "killed"] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("unconfirmed");
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("confirmed-dead");
    expect(w.verifyAndKillWindows).toHaveBeenCalledTimes(2);
  });

  it("E39: operator shutdown of a Windows host pid is unchanged (killProcess)", async () => {
    const w = setup({ session: HOST, alive: [4242] });
    expect((await w.terminate("s1", SHUTDOWN)).outcome).toBe("confirmed-dead");
    expect(w.killProcess).toHaveBeenCalledWith(4242, { timeoutMs: 2000 });
    expect(w.verifyAndKillWindows).not.toHaveBeenCalled();
  });

  it("E40: POSIX is unchanged — no Windows/WSL helper runs", async () => {
    for (const platform of ["linux", "darwin"] as const) {
      const w = setup({
        platform,
        ctx: { platform, hostId: "h", nsId: "ns" } as ServerPidContext,
        session: { pidNamespace: { platform, kind: "host", hostId: "h", nsId: "ns" } as PidNamespace, cwd: "/p" },
        alive: [4242],
      });
      await w.terminate("s1", UNATTENDED);
      expect(w.verifyAndKillWindows).not.toHaveBeenCalled();
      expect(w.verifyAndKillWsl).not.toHaveBeenCalled();
      expect(w.wslLiveness).not.toHaveBeenCalled();
      expect(w.processStartedAt).toHaveBeenCalled();
    }
  });
});

describe("WSL target, unattended", () => {
  it("E33: liveness → age-checked kill inside D → re-check absent ⇒ confirmed-dead", async () => {
    const w = setup({ session: WSL, alive: [4242], now: () => T + 10_000, wslLive: ["alive", "absent"], wslKill: ["killed"] });
    const r = await w.terminate("s1", UNATTENDED);
    expect(r).toEqual({ outcome: "confirmed-dead", terminated: true, pid: 4242 });
    expect(w.verifyAndKillWsl).toHaveBeenCalledTimes(1);
    expect(w.verifyAndKillWsl).toHaveBeenCalledWith(4242, D, { minAgeMs: 10_000 - IDENTITY_TOLERANCE_MS, timeoutMs: 2000 });
  });

  it.each([
    [-1, 0],
    [0, 0],
    [1, 1],
    [10_000, 10_000],
  ])("E8b: now = recorded + tol + %i ⇒ minAgeMs %i (server-computed, never an absolute time)", async (x, expected) => {
    const w = setup({ session: WSL, now: () => T + IDENTITY_TOLERANCE_MS + x, wslLive: ["alive", "absent"], wslKill: ["killed"] });
    await w.terminate("s1", UNATTENDED);
    expect((w.verifyAndKillWsl.mock.calls[0][2] as { minAgeMs: number }).minAgeMs).toBe(expected);
  });

  it("E8b: a pidRecordedAt in the future gives minAgeMs 0", async () => {
    const w = setup({ session: WSL, now: () => T - 5000, wslLive: ["alive", "absent"], wslKill: ["killed"] });
    await w.terminate("s1", UNATTENDED);
    expect((w.verifyAndKillWsl.mock.calls[0][2] as { minAgeMs: number }).minAgeMs).toBe(0);
  });

  it("E34: a same-numbered Windows process is never probed or signalled", async () => {
    const w = setup({ session: WSL, alive: [4242], wslLive: ["absent"] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("confirmed-dead");
    const w2 = setup({ session: WSL, alive: [4242], wslLive: ["alive", "absent"], wslKill: ["killed"] });
    expect((await w2.terminate("s1", UNATTENDED)).outcome).toBe("confirmed-dead");
    for (const x of [w, w2]) {
      expect(x.signalZero).not.toHaveBeenCalled();
      expect(x.killProcess).not.toHaveBeenCalled();
      expect(x.verifyAndKillWindows).not.toHaveBeenCalled();
      expect(x.processStartedAt).not.toHaveBeenCalled();
      expect(x.alive.has(4242)).toBe(true);
    }
  });

  it("E35: liveness `absent` short-circuits — no kill helper", async () => {
    const w = setup({ session: WSL, wslLive: ["absent"] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("confirmed-dead");
    expect(w.verifyAndKillWsl).not.toHaveBeenCalled();
  });

  it("E32: no pidRecordedAt → refused-identity before any WSL call", async () => {
    const w = setup({ session: { ...WSL, pidRecordedAt: undefined } });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("refused-identity");
    expect(w.wslLiveness).not.toHaveBeenCalled();
    expect(w.verifyAndKillWsl).not.toHaveBeenCalled();
  });

  it("X5(wsl): a wedged WSL (liveness unknown) is unconfirmed and runs no kill", async () => {
    const w = setup({ session: WSL, wslLive: ["unknown"] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("unconfirmed");
    expect(w.verifyAndKillWsl).not.toHaveBeenCalled();
    expect(w.killProcess).not.toHaveBeenCalled();
  });

  it("X10: helper `error` → unconfirmed, helper called once, no plain kill", async () => {
    const w = setup({ session: WSL, wslLive: ["alive"], wslKill: ["error"] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("unconfirmed");
    expect(w.verifyAndKillWsl).toHaveBeenCalledTimes(1);
    expect(w.killProcess).not.toHaveBeenCalled();
  });

  it("X4: helper `mismatch` is terminal refused-identity", async () => {
    const w = setup({ session: WSL, wslLive: ["alive"], wslKill: ["mismatch"] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("refused-identity");
  });

  it("E31b: `absent` result whose re-check is `unknown` → unconfirmed", async () => {
    const w = setup({ session: WSL, wslLive: ["alive", "unknown"], wslKill: ["absent"] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("unconfirmed");
  });

  it("X15 / X16: `killed` whose re-check is alive or unknown → unconfirmed", async () => {
    for (const re of ["alive", "unknown"] as const) {
      const w = setup({ session: WSL, wslLive: ["alive", re], wslKill: ["killed"] });
      expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("unconfirmed");
    }
  });

  it("E41: concurrent reclaims of one WSL session both confirm (killed + absent)", async () => {
    const w = setup({ session: WSL, wslLive: ["alive", "absent"], wslKill: ["killed", "absent"] });
    const [a, b] = await Promise.all([w.terminate("s1", UNATTENDED), w.terminate("s1", UNATTENDED)]);
    expect(a.outcome).toBe("confirmed-dead");
    expect(b.outcome).toBe("confirmed-dead");
    expect(w.verifyAndKillWsl.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("X6: wsl.exe missing (liveness unknown on every call) → unconfirmed, never confirmed-dead", async () => {
    const w = setup({ session: WSL, wslLive: ["unknown"] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).not.toBe("confirmed-dead");
    expect(w.killProcess).not.toHaveBeenCalled();
  });
});

describe("WSL target, operator shutdown", () => {
  it("E37: no age check — the options carry neither minAgeMs nor maxStartMs", async () => {
    const w = setup({ session: WSL, wslLive: ["alive", "absent"], wslKill: ["killed"] });
    expect((await w.terminate("s1", SHUTDOWN)).outcome).toBe("confirmed-dead");
    const opts = w.verifyAndKillWsl.mock.calls[0][2] as Record<string, unknown>;
    expect("minAgeMs" in opts).toBe(false);
    expect("maxStartMs" in opts).toBe(false);
  });

  it("E36: grace polling uses wslLiveness (no kill, no signalZero)", async () => {
    let t = 0;
    const w = setup({
      session: WSL,
      wslLive: ["alive", "alive", "alive", "absent"],
      now: () => t,
      sleep: async (ms) => {
        t += ms + 100;
      },
    });
    const r = await w.terminate("s1", { ...SHUTDOWN, graceMs: 2000 });
    expect(r.outcome).toBe("confirmed-dead");
    expect(w.verifyAndKillWsl).not.toHaveBeenCalled();
    expect(w.signalZero).not.toHaveBeenCalled();
  });

  it("X12: helper `error` is unconfirmed; `absent` confirms after the re-check", async () => {
    const e = setup({ session: WSL, wslLive: ["alive"], wslKill: ["error"] });
    expect((await e.terminate("s1", SHUTDOWN)).outcome).toBe("unconfirmed");
    const a = setup({ session: WSL, wslLive: ["alive", "absent"], wslKill: ["absent"] });
    expect((await a.terminate("s1", SHUTDOWN)).outcome).toBe("confirmed-dead");
  });
});

describe("refused targets (no probe, no signal)", () => {
  it.each([
    ["legacy-wsl", { cwd: "/home/u/p" }],
    ["foreign", { originDeviceId: "dev-remote-1" }],
    ["unknown", { cwd: "C:\\p" }],
  ])("E38: %s on a win32 server, unattended → refused-identity, zero calls", async (_n, session) => {
    const w = setup({ session: session as Partial<DashboardSession>, alive: [4242] });
    expect((await w.terminate("s1", UNATTENDED)).outcome).toBe("refused-identity");
    for (const f of [w.signalZero, w.killProcess, w.processStartedAt, w.verifyAndKillWindows, w.verifyAndKillWsl, w.wslLiveness]) {
      expect(f).not.toHaveBeenCalled();
    }
  });
});
