/**
 * Bridge wiring contracts for the poll-cost work (change:
 * optimize-polling-hot-paths). No test instantiates `initBridge` (it opens a
 * WebSocket, mDNS and timers at load), so — like `bridge-coalesced-chat-order`
 * — placement is asserted against the real source and behaviour against the
 * real pure pieces.
 *
 * test-plan ids: E39 E40 E41 X5 X6 X7.
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeContext } from "../bridge-context.js";
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

  /** Reduced model of the forwarder branch: forward, then defer the check by 50 ms. */
  function model(ctxModel: { model: { provider: string; id: string } }) {
    const sent: any[] = [];
    const bc = {
      sessionId: "S",
      cachedCtx: ctxModel,
      pi: { getThinkingLevel: () => "high" },
      connection: { send: (m: any) => sent.push(m) },
      lastModel: "anthropic/claude",
      lastThinkingLevel: "high",
    } as unknown as BridgeContext;
    const onModelSelect = () => setTimeout(() => sendModelUpdateIfChanged(bc), 50);
    return { bc, sent, onModelSelect };
  }

  it("E39: no update before 50 ms, exactly one at 50 ms once ctx reflects the new model", async () => {
    const ctx = { model: { provider: "anthropic", id: "claude" } };
    const { sent, onModelSelect } = model(ctx);
    ctx.model = { provider: "openai", id: "gpt" };
    onModelSelect();
    await vi.advanceTimersByTimeAsync(49);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "model_update", model: "openai/gpt" });
  });

  it("E40: same model + thinking level → no update", async () => {
    const { sent, onModelSelect } = model({ model: { provider: "anthropic", id: "claude" } });
    onModelSelect();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toHaveLength(0);
  });

  it("source: the existing forwarder branch defers the check by 50 ms through the timer registry", () => {
    const branch = region('if (eventType === "model_select") {', "// Pi 0.71+ fires a dedicated thinking_level_select");
    expect(branch).toContain("setRegisteredTimeout(() => sendModelUpdateIfChanged(), 50)");
    // No second pi.on subscription for model_select.
    expect(SRC.match(/pi\.on\("model_select"/g)).toBeNull();
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
