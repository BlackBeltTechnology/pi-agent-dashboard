/**
 * Idle reaper sweep (test-plan #E1, #E12, #E15, #E16, #F1, #F2, #F3, #E13, #E22):
 * proves gear selection → action wiring with fully injected deps — durable
 * untouched, disabled dormant, idle/phantom via the graceful kill ladder,
 * stop-after-turn via the latch, queued/busy left alone.
 * See change: add-embed-session-lifecycle.
 */
import { DEFAULT_EMBED_LIFECYCLE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminateResult } from "../../spawn-process/session-terminator.js";
import { createIdleReaper, type ReaperDeps } from "../idle-reaper.js";
import { createReclaimGiveUpTracker } from "../reclaim-give-up.js";
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
    terminate: async (id) => {
      kills.push(id);
      return { outcome: "confirmed-dead", terminated: true };
    },
    sendStopAfterTurn: (id) => {
      stops.push(id);
      return true;
    },
    onReap: (id, reason) => reaped.push([id, reason]),
    now: () => NOW,
  };
  return { deps, kills, stops, reaped };
}

describe("idle reaper sweep", () => {
  let h: Harness;

  // E12 / E1 — an eligible idle ephemeral session is reaped via the graceful
  // kill ladder, recording reason "idle".
  it("reaps an eligible idle ephemeral session via terminate", async () => {
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

// Failed-reclaim behaviour (test-plan #E16–#E18, #E38, #X7–#X11).
// See change: fix-session-reclaim-tmux.
describe("idle reaper — failed reclaims", () => {
  afterEach(() => vi.restoreAllMocks());

  const OK: TerminateResult = { outcome: "confirmed-dead", terminated: true };
  const survived = (pid = 100): TerminateResult => ({ outcome: "unconfirmed", terminated: false, pid });

  function build(
    sessions: () => DashboardSession[],
    over: Partial<ReaperDeps> = {},
  ) {
    const reaped: Array<[string, ReapReason]> = [];
    const failed: Array<[string, ReapReason, TerminateResult | undefined]> = [];
    const giveUp = createReclaimGiveUpTracker();
    const terminate = vi.fn(async (_id: string): Promise<TerminateResult> => OK);
    const deps: ReaperDeps = {
      config: () => CFG,
      listSessions: sessions,
      probe: async () => ({ ok: true, childCount: 0, cpuPercent: 0 }),
      hasSubscriber: () => false,
      hasTerminalInCwd: () => false,
      hasPendingAsk: () => false,
      queueCounts: () => ({ followUp: 0, steering: 0 }),
      terminate,
      sendStopAfterTurn: () => true,
      onReap: (id, r) => reaped.push([id, r]),
      onReclaimFailed: (id, r, res) => failed.push([id, r, res]),
      giveUp,
      now: () => NOW,
      ...over,
    };
    return { reaper: createIdleReaper(deps), terminate, reaped, failed, giveUp };
  }

  const idleStream = () =>
    session({ status: "streaming", lastRunStartedAt: NOW - 100_000, lastSettledAt: NOW - 200_000 });

  // X8 / X9 — loud, record kept, retried next sweep.
  it("does not count an unconfirmed kill, logs it loudly, and retries next sweep", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = build(() => [session()]);
    h.terminate.mockResolvedValue(survived(321));
    await h.reaper.sweepOnce();
    expect(h.reaped).toEqual([]);
    expect(h.failed).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("[embed-lifecycle] reclaim(s1, idle): unconfirmed, process 321 survived");
    await h.reaper.sweepOnce();
    expect(h.terminate).toHaveBeenCalledTimes(2);
  });

  // X10 — identity refusal: one attempt then silence, one error line.
  it("gives up at once on refused-identity with exactly one error line", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = build(() => [session()]);
    h.terminate.mockResolvedValue({ outcome: "refused-identity", terminated: false, pid: 100 });
    await h.reaper.sweepOnce();
    await h.reaper.sweepOnce();
    await h.reaper.sweepOnce();
    expect(h.terminate).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain("s1");
    expect(line).toContain("idle");
    expect(line).toContain("refused-identity");
    expect(line).toContain("100");
  });

  // E12 at the reaper: 3 unconfirmed sweeps then silence, one error line.
  it("gives up after 3 consecutive unconfirmed attempts", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = build(() => [session()]);
    h.terminate.mockResolvedValue(survived());
    for (let i = 0; i < 5; i++) await h.reaper.sweepOnce();
    expect(h.terminate).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledTimes(1);
  });

  // E38 — an ineligible sweep makes no attempt and does not reset the count.
  it("counts attempts, not sweeps: an ineligible sweep does not reset give-up", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    let subscribed = false;
    const h = build(() => [session()], { hasSubscriber: () => subscribed });
    h.terminate.mockResolvedValue(survived());
    await h.reaper.sweepOnce(); // fail 1
    await h.reaper.sweepOnce(); // fail 2
    subscribed = true;
    await h.reaper.sweepOnce(); // ineligible, no attempt
    subscribed = false;
    await h.reaper.sweepOnce(); // fail 3 → given up
    await h.reaper.sweepOnce(); // skipped
    expect(h.terminate).toHaveBeenCalledTimes(3);
    expect(h.giveUp.isGivenUp("s1")).toBe(true);
  });

  // E16 — pruned when the session leaves the list.
  it("prunes a given-up session once it is no longer listed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    let listed = true;
    const h = build(() => (listed ? [session()] : []));
    h.terminate.mockResolvedValue({ outcome: "no-identity", terminated: false });
    await h.reaper.sweepOnce();
    expect(h.giveUp.isGivenUp("s1")).toBe(true);
    listed = false;
    await h.reaper.sweepOnce();
    expect(h.giveUp.isGivenUp("s1")).toBe(false);
  });

  // X7 — a throwing terminator is a failed reclaim, not a skipped one.
  it("maps a throwing terminate to an unconfirmed failed reclaim", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = build(() => [session()]);
    h.terminate.mockRejectedValue(new Error("boom"));
    await h.reaper.sweepOnce();
    expect(h.reaped).toEqual([]);
    expect(h.failed).toHaveLength(1);
    expect(h.failed[0]?.[2]?.outcome).toBe("unconfirmed");
    expect(h.giveUp.isGivenUp("s1")).toBe(false); // 1 of 3
  });

  // E17 — an undelivered latch is retried every sweep, never given up.
  it("retries an undelivered stop-after-turn latch forever without giving up", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let delivered = false;
    const send = vi.fn(() => delivered);
    const h = build(() => [idleStream()], { sendStopAfterTurn: send });
    for (let i = 0; i < 5; i++) await h.reaper.sweepOnce();
    expect(send).toHaveBeenCalledTimes(5);
    expect(h.failed).toHaveLength(5);
    expect(h.reaped).toEqual([]);
    expect(h.giveUp.isGivenUp("s1")).toBe(false);
    // E18 — delivered: counted, no failure.
    delivered = true;
    await h.reaper.sweepOnce();
    expect(h.reaped).toEqual([["s1", "stop-after-turn"]]);
    expect(h.failed).toHaveLength(5);
  });

  // X11 — phantom goes through the same terminator, counted on confirm.
  it("counts a phantom reap only on confirmed termination", async () => {
    const phantom = session({
      status: "streaming",
      lastRunStartedAt: NOW - (CFG.hardCeilingSeconds * 1000 + 1),
      lastSettledAt: NOW - (CFG.hardCeilingSeconds * 1000 + 100_000),
    });
    const h = build(() => [phantom]);
    await h.reaper.sweepOnce();
    expect(h.terminate).toHaveBeenCalledWith("s1");
    expect(h.reaped).toEqual([["s1", "phantom"]]);
  });

  it("clears the give-up state after a confirmed termination", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = build(() => [session()]);
    h.terminate.mockResolvedValueOnce(survived()).mockResolvedValueOnce(survived()).mockResolvedValue(OK);
    for (let i = 0; i < 3; i++) await h.reaper.sweepOnce();
    expect(h.reaped).toEqual([["s1", "idle"]]);
    // count restarted: two more failures do not give up.
    h.terminate.mockResolvedValue(survived());
    await h.reaper.sweepOnce();
    await h.reaper.sweepOnce();
    expect(h.giveUp.isGivenUp("s1")).toBe(false);
  });
});
