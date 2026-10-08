/**
 * PR-status scheduler (`pr-status.ts`) — cadence, generation, forced refresh,
 * back-off and logging, plus its integration with the one git
 * change-detector (`sendGitInfoIfChanged`).
 *
 * test-plan ids: P1 P2 P3 F1 F2 F3 F4 F5 X1 X2 (+ tasks 1.5–1.8).
 * See change: redesign-composer-session-strip (D5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrStatusProbe } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";

import type { BridgeContext } from "../bridge-context.js";
import { resetReconnectCaches, sendGitInfoIfChanged } from "../model-tracker.js";
import { createPrStatusScheduler, handleGitInfoRefresh, type PrGeneration, type PrStatusScheduler } from "../pr-status.js";

const S = 1000;
const OPEN_747: PrStatusProbe = {
  kind: "parsed",
  value: { number: 747, url: "https://github.com/o/r/pull/747", state: "open", isDraft: false, checks: "passing" },
};
const PR_748: PrStatusProbe = {
  kind: "parsed",
  value: { number: 748, url: "https://github.com/o/r/pull/748", state: "open", isDraft: true, checks: "pending" },
};
const ABSENT: PrStatusProbe = { kind: "absent" };
const FAIL_401: PrStatusProbe = { kind: "failure", reason: "exit 1: HTTP 401" };

const GEN: PrGeneration = { sessionId: "A", cwd: "/r/.worktrees/x", branch: "os/x" };

/** Deferred probe results under test control. */
function scriptedProbe(script: Array<PrStatusProbe | { delayMs: number; result: PrStatusProbe } | "hang">) {
  const calls: number[] = [];
  let i = 0;
  const probe = vi.fn((_cwd: string) => {
    calls.push(Date.now());
    const step = script[Math.min(i, script.length - 1)]!;
    i += 1;
    if (step === "hang") return new Promise<PrStatusProbe>(() => {});
    if ("delayMs" in step) return new Promise<PrStatusProbe>((r) => setTimeout(() => r(step.result), step.delayMs));
    return Promise.resolve(step);
  });
  return { probe, calls };
}

function make(probe: (cwd: string) => Promise<PrStatusProbe>) {
  const onChange = vi.fn();
  const log = vi.fn();
  const sched = createPrStatusScheduler({ probe, onChange, log });
  return { sched, onChange, log };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("pr-status scheduler", () => {
  let sched: PrStatusScheduler | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    sched?.dispose();
    sched = undefined;
    vi.useRealTimers();
  });

  it("probes immediately on first observation and fills the tuple", async () => {
    const { probe } = scriptedProbe([OPEN_747]);
    const m = make(probe);
    sched = m.sched;
    sched.observe(GEN);
    expect(sched.tuple()).toEqual({}); // unknown until the probe lands
    await flush();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(sched.tuple()).toEqual({
      gitPrNumber: 747,
      gitPrUrl: "https://github.com/o/r/pull/747",
      gitPrState: "open",
      gitPrDraft: false,
      gitPrChecks: "passing",
      gitPrCheckedAt: 0,
    });
    expect(m.onChange).toHaveBeenCalledTimes(1);
  });

  it("absent → all-null known-absent tuple", async () => {
    const { probe } = scriptedProbe([ABSENT]);
    sched = make(probe).sched;
    sched.observe(GEN);
    await flush();
    expect(sched.tuple()).toEqual({
      gitPrNumber: null, gitPrUrl: null, gitPrState: null, gitPrDraft: null, gitPrChecks: null, gitPrCheckedAt: null,
    });
  });

  it("P2: cadence bound — ≤ 31 invocations over 60 simulated minutes", async () => {
    const { probe } = scriptedProbe([OPEN_747]);
    sched = make(probe).sched;
    sched.observe(GEN);
    for (let tick = 0; tick < 120; tick++) {
      await vi.advanceTimersByTimeAsync(30 * S);
      sched.observe(GEN); // the 30 s git tick re-observes the same generation
    }
    expect(sched.invocations()).toBeLessThanOrEqual(31);
    expect(sched.invocations()).toBeGreaterThanOrEqual(30);
  });

  it("F1: no probe at +30 s, probe at +120 s; branch change → all-null at once, then a probe; old PR never re-sent", async () => {
    const { probe } = scriptedProbe([OPEN_747, OPEN_747, { delayMs: 2 * S, result: PR_748 }]);
    const m = make(probe);
    sched = m.sched;
    sched.observe(GEN);
    await flush();
    await vi.advanceTimersByTimeAsync(30 * S);
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90 * S); // t = 120 s
    expect(probe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10 * S); // t = 130 s
    m.onChange.mockClear();
    sched.observe({ ...GEN, branch: "os/y" });
    expect(sched.tuple().gitPrNumber).toBeNull();
    expect(sched.tuple().gitPrState).toBeNull();
    expect(m.onChange).toHaveBeenCalledTimes(1); // the all-null update is pushed immediately
    expect(probe).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2 * S);
    expect(sched.tuple().gitPrNumber).toBe(748);
  });

  it("F2: stale generation — a fork mid-probe discards A's result; B stays unknown until its own probe", async () => {
    const { probe } = scriptedProbe([{ delayMs: 5 * S, result: OPEN_747 }, { delayMs: 5 * S, result: PR_748 }]);
    sched = make(probe).sched;
    sched.observe(GEN);
    await vi.advanceTimersByTimeAsync(1 * S);
    sched.observe({ ...GEN, sessionId: "B" });
    await vi.advanceTimersByTimeAsync(4 * S); // A's probe settles — discarded
    expect(sched.tuple()).toEqual({});
    expect(probe).toHaveBeenCalledTimes(2); // B's own probe started right after
    await vi.advanceTimersByTimeAsync(5 * S);
    expect(sched.tuple().gitPrNumber).toBe(748);
  });

  it("F3: forced refresh during an in-flight probe → a second probe right after the first settles", async () => {
    const { probe, calls } = scriptedProbe([{ delayMs: 5 * S, result: ABSENT }, OPEN_747]);
    sched = make(probe).sched;
    sched.observe(GEN);
    await vi.advanceTimersByTimeAsync(1 * S);
    sched.refresh("pr");
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * S);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(calls[1]).toBe(5 * S);
    expect(sched.tuple().gitPrNumber).toBe(747);
  });

  it("F4: reason pr retries at +5 s / +15 s while absent; reason push probes once", async () => {
    const pr = scriptedProbe([ABSENT, ABSENT, ABSENT, PR_748]);
    sched = make(pr.probe).sched;
    sched.observe(GEN);
    await flush(); // initial probe: absent
    await vi.advanceTimersByTimeAsync(40 * S);
    const base = Date.now();
    sched.refresh("pr");
    await vi.advanceTimersByTimeAsync(20 * S);
    expect(pr.calls.slice(1).map((t) => t - base)).toEqual([0, 5 * S, 15 * S]);
    expect(sched.tuple().gitPrNumber).toBe(748);
    sched.dispose();

    const push = scriptedProbe([ABSENT]);
    sched = make(push.probe).sched;
    sched.observe(GEN);
    await flush();
    await vi.advanceTimersByTimeAsync(40 * S);
    sched.refresh("push");
    await vi.advanceTimersByTimeAsync(20 * S);
    expect(push.probe).toHaveBeenCalledTimes(2); // initial + exactly one forced
  });

  it("P3: 3 forced refreshes within 10 s during a failing back-off → exactly +1 inside the 30 s window; the rest coalesce into ONE deferred probe", async () => {
    const { probe } = scriptedProbe([FAIL_401]);
    sched = make(probe).sched;
    sched.observe(GEN);
    await flush();
    // drive into deep back-off
    await vi.advanceTimersByTimeAsync((120 + 240 + 480) * S);
    const before = sched.invocations();
    sched.refresh("push");
    await vi.advanceTimersByTimeAsync(5 * S);
    sched.refresh("push");
    await vi.advanceTimersByTimeAsync(5 * S);
    sched.refresh("pr");
    await vi.advanceTimersByTimeAsync(20 * S - 1);
    expect(sched.invocations() - before).toBe(1);
    // Window edge: the two coalesced requests run as ONE probe, never dropped.
    await vi.advanceTimersByTimeAsync(1);
    expect(sched.invocations() - before).toBe(2);
    await vi.advanceTimersByTimeAsync(29 * S);
    expect(sched.invocations() - before).toBe(2);
  });

  it("doubt-review #3: Open PR right after Push (inside the window) is deferred, not dropped, and keeps its pr retries", async () => {
    const { probe, calls } = scriptedProbe([ABSENT, ABSENT, ABSENT, ABSENT, PR_748]);
    sched = make(probe).sched;
    sched.observe(GEN);
    await flush(); // t=0 initial probe
    await vi.advanceTimersByTimeAsync(40 * S);
    sched.refresh("push"); // t=40 forced
    await vi.advanceTimersByTimeAsync(10 * S);
    sched.refresh("pr"); // t=50 → coalesced until t=70
    await vi.advanceTimersByTimeAsync(40 * S);
    expect(calls.map((t) => t / S)).toEqual([0, 40, 70, 75, 85]);
    expect(sched.tuple().gitPrNumber).toBe(748);
  });

  it("doubt-review #4: a pr retry that fires while a probe is in flight runs right after it settles", async () => {
    const { probe, calls } = scriptedProbe([ABSENT, ABSENT, { delayMs: 12 * S, result: ABSENT }, PR_748]);
    sched = make(probe).sched;
    sched.observe(GEN);
    await flush();
    await vi.advanceTimersByTimeAsync(40 * S);
    sched.refresh("pr"); // t=40 absent → retries at 45, 55
    await vi.advanceTimersByTimeAsync(40 * S); // 45 starts a 12 s probe; 55 fires mid-flight → runs at 57
    expect(calls.map((t) => t / S)).toEqual([0, 40, 45, 57]);
    expect(sched.tuple().gitPrNumber).toBe(748);
  });

  it("doubt-review #2: once the owning bridge is gone, a late probe result self-disposes — no further probes", async () => {
    let alive = true;
    const { probe } = scriptedProbe([{ delayMs: 5 * S, result: OPEN_747 }]);
    const onChange = vi.fn();
    sched = createPrStatusScheduler({ probe, onChange, log: () => {}, alive: () => alive });
    sched.observe(GEN);
    alive = false; // reload
    await vi.advanceTimersByTimeAsync(5 * S);
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3600 * S);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dispose clears every timer, including an in-flight probe's timeout", async () => {
    const { probe } = scriptedProbe(["hang"]);
    sched = make(probe).sched;
    sched.observe(GEN);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    sched.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("X1: back-off 120/240/480/600/600 s, keeps PR 747, logs once on failure and once on recovery", async () => {
    const { probe, calls } = scriptedProbe([OPEN_747, FAIL_401, FAIL_401, FAIL_401, FAIL_401, FAIL_401, OPEN_747]);
    const m = make(probe);
    sched = m.sched;
    sched.observe(GEN);
    await flush();
    await vi.advanceTimersByTimeAsync((120 + 240 + 480 + 600 + 600 + 600) * S);
    const gaps = calls.slice(1).map((t, i) => (t - calls[i]!) / S);
    expect(gaps.slice(0, 5)).toEqual([120, 240, 480, 600, 600]);
    expect(sched.tuple().gitPrNumber).toBe(747);
    const failLines = m.log.mock.calls.filter(([l]) => /failing/.test(l));
    expect(failLines).toHaveLength(1);
    expect(m.log.mock.calls.filter(([l]) => /recovered/.test(l))).toHaveLength(1);
  });

  it("1.7: exactly one failure line across 3 failures, then one recovery line", async () => {
    const { probe } = scriptedProbe([FAIL_401, FAIL_401, FAIL_401, ABSENT]);
    const m = make(probe);
    sched = m.sched;
    sched.observe(GEN);
    await flush();
    await vi.advanceTimersByTimeAsync((240 + 480) * S);
    expect(m.log).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600 * S);
    expect(m.log).toHaveBeenCalledTimes(2);
    expect(m.log.mock.calls[1]![0]).toMatch(/recovered/);
  });

  it("X2: a hung probe fails at 20 s; a forced refresh at +25 s starts without waiting", async () => {
    const { probe } = scriptedProbe(["hang", OPEN_747]);
    const m = make(probe);
    sched = m.sched;
    sched.observe(GEN);
    await vi.advanceTimersByTimeAsync(20 * S);
    expect(m.log).toHaveBeenCalledWith(expect.stringMatching(/timeout after 20000ms/));
    await vi.advanceTimersByTimeAsync(5 * S);
    sched.refresh("push");
    expect(probe).toHaveBeenCalledTimes(2);
    await flush();
    expect(sched.tuple().gitPrNumber).toBe(747);
  });

  it("1.8: a forced probe runs despite a long back-off", async () => {
    const { probe } = scriptedProbe([FAIL_401, OPEN_747]);
    sched = make(probe).sched;
    sched.observe(GEN);
    await flush();
    await vi.advanceTimersByTimeAsync(120 * S); // failing → next cadence probe not before +240 s
    expect(probe).toHaveBeenCalledTimes(1);
    sched.refresh("push");
    await flush();
    expect(probe).toHaveBeenCalledTimes(2);
    expect(sched.tuple().gitPrNumber).toBe(747);
  });
});

// ── integration with the one change-detector ────────────────────────────────

function makeBc(prStatus?: PrStatusScheduler) {
  const send = vi.fn();
  const bc = {
    sessionId: "A",
    connection: { send },
    lastGitBranch: undefined,
    lastGitPrJson: undefined,
    lastGitWorktreeJson: undefined,
    lastGitStatusJson: undefined,
    prStatus,
  } as unknown as BridgeContext;
  return { bc, send };
}

/**
 * The tracker observes the PR generation, then hands CACHED state to the one
 * change-detector (no git spawn). Mirrors `git-tracker.ts`.
 */
function sendGit(bc: BridgeContext, cwd: string): void {
  bc.prStatus?.observe({ sessionId: bc.sessionId, cwd, branch: "os/x" });
  sendGitInfoIfChanged(bc, { info: { gitBranch: "os/x" } });
}

describe("sendGitInfoIfChanged + PR tuple", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("P1: the tick never waits for gh — branch update is sent before any PR field; PR arrives later", async () => {
    const { probe } = scriptedProbe([{ delayMs: 10 * S, result: OPEN_747 }]);
    let bcRef: BridgeContext | undefined;
    const sched = createPrStatusScheduler({
      probe,
      onChange: () => bcRef && sendGit(bcRef, "/r/.worktrees/x"),
      log: () => {},
    });
    const { bc, send } = makeBc(sched);
    bcRef = bc;
    const t0 = Date.now();
    sendGit(bc, "/r/.worktrees/x"); // synchronous — returns before the 10 s probe
    expect(Date.now()).toBe(t0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ type: "git_info_update", gitBranch: "os/x" });
    expect(send.mock.calls[0]![0]).not.toHaveProperty("gitPrNumber");
    await vi.advanceTimersByTimeAsync(10 * S);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toMatchObject({ gitPrNumber: 747, gitPrState: "open", gitPrChecks: "passing" });
    sched.dispose();
  });

  it("1.6: a checks-only change → exactly one update; unchanged → none", async () => {
    const checksOnly: PrStatusProbe = { kind: "parsed", value: { ...(OPEN_747 as any).value, checks: "failing" } };
    const { probe } = scriptedProbe([OPEN_747, checksOnly]);
    let bcRef: BridgeContext | undefined;
    const sched = createPrStatusScheduler({ probe, onChange: () => bcRef && sendGit(bcRef, "/r"), log: () => {}, now: () => 1 });
    const { bc, send } = makeBc(sched);
    bcRef = bc;
    sendGit(bc, "/r");
    await vi.advanceTimersByTimeAsync(0);
    send.mockClear();
    sendGit(bc, "/r"); // unchanged
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120 * S); // checks flip passing → failing
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ gitPrChecks: "failing", gitPrNumber: 747 });
    sched.dispose();
  });

  it("F5: reconnect re-sends the cached tuple — all six PR fields", async () => {
    const { probe } = scriptedProbe([OPEN_747]);
    const sched = createPrStatusScheduler({ probe, onChange: () => {}, log: () => {} });
    const { bc, send } = makeBc(sched);
    sendGit(bc, "/r");
    await vi.advanceTimersByTimeAsync(0);
    send.mockClear();
    resetReconnectCaches(bc); // onReconnect → register → re-emit
    sendGit(bc, "/r");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      gitPrNumber: 747,
      gitPrUrl: "https://github.com/o/r/pull/747",
      gitPrState: "open",
      gitPrDraft: false,
      gitPrChecks: "passing",
      gitPrCheckedAt: 0,
    });
    expect(probe).toHaveBeenCalledTimes(1); // no re-probe for the same generation
    sched.dispose();
  });
});

describe("branch-change throttle (E32, optimize-polling-hot-paths)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("E32: 5 branches in 60 s → at most 2 branch-change probes, the last for the final branch", async () => {
    const probedCwds: string[] = [];
    const probe = vi.fn(async (cwd: string) => {
      probedCwds.push(cwd);
      return ABSENT;
    });
    const sched = createPrStatusScheduler({ probe, onChange: () => {}, log: () => {} });
    const branches = ["b1", "b2", "b3", "b4", "b5"];
    const probedBranches: string[] = [];
    // The probe has no branch parameter; record the generation's branch at start.
    let current = "";
    const origProbe = probe.getMockImplementation()!;
    probe.mockImplementation(async (cwd: string) => {
      probedBranches.push(current);
      return origProbe(cwd);
    });
    for (let i = 0; i < branches.length; i++) {
      current = branches[i]!;
      sched.observe({ sessionId: "A", cwd: "/r", branch: current });
      await vi.advanceTimersByTimeAsync(12 * S);
    }
    await vi.advanceTimersByTimeAsync(2 * S);
    // First observation is free, then ≤ one branch-driven start per 30 s.
    expect(probe.mock.calls.length).toBeLessThanOrEqual(3);
    expect(probedBranches.at(-1)).toBe("b5");
    sched.dispose();
  });

  it("CR: a deferred branch probe is cancelled when another probe already started for the latest branch", async () => {
    let release!: () => void;
    let first = true;
    const probe = vi.fn(() => {
      if (first) {
        first = false;
        return new Promise<PrStatusProbe>((r) => (release = () => r(ABSENT)));
      }
      return Promise.resolve(ABSENT);
    });
    const sched = createPrStatusScheduler({ probe, onChange: () => {}, log: () => {} });
    sched.observe({ sessionId: "A", cwd: "/r", branch: "b1" }); // probe 1 in flight
    await vi.advanceTimersByTimeAsync(5 * S);
    sched.observe({ sessionId: "B", cwd: "/r", branch: "b1" }); // session change: pendingStart, deferred behind probe 1
    await vi.advanceTimersByTimeAsync(1 * S);
    sched.observe({ sessionId: "B", cwd: "/r", branch: "b2" }); // branch change inside the window: arms the deferred timer
    release(); // probe 1 settles: pump() starts the probe for b2 through pendingStart
    await vi.advanceTimersByTimeAsync(60 * S); // well past the deferred timer (cadence is 120 s)
    // probe 1 + exactly ONE probe for the latest branch (the timer must not start a second)
    expect(probe).toHaveBeenCalledTimes(2);
    sched.dispose();
  });

  it("a session change is never throttled", async () => {
    const probe = vi.fn(async () => ABSENT);
    const sched = createPrStatusScheduler({ probe, onChange: () => {}, log: () => {} });
    sched.observe({ sessionId: "A", cwd: "/r", branch: "b" });
    await vi.advanceTimersByTimeAsync(0);
    sched.observe({ sessionId: "B", cwd: "/r", branch: "b" });
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(2);
    sched.dispose();
  });
});

describe("git_info_refresh dispatch (1.8, #X3b)", () => {
  it("consumes git_info_refresh and forwards a valid reason", () => {
    const refresh = vi.fn();
    expect(handleGitInfoRefresh({ type: "git_info_refresh", reason: "pr" }, { refresh })).toBe(true);
    expect(refresh).toHaveBeenCalledWith("pr");
  });

  it("an unknown reason is ignored without throwing or probing", () => {
    const refresh = vi.fn();
    expect(() => handleGitInfoRefresh({ type: "git_info_refresh", reason: "merge" }, { refresh })).not.toThrow();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("other message types pass through untouched", () => {
    const refresh = vi.fn();
    expect(handleGitInfoRefresh({ type: "stop_after_turn" }, { refresh })).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });
});
