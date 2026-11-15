/**
 * The terminator honours a headless-registry identity refusal for a RESTORED
 * entry: the ladder never re-signals a refused pid.
 * See change: guard-restored-headless-identity (test-plan E12, E13, E14, E33, X8).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import { createReclaimGiveUpTracker } from "../../embed-lifecycle/reclaim-give-up.js";
import type { CheckedKillResult } from "../headless-pid-registry.js";
import { createSessionTerminator, type TerminateOptions } from "../session-terminator.js";

const T = 1_700_000_000_000;
const unattended: TerminateOptions = { graceMs: 0, verifyIdentity: true, stampManualClose: true };

function setup(o: {
  session?: Partial<DashboardSession>;
  registryPid?: number;
  checked: () => Promise<CheckedKillResult>;
  alive?: number[];
  started?: Array<[number, number | null]>;
  pidTarget?: "host" | "foreign";
}) {
  const alive = new Set(o.alive ?? []);
  const started = new Map(o.started ?? []);
  const record = { id: "s1", status: "idle", pid: 100, pidRecordedAt: T, ...o.session } as DashboardSession;
  const killProcess = vi.fn(async (pid: number) => {
    alive.delete(pid);
    return { ok: true, forced: false };
  });
  const signalZero = vi.fn((pid: number) => (alive.has(pid) ? ("alive" as const) : ("esrch" as const)));
  const processStartedAt = vi.fn((pid: number) => (started.has(pid) ? (started.get(pid) ?? null) : null));
  const registry = {
    getPid: vi.fn(() => o.registryPid),
    killBySessionId: vi.fn(async () => true),
    killBySessionIdChecked: vi.fn(o.checked),
  };
  const warn = vi.fn();
  const { terminate } = createSessionTerminator({
    sessionManager: { get: (id: string) => (id === "s1" ? record : undefined), update: vi.fn() },
    headlessPidRegistry: registry,
    signalZero,
    killProcess: killProcess as never,
    processStartedAt,
    findPidsBySpawnToken: () => [],
    platform: "linux",
    sleep: async () => {},
    warn,
    pidContext: { kind: "host" } as never,
    resolvePidTarget: () => (o.pidTarget === "foreign" ? { kind: "foreign" } : { kind: "host" }),
  });
  return { terminate, killProcess, signalZero, processStartedAt, registry, warn };
}

const refused = (pid: number): CheckedKillResult => ({
  outcome: "refused-identity",
  refusedPids: [pid],
  diagnostic: `identity reuse: pid ${pid} started after its anchor`,
  killed: false,
});

describe("terminator × registry identity refusal", () => {
  it("E13: refused-identity stops the ladder — no escalate, no signal, given up at once", async () => {
    const h = setup({ registryPid: 100, alive: [100], checked: async () => refused(100) });
    const r = await h.terminate("s1", unattended);
    expect(r).toMatchObject({ outcome: "refused-identity", terminated: false, pid: 100 });
    expect(h.killProcess).not.toHaveBeenCalled();
    expect(h.registry.killBySessionIdChecked).toHaveBeenCalledWith("s1", { verifyIdentity: true });
    expect(h.warn.mock.calls.some((c) => String(c[0]).includes("identity reuse"))).toBe(true);
    // Not retried on a later sweep: refused-identity is an immediate give-up.
    const tracker = createReclaimGiveUpTracker();
    expect(tracker.recordFailure("s1", r.outcome)).toBe(true);
    expect(tracker.isGivenUp("s1")).toBe(true);
  });

  it("E12: partial outcome — keeper signalled, recycled pi refused; the ladder never signals it", async () => {
    // session.pid = P = registry pid (piPid at capture time), P recycled.
    const h = setup({
      registryPid: 600,
      session: { pid: 600, pidRecordedAt: T },
      alive: [600],
      started: [[600, T + 60_000]],
      checked: async () => ({ outcome: "signalled", refusedPids: [600], diagnostic: "identity reuse: pid 600", killed: true }),
    });
    const r = await h.terminate("s1", unattended);
    expect(r.outcome).toBe("refused-identity");
    expect(h.killProcess).not.toHaveBeenCalledWith(600, expect.anything());
    expect(h.warn.mock.calls.some((c) => String(c[0]).includes("identity reuse"))).toBe(true);
  });

  it("E14: no-entry / signalled+dead / signalled+alive keep their pre-change outcomes", async () => {
    const none = setup({ alive: [100], started: [[100, T - 5000]], checked: async () => ({ outcome: "no-entry", refusedPids: [], killed: false }) });
    expect((await none.terminate("s1", unattended)).outcome).toBe("confirmed-dead");
    expect(none.killProcess).toHaveBeenCalledWith(100, { timeoutMs: 2000 });

    const dead = setup({ registryPid: 100, alive: [], checked: async () => ({ outcome: "signalled", refusedPids: [], killed: true }) });
    expect((await dead.terminate("s1", unattended)).outcome).toBe("confirmed-dead");
    expect(dead.killProcess).not.toHaveBeenCalled();

    const live = setup({ registryPid: 100, alive: [100], checked: async () => ({ outcome: "signalled", refusedPids: [], killed: true }) });
    await live.terminate("s1", unattended);
    expect(live.killProcess).toHaveBeenCalledTimes(1);
  });

  it("E33: a remote-origin session still runs the registry rung; its pid is never probed or signalled", async () => {
    const h = setup({
      session: { pid: 999, originDeviceId: "d1" },
      pidTarget: "foreign",
      alive: [999],
      checked: async () => refused(500),
    });
    const r = await h.terminate("s1", unattended);
    expect(h.registry.killBySessionIdChecked).toHaveBeenCalledTimes(1);
    expect(r.terminated).toBe(false);
    expect(h.signalZero).not.toHaveBeenCalledWith(999);
    expect(h.processStartedAt).not.toHaveBeenCalledWith(999);
    expect(h.killProcess).not.toHaveBeenCalled();
  });

  it("operator shutdown passes verifyIdentity:false to the registry", async () => {
    const h = setup({ registryPid: 100, alive: [], checked: async () => ({ outcome: "signalled", refusedPids: [], killed: true }) });
    await h.terminate("s1", { graceMs: 0, verifyIdentity: false, operator: true });
    expect(h.registry.killBySessionIdChecked).toHaveBeenCalledWith("s1", { verifyIdentity: false });
  });

  it("X8: a throwing checked kill falls through like the pre-change throw path", async () => {
    const h = setup({
      alive: [100],
      started: [[100, T - 5000]],
      checked: async () => { throw new Error("registry exploded"); },
    });
    const r = await h.terminate("s1", unattended);
    expect(r.outcome).toBe("confirmed-dead");
    expect(h.killProcess).toHaveBeenCalledWith(100, { timeoutMs: 2000 });
  });
});
