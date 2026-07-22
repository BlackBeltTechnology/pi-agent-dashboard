/**
 * Idle reaper sweep (test-plan #E1, #E12, #E15, #E16, #F1, #F2, #F3, #E13, #E22):
 * proves gear selection → action wiring with fully injected deps — durable
 * untouched, disabled dormant, idle/phantom via the graceful kill ladder,
 * stop-after-turn via the latch, queued/busy left alone.
 * See change: add-embed-session-lifecycle.
 */
import { DEFAULT_EMBED_LIFECYCLE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createIdleReaper, type ReaperDeps } from "../idle-reaper.js";
import type { LivenessSnapshot } from "../liveness-probe.js";
import type { ReapReason } from "../quiescence.js";

const NOW = 10_000_000;
const CFG = {
  ...DEFAULT_EMBED_LIFECYCLE,
  enabled: true,
  idleTimeoutSeconds: 60,
  graceWindowSeconds: 10,
  hardCeilingSeconds: 600,
};

function session(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/work",
    source: "embed",
    lifecyclePolicy: "ephemeral",
    status: "idle",
    startedAt: NOW - 500_000,
    pid: 100,
    lastRunStartedAt: NOW - 400_000,
    lastSettledAt: NOW - 300_000, // settled after start ⇒ at rest
    currentTool: null,
    lastActivityAt: NOW - 120_000, // idle 120s > 60s timeout
    ...overrides,
  } as DashboardSession;
}

interface Harness {
  deps: ReaperDeps;
  kills: string[];
  stops: string[];
  reaped: Array<[string, ReapReason]>;
}

function harness(
  sessions: DashboardSession[],
  opts: { probe?: LivenessSnapshot; enabled?: boolean } = {},
): Harness {
  const kills: string[] = [];
  const stops: string[] = [];
  const reaped: Array<[string, ReapReason]> = [];
  const probeSnap: LivenessSnapshot = opts.probe ?? { ok: true, childCount: 0, cpuPercent: 0 };
  const deps: ReaperDeps = {
    config: () => ({ ...CFG, enabled: opts.enabled ?? true }),
    listSessions: () => sessions,
    probe: async () => probeSnap,
    hasSubscriber: () => false,
    hasTerminalInCwd: () => false,
    hasPendingAsk: () => false,
    queueCounts: () => ({ followUp: 0, steering: 0 }),
    killBySessionId: async (id) => {
      kills.push(id);
      return true;
    },
    sendStopAfterTurn: (id) => stops.push(id),
    onReap: (id, reason) => reaped.push([id, reason]),
    now: () => NOW,
  };
  return { deps, kills, stops, reaped };
}

describe("idle reaper sweep", () => {
  let h: Harness;

  // E12 / E1 — an eligible idle ephemeral session is reaped via the graceful
  // kill ladder, recording reason "idle".
  it("reaps an eligible idle ephemeral session via killBySessionId", async () => {
    h = harness([session()]);
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.kills).toEqual(["s1"]);
    expect(h.stops).toEqual([]);
    expect(h.reaped).toEqual([["s1", "idle"]]);
  });

  // E1 — a durable session is never reaped.
  it("never reaps a durable session", async () => {
    h = harness([session({ lifecyclePolicy: "durable" })]);
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.kills).toEqual([]);
    expect(h.reaped).toEqual([]);
  });

  it("skips an already-ended session", async () => {
    h = harness([session({ status: "ended" })]);
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.kills).toEqual([]);
  });

  // E22 — dormant when the feature is disabled.
  it("does nothing when the feature is disabled", async () => {
    h = harness([session()], { enabled: false });
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.kills).toEqual([]);
    expect(h.stops).toEqual([]);
  });

  // E15 / E16 — a wedged streaming session is force-reaped as "phantom" via the
  // SAME graceful kill ladder (not a bare SIGKILL), keeping it resumable.
  it("force-reaps a phantom session via the graceful ladder", async () => {
    const phantom = session({
      status: "streaming",
      lastRunStartedAt: NOW - (CFG.hardCeilingSeconds * 1000 + 1),
      lastSettledAt: NOW - (CFG.hardCeilingSeconds * 1000 + 100_000), // older ⇒ mid-run
    });
    h = harness([phantom], { probe: { ok: true, childCount: 0, cpuPercent: 0 } });
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.kills).toEqual(["s1"]); // graceful ladder, same path as idle
    expect(h.reaped).toEqual([["s1", "phantom"]]);
  });

  // F1 — an idle-trending streaming session gets stop-after-turn, NOT a kill.
  it("sends stop-after-turn for an idle-trending streaming session", async () => {
    const idleStream = session({
      status: "streaming",
      lastRunStartedAt: NOW - 100_000, // past idle, below hard ceiling
      lastSettledAt: NOW - 200_000,
    });
    h = harness([idleStream]);
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.stops).toEqual(["s1"]);
    expect(h.kills).toEqual([]);
    expect(h.reaped).toEqual([["s1", "stop-after-turn"]]);
  });

  // F2 — a streaming session with queued work is left to drain.
  it("does not stop a streaming session with queued follow-up", async () => {
    const idleStream = session({
      status: "streaming",
      lastRunStartedAt: NOW - 100_000,
      lastSettledAt: NOW - 200_000,
    });
    const { deps, stops, kills } = harness([idleStream]);
    deps.queueCounts = () => ({ followUp: 1, steering: 0 });
    await createIdleReaper(deps).sweepOnce();
    expect(stops).toEqual([]);
    expect(kills).toEqual([]);
  });

  // X4 / F3 — a live child (probe reports a descendant) vetoes reaping; an
  // active subscriber also vetoes (disconnect ≠ reclaim is the inverse).
  it("does not reap when the liveness probe reports a live child", async () => {
    h = harness([session()], { probe: { ok: true, childCount: 1, cpuPercent: 0 } });
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.kills).toEqual([]);
  });

  it("does not reap a subscribed session", async () => {
    const { deps, kills } = harness([session()]);
    deps.hasSubscriber = () => true;
    await createIdleReaper(deps).sweepOnce();
    expect(kills).toEqual([]);
  });

  // Unknown probe (ps failed) is the SAFE direction: no idle reap.
  it("does not idle-reap when the probe result is unknown", async () => {
    h = harness([session()], { probe: { ok: false, childCount: 0, cpuPercent: 0 } });
    await createIdleReaper(h.deps).sweepOnce();
    expect(h.kills).toEqual([]);
  });
});
