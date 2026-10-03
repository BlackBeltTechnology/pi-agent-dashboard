/**
 * Bridge wiring contracts for the poll-cost work (change:
 * optimize-polling-hot-paths). No test instantiates `initBridge` (it opens a
 * WebSocket, mDNS and timers at load), so — like `bridge-coalesced-chat-order`
 * — placement is asserted against the real source and behaviour against the
 * real pure pieces.
 *
 * The seams live in `bridge-polling.ts` (real functions, driven here); the
 * source assertions pin that `bridge.ts` still calls them and where.
 *
 * test-plan ids: E39 E40 E41 X5 X6 X7.
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeContext } from "../bridge-context.js";
import {
  createPollingHolder,
  drainDisposables,
  ensureDisposable,
  feedPollingEvent,
  routeGitInfoRefresh,
  scheduleModelRecheckOnSelect,
  teardownPreviousIncarnation,
} from "../bridge-polling.js";
import { createGitTracker } from "../git-tracker.js";
import { sendModelUpdateIfChanged } from "../model-tracker.js";
import { __resetPollCostForTests, pollCost } from "../poll-cost.js";
import { createProcessScanScheduler } from "../process-scan-scheduler.js";
import { scanChildProcesses } from "../process-scanner.js";
import { GitFactsCache } from "../vcs-info.js";

const SRC = fs.readFileSync(new URL("../bridge.ts", import.meta.url), "utf8");

function region(from: string, to: string): string {
  const start = SRC.indexOf(from);
  expect(start, `missing anchor: ${from}`).toBeGreaterThanOrEqual(0);
  const end = SRC.indexOf(to, start + from.length);
  expect(end, `missing terminator: ${to}`).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("model_select pushes a model_update (E39/E40)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** The bridge's real seam: `scheduleModelRecheckOnSelect` + the real change-detector. */
  function bridge(ctx: { model: { provider: string; id: string } }) {
    const sent: any[] = [];
    const bc = {
      sessionId: "S",
      cachedCtx: ctx,
      pi: { getThinkingLevel: () => "high" },
      connection: { send: (m: any) => sent.push(m) },
      lastModel: "anthropic/claude",
      lastThinkingLevel: "high",
    } as unknown as BridgeContext;
    const onModelSelect = () =>
      scheduleModelRecheckOnSelect((fn, ms) => setTimeout(fn, ms), () => sendModelUpdateIfChanged(bc));
    return { sent, onModelSelect };
  }

  it("E39: no update before 50 ms, exactly one at 50 ms once ctx reflects the new model", async () => {
    const ctx = { model: { provider: "anthropic", id: "claude" } };
    const { sent, onModelSelect } = bridge(ctx);
    ctx.model = { provider: "openai", id: "gpt" };
    onModelSelect();
    await vi.advanceTimersByTimeAsync(49);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "model_update", model: "openai/gpt" });
  });

  it("E40: same model + thinking level → no update", async () => {
    const { sent, onModelSelect } = bridge({ model: { provider: "anthropic", id: "claude" } });
    onModelSelect();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(0);
  });

  it("the bridge's model_select branch uses the seam through the timer registry (no second pi.on)", () => {
    const branch = region('if (eventType === "model_select") {', "// Pi 0.71+ fires a dedicated thinking_level_select");
    expect(branch).toContain("scheduleModelRecheckOnSelect(setRegisteredTimeout, sendModelUpdateIfChanged)");
    expect(SRC.match(/pi\.on\("model_select"/g)).toBeNull();
  });
});

describe("git_info_refresh routing (B1)", () => {
  it("EVERY refresh reason reaches the tracker; the PR scheduler keeps its own reason handling", () => {
    for (const reason of ["push", "pr", "something-else", undefined]) {
      const tracker = { refresh: vi.fn() };
      const prStatus = { refresh: vi.fn() };
      expect(routeGitInfoRefresh({ type: "git_info_refresh", reason }, { prStatus, gitTracker: tracker })).toBe(true);
      expect(tracker.refresh).toHaveBeenCalledTimes(1);
      expect(prStatus.refresh).toHaveBeenCalledTimes(reason === "push" || reason === "pr" ? 1 : 0);
    }
  });

  it("other messages are not consumed and do not refresh", () => {
    const tracker = { refresh: vi.fn() };
    expect(routeGitInfoRefresh({ type: "send_prompt" }, { prStatus: { refresh: vi.fn() }, gitTracker: tracker })).toBe(false);
    expect(tracker.refresh).not.toHaveBeenCalled();
  });

  it("a missing tracker is tolerated", () => {
    expect(routeGitInfoRefresh({ type: "git_info_refresh", reason: "pr" }, { prStatus: { refresh: vi.fn() }, gitTracker: null })).toBe(true);
  });

  it("the bridge routes inbound messages through the seam", () => {
    expect(SRC).toContain("routeGitInfoRefresh(msg, { prStatus, gitTracker: polling.gitTracker })");
  });
});

describe("lifecycle events feed the polling machinery", () => {
  it("maps agent/tool events to the scan cadence; a tool end also reaches the git tracker", () => {
    const processScan = { onAgentStart: vi.fn(), onAgentEnd: vi.fn(), onToolStart: vi.fn(), onToolEnd: vi.fn() } as any;
    const gitTracker = { onToolEnd: vi.fn() };
    const deps = { processScan, gitTracker };
    feedPollingEvent("agent_start", undefined, deps);
    feedPollingEvent("agent_end", undefined, deps);
    feedPollingEvent("tool_execution_start", { toolName: "bash" }, deps);
    feedPollingEvent("message_update", undefined, deps);
    expect(processScan.onAgentStart).toHaveBeenCalledTimes(1);
    expect(processScan.onAgentEnd).toHaveBeenCalledTimes(1);
    expect(processScan.onToolStart).toHaveBeenCalledTimes(1);
    expect(gitTracker.onToolEnd).not.toHaveBeenCalled();
    feedPollingEvent("tool_execution_end", { toolName: "Bash" }, deps);
    expect(processScan.onToolEnd).toHaveBeenCalledWith("Bash");
    expect(gitTracker.onToolEnd).toHaveBeenCalledWith("Bash");
  });

  it("null schedulers are tolerated (before session_start / after shutdown)", () => {
    expect(() => feedPollingEvent("tool_execution_end", {}, { processScan: null, gitTracker: null })).not.toThrow();
  });

  it("the bridge feeds events AFTER the parked-text flush choke point", () => {
    const entry = region("if (flushesParkedText(eventType)) coalescer.flush();", "// Track agent streaming state");
    expect(entry).toContain("feedPollingEvent(eventType, event, polling)");
  });
});

describe("poll-cost counters ride the heartbeat (E41)", () => {
  beforeEach(() => __resetPollCostForTests());

  it("one scan advances pollProcScanRuns/Spawns; the heartbeat spreads the counter object", () => {
    const spawn = vi.fn(() => ({ status: 0, stdout: "  100  1  100 05:00 pi\n", stderr: "", pid: 0, output: [], signal: null }));
    scanChildProcesses(100, new Set(), 0, { _spawnSync: spawn as any, _platform: "linux" });
    expect(pollCost.pollProcScanRuns).toBe(1);
    expect(pollCost.pollProcScanSpawns).toBe(1);
    expect(Object.keys({ ...pollCost }).sort()).toEqual(
      [
        "pollGitMs", "pollGitProbesRefresh", "pollGitProbesTick", "pollGitProbesTool", "pollGitProbesWatch",
        "pollGitSpawns", "pollGitWatchersAttached", "pollProcScanMs", "pollProcScanRuns", "pollProcScanSpawns",
      ].sort(),
    );
    expect(region("metrics: {", "HEARTBEAT_INTERVAL")).toContain("...pollCost");
  });
});

describe("ensureDisposable (shutdown → later session_start)", () => {
  it("registers a stable reference once and re-registers it after a drain", () => {
    const state: { disposables?: Array<() => void> } = {};
    const fn = vi.fn();
    ensureDisposable(state, fn);
    ensureDisposable(state, fn);
    expect(state.disposables).toHaveLength(1);
    drainDisposables(state); // session_shutdown
    expect(fn).toHaveBeenCalledTimes(1);
    ensureDisposable(state, fn); // the next session_start in the same incarnation
    expect(state.disposables).toHaveLength(1);
    drainDisposables(state); // the next reload/cleanup still disposes
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("drainDisposables (X5/X7)", () => {
  it("runs every disposable once, tolerates a throwing one, and clears the list", () => {
    const order: string[] = [];
    const state = {
      disposables: [
        () => order.push("scan"),
        () => { throw new Error("boom"); },
        () => order.push("git"),
      ],
    };
    drainDisposables(state);
    expect(order).toEqual(["scan", "git"]);
    expect(state.disposables).toEqual([]);
    drainDisposables(state); // idempotent
    expect(order).toEqual(["scan", "git"]);
  });

  it("tolerates a state with no disposables", () => {
    const state: { disposables?: Array<() => void> } = {};
    expect(() => drainDisposables(state)).not.toThrow();
    expect(state.disposables).toEqual([]);
  });
});

describe("polling lifecycle — the bridge's real seams (X5–X7)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const liveScan = () => {
    const scan = vi.fn(async () => ({ changed: false }));
    return { sched: createProcessScanScheduler({ scan, platform: "linux" }), scan };
  };
  const liveTracker = () => {
    const bc = { sessionId: "s", connection: { send: vi.fn() } } as unknown as BridgeContext;
    const statusProbe = vi.fn(async () => ({ ok: true as const, value: { dirtyCount: 0, staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 } }));
    const tracker = createGitTracker({
      getBc: () => bc,
      applyBc: () => {},
      isActive: () => true,
      facts: new GitFactsCache({
        evaluate: () => ({ roots: null, gitDir: "/r/.git", dotGitStamp: "s" }),
        evaluateAsync: async () => ({ roots: null, gitDir: "/r/.git", dotGitStamp: "s" }),
        stamp: () => "s",
      }),
      statusProbe: statusProbe as any,
      headReader: () => ({ read: () => "main", reset: () => {} }),
      watch: (() => ({ close: () => {}, on: () => ({}) })) as any,
    });
    return { tracker, bc, statusProbe };
  };

  it("X6: replacing the scheduler/tracker (new, fork, resume, reload ×3) never stacks live instances", async () => {
    const polling = createPollingHolder();
    const scans: ReturnType<typeof liveScan>[] = [];
    const trackers: ReturnType<typeof liveTracker>[] = [];
    for (let i = 0; i < 4; i++) {
      const s = liveScan();
      scans.push(s);
      polling.replaceProcessScan(s.sched);
      s.sched.start();
      const t = liveTracker();
      trackers.push(t);
      polling.replaceGitTracker(t.tracker).evaluateFirst(t.bc, "/r");
    }
    await vi.advanceTimersByTimeAsync(60_000);
    // Only the last scheduler/tracker run; the three superseded ones are silent.
    expect(scans.slice(0, 3).every((s) => s.scan.mock.calls.length === 0)).toBe(true);
    expect(scans[3]!.scan.mock.calls.length).toBeGreaterThan(0);
    expect(trackers.slice(0, 3).every((t) => t.statusProbe.mock.calls.length === 0)).toBe(true);
    expect(trackers[3]!.statusProbe.mock.calls.length).toBeGreaterThan(0);
    polling.disposeAll();
  });

  it("X5: disposeAll with a scan and a probe still pending → no late send, nothing re-armed", async () => {
    const polling = createPollingHolder();
    let releaseScan!: () => void;
    const scan = vi.fn(() => new Promise<{ changed: boolean }>((r) => (releaseScan = () => r({ changed: true }))));
    const sched = createProcessScanScheduler({ scan, platform: "linux" });
    polling.replaceProcessScan(sched);
    sched.start();
    let releaseProbe!: (v: unknown) => void;
    const { tracker, bc } = liveTracker();
    const slowTracker = createGitTracker({
      getBc: () => bc,
      applyBc: () => {},
      isActive: () => true,
      facts: new GitFactsCache({ evaluate: () => ({ roots: null, gitDir: "/r/.git", dotGitStamp: "s" }), evaluateAsync: async () => ({ roots: null, gitDir: "/r/.git", dotGitStamp: "s" }), stamp: () => "s" }),
      statusProbe: (() => new Promise((r) => (releaseProbe = r))) as any,
      headReader: () => ({ read: () => "main", reset: () => {} }),
      watch: (() => ({ close: () => {}, on: () => ({}) })) as any,
    });
    tracker.dispose();
    polling.replaceGitTracker(slowTracker).evaluateFirst(bc, "/r");
    await vi.advanceTimersByTimeAsync(6_000); // scan + probe are in flight
    const sendsBefore = (bc.connection.send as any).mock.calls.length;
    polling.disposeAll();
    releaseScan();
    releaseProbe({ ok: true, value: { dirtyCount: 9, staged: 0, unstaged: 0, untracked: 9, ahead: 0, behind: 0 } });
    await vi.advanceTimersByTimeAsync(120_000);
    expect((bc.connection.send as any).mock.calls.length).toBe(sendsBefore);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(polling.processScan).toBeNull();
    expect(polling.gitTracker).toBeNull();
  });

  it("X7: a subagent re-entry returns false and touches NOTHING of the parent's", () => {
    const prev = {
      cleanup: vi.fn(),
      connections: [{ disconnect: vi.fn() }],
      timers: [setInterval(() => {}, 1000)],
      disposables: [vi.fn()],
    };
    const dispose = prev.disposables[0]!;
    expect(teardownPreviousIncarnation(prev, () => true)).toBe(false);
    expect(prev.cleanup).toHaveBeenCalledTimes(0);
    expect(prev.connections[0]!.disconnect).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(prev.timers).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    clearInterval(prev.timers[0]!);
  });

  it("a real re-init cleans the previous incarnation: cleanup, connections, timers and disposables", () => {
    const order: string[] = [];
    const prev: any = {
      cleanup: () => order.push("cleanup"),
      connections: [{ disconnect: () => order.push("disconnect") }],
      timers: [setInterval(() => {}, 1000), setTimeout(() => {}, 5000)],
      disposables: [() => order.push("dispose-a"), () => { throw new Error("x"); }, () => order.push("dispose-b")],
    };
    expect(teardownPreviousIncarnation(prev, () => false)).toBe(true);
    expect(order).toEqual(["cleanup", "disconnect", "dispose-a", "dispose-b"]);
    expect(prev.cleanup).toBeUndefined();
    expect(prev.connections).toEqual([]);
    expect(prev.timers).toEqual([]);
    expect(prev.disposables).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bridge.ts uses these seams: holder for both schedulers, one disposeAll disposable, teardown helper, drain at shutdown/cleanup", () => {
    expect(SRC).toContain("createPollingHolder()");
    expect(SRC).toContain("const disposePolling = () => polling.disposeAll();");
    expect(SRC.match(/ensurePollingDisposable\(\);/g)!.length).toBeGreaterThanOrEqual(3); // init + renewGitTracker + scan wiring
    expect(SRC).toContain("teardownPreviousIncarnation(prev, () => isBridgeReentry(prev, pi))");
    expect(region("state.cleanup = () => {", "// Dev build & restart")).toContain("drainDisposables(s)");
    expect(region('pi.on("session_shutdown"', "sendShutdownUsageThenUnregister(")).toContain("drainDisposables(getBridgeState())");
    expect(region("const scheduler = createProcessScanScheduler({", "scheduler.start();")).toContain("polling.replaceProcessScan(scheduler)");
    expect(SRC).not.toContain("processScanTimer");
  });
});
