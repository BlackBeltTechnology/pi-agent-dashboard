/**
 * The idle reaper probes a session's pid only when its target is `host`; any
 * other target makes the probe unavailable (⇒ never idle by CPU/child signals),
 * and an unattended refusal is not retried.
 * Test-plan rows X60–X64. See change: scope-pids-to-namespace.
 */
import { DEFAULT_EMBED_LIFECYCLE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession, PidNamespace } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import type { ServerPidContext } from "../../session/pid-target.js";
import type { TerminateResult } from "../../spawn-process/session-terminator.js";
import { createIdleReaper, type ReaperDeps } from "../idle-reaper.js";

const NOW = 10_000_000;
const SL: ServerPidContext = { platform: "linux", hostId: "boot-A", nsId: "pid:[4026531836]" };
const SW: ServerPidContext = { platform: "win32", hostId: "WINBOX" };
const RL: PidNamespace = { platform: "linux", kind: "host", hostId: "boot-A", nsId: "pid:[4026531836]" };
const RL_WSL: PidNamespace = { platform: "linux", kind: "wsl", distro: "U", hostId: "boot-W", nsId: "pid:[1]" };
const CFG = { ...DEFAULT_EMBED_LIFECYCLE, enabled: true, idleTimeoutSeconds: 60, graceWindowSeconds: 10, hardCeilingSeconds: 600 };

function session(over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/work",
    source: "embed",
    lifecyclePolicy: "ephemeral",
    status: "idle",
    startedAt: NOW - 500_000,
    pid: 321,
    lastRunStartedAt: NOW - 400_000,
    lastSettledAt: NOW - 300_000,
    currentTool: null,
    lastActivityAt: NOW - 120_000, // idle 120 s > 60 s, below the 600 s ceiling
    ...over,
  } as DashboardSession;
}

function harness(sessions: DashboardSession[], ctx: ServerPidContext, result?: TerminateResult) {
  const probe = vi.fn(async () => ({ ok: true, childCount: 0, cpuPercent: 0 }));
  const terminate = vi.fn(async () => result ?? ({ outcome: "confirmed-dead", terminated: true } as TerminateResult));
  const deps: ReaperDeps = {
    config: () => CFG,
    listSessions: () => sessions,
    probe,
    hasSubscriber: () => false,
    hasTerminalInCwd: () => false,
    hasPendingAsk: () => false,
    queueCounts: () => ({ followUp: 0, steering: 0 }),
    terminate,
    sendStopAfterTurn: () => true,
    now: () => NOW,
    pidContext: ctx,
  };
  return { reaper: createIdleReaper(deps), probe, terminate };
}

const NON_HOST: Array<[string, ServerPidContext, Partial<DashboardSession>]> = [
  ["foreign", SL, { originDeviceId: "dev-remote-1" }],
  ["wsl", SW, { pidNamespace: RL_WSL }],
  ["legacy-wsl", SW, { cwd: "/home/u/p" }],
  ["unknown", SW, { cwd: "C:\\p" }],
];

describe("idle reaper — probe by pid target", () => {
  it.each(NON_HOST)("X60/X62: %s — no probe, never idle-reaped by CPU/child signals", async (_n, ctx, over) => {
    const h = harness([session(over)], ctx);
    await h.reaper.sweepOnce();
    expect(h.probe).not.toHaveBeenCalled();
    expect(h.terminate).not.toHaveBeenCalled();
  });

  it("X61: a host target is probed", async () => {
    const h = harness([session({ pidNamespace: RL })], SL);
    await h.reaper.sweepOnce();
    expect(h.probe).toHaveBeenCalledWith(321);
    expect(h.probe).toHaveBeenCalledTimes(1);
  });

  it("X63: a non-host session is never handed to terminate across sweeps", async () => {
    // Every kill gear needs `hasLiveChild === false`; an unavailable probe reads
    // as a live child, so a non-host target never reaches the terminator at all.
    const s = session({ originDeviceId: "dev-remote-1", lastActivityAt: NOW - 900_000, lastRunStartedAt: NOW - 900_000 });
    const h = harness([s], SL, { outcome: "refused-identity", terminated: false, pid: 321 });
    for (let i = 0; i < 3; i++) await h.reaper.sweepOnce();
    expect(h.terminate).not.toHaveBeenCalled();
  });

  it("X63: a `refused-identity` outcome is given up, not retried (give-up tracker unchanged)", async () => {
    const h = harness([session({ pidNamespace: RL })], SL, { outcome: "refused-identity", terminated: false, pid: 321 });
    for (let i = 0; i < 3; i++) await h.reaper.sweepOnce();
    expect(h.terminate).toHaveBeenCalledTimes(1);
  });

  it("X64: no pid — no probe", async () => {
    const h = harness([session({ pid: undefined })], SL);
    await h.reaper.sweepOnce();
    expect(h.probe).not.toHaveBeenCalled();
  });
});
