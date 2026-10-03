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
import { drainDisposables, feedPollingEvent, routeGitInfoRefresh, scheduleModelRecheckOnSelect } from "../bridge-polling.js";
import { sendModelUpdateIfChanged } from "../model-tracker.js";
import { __resetPollCostForTests, pollCost } from "../poll-cost.js";
import { scanChildProcesses } from "../process-scanner.js";

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
    expect(SRC).toContain("routeGitInfoRefresh(msg, { prStatus, gitTracker })");
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
    expect(entry).toContain("feedPollingEvent(eventType, event, { processScan, gitTracker })");
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

describe("teardown and no stacking (X5–X7)", () => {
  it("X7: disposables are drained AFTER the subagent re-entry return, so a subagent never disposes the parent's", () => {
    const init = region("function initBridge(pi: ExtensionAPI) {", "// Bump generation");
    expect(init.indexOf("isBridgeReentry(prev, pi)")).toBeGreaterThanOrEqual(0);
    expect(init.indexOf("drainDisposables(prev)")).toBeGreaterThan(init.indexOf("isBridgeReentry(prev, pi)"));
    expect(init.indexOf("drainDisposables(prev)")).toBeGreaterThan(init.indexOf("prev.timers = [];"));
  });

  it("X5: state.cleanup and session_shutdown both drain the disposables", () => {
    expect(region("state.cleanup = () => {", "// Dev build & restart")).toContain("drainDisposables(s)");
    expect(region('pi.on("session_shutdown"', "sendShutdownUsageThenUnregister(")).toContain("drainDisposables(getBridgeState())");
  });

  it("X6: the scan scheduler and git tracker are disposed before being recreated", () => {
    const scan = region("processScan?.dispose();", "scheduler.start();");
    expect(scan.indexOf("processScan?.dispose()")).toBeLessThan(scan.indexOf("createProcessScanScheduler("));
    expect(region("function renewGitTracker()", "return gitTracker;")).toContain("gitTracker?.dispose()");
    // One registered disposable per kind, created once at init (not per session_start).
    expect(SRC.match(/registerDisposable\(\(\) => \{ processScan\?\.dispose\(\)/g)).toHaveLength(1);
    expect(SRC.match(/registerDisposable\(\(\) => \{ gitTracker\?\.dispose\(\)/g)).toHaveLength(1);
  });

  it("no setInterval remains for the process scan", () => {
    expect(SRC).not.toContain("processScanTimer");
    expect(SRC).not.toContain("PROCESS_SCAN_INTERVAL");
  });
});
