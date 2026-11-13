import type { ToolRowFinalizer } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  registerSessionEventReducer, registerToolRowFinalizer, setSessionReducerEnabledSet,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { __resetSessionReducersForTests } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentFinalizerState, toolRowFinalizers } from "../../../../subagents-plugin/src/client/toolRowFinalizer.js";
import { disableSubagentsPlugin, registerSubagentsReducerSlice } from "../../test-support/subagents-reducer-slice.js";
import {
  createInitialState, finalizeBackfillSegment, reduceEvent, type SessionState,
  SUBAGENT_STOPPED_SENTINEL_BODY, seedRunningToolCall,
} from "../chat/event-reducer.js";
import { assertLifecycle, lifecycle } from "./fixtures/tool-map-generated.js";
import { burst, end, event, historical, observe, random, retain, row, start, text, tick } from "./fixtures/tool-map-ownership.js";

// Native discovery collects this suite in the client jsdom project; no private runner/config.
afterEach(() => {
  __resetSessionReducersForTests();
  registerSubagentsReducerSlice();
});

function elided(id: string, agentId?: string): SessionState {
  const state = reduceEvent(createInitialState(), start(id, "Agent"));
  return {
    ...state, toolCalls: new Map(),
    messages: finalizeBackfillSegment(state.messages).map((m) => ({ ...m, ...(agentId ? { toolDetails: { agentId } } : {}) })),
  };
}

function captureRealFinalizer() {
  __resetSessionReducersForTests();
  registerSubagentsReducerSlice();
  const real = toolRowFinalizers[0];
  const inputs: AgentFinalizerState[] = [];
  const priors: AgentFinalizerState[] = [];
  const nested: AgentFinalizerState[] = [];
  const returned: AgentFinalizerState[] = [];
  const checks: (() => void)[] = [];
  const hooks: ToolRowFinalizer<AgentFinalizerState> = { toolName: "Agent" };
  for (const hook of ["onSessionEvent", "onToolExecution"] as const) {
    hooks[hook] = (state, e, opts) => {
      inputs.push(state);
      checks.push(retain(state));
      if (opts?.prior) { priors.push(opts.prior); checks.push(retain(opts.prior)); }
      const result = real[hook]?.(state, e, {
        ...opts,
        reduce: (s, reentrant) => {
          nested.push(s);
          checks.push(retain(s));
          return opts!.reduce!(s, reentrant);
        },
      });
      if (result) { returned.push(result); checks.push(retain(result)); }
      return result;
    };
  }
  registerToolRowFinalizer("subagents", hooks);
  return { inputs, priors, nested, returned, check: () => checks.forEach((check) => check()) };
}

function assertTextOwnership(size: number, flushed: boolean, plugin: boolean) {
  __resetSessionReducersForTests();
  if (plugin) registerSessionEventReducer<SessionState>("reader", { eventTypes: ["cow_read"], reduce: (s) => s });
  const before = { ...historical(size), streamingText: "old", streamingTextFlushed: flushed };
  const check = retain(before);
  const result = reduceEvent(before, text("replacement"));
  expect(result.toolCalls).toBe(before.toolCalls);
  expect(result.streamingText).toBe(flushed ? "old" : "replacement");
  const read = reduceEvent(result, event(plugin ? "cow_read" : "turn_end"));
  expect(read.toolCalls).toBe(before.toolCalls);
  check();
}

function assertElidedRevive(terminal: boolean, partial: boolean) {
  const captured = captureRealFinalizer();
  let state = elided("rev", "ag-rev");
  if (terminal) state = reduceEvent(state, event("subagent_completed", { id: "ag-rev", result: "R" }));
  const check = retain(state);
  const result = reduceEvent(state, partial ? tick("rev", "ag-rev") : event("tool_execution_update", { toolCallId: "rev", toolName: "Agent" }));
  expect(row(result, "rev")?.toolStatus).toBe(terminal ? "elided" : "running");
  expect(result.toolCalls.has("rev")).toBe(!terminal);
  reduceEvent(result, end("rev", "real", "Agent"));
  check(); captured.check();
}

function assertCallbackContract(isLive: boolean, mode: "disabled" | "decline" | "read" | "copy") {
  __resetSessionReducersForTests();
  const calls: string[] = [];
  const checks: (() => void)[] = [];
  const initial = reduceEvent(createInitialState(), start("tc", "Agent"));
  let returned: SessionState | undefined;
  registerSessionEventReducer<SessionState>("test", {
    eventTypes: ["cow_read"], reduce: (s, _e, opts) => { calls.push("slice"); expect(opts?.isLive).toBe(isLive); checks.push(retain(s)); return s; },
  });
  registerToolRowFinalizer<SessionState>("test", {
    toolName: "Agent",
    onSessionEvent: (s, _e, opts) => { calls.push("session"); expect(opts?.isLive).toBe(isLive); checks.push(retain(s)); return mode === "decline" ? undefined : s; },
    onToolExecution: (s, _e, opts) => {
      if (_e.eventType !== "tool_execution_update") return undefined;
      calls.push("tool"); expect(opts?.isLive).toBe(isLive);
      expect(opts?.prior?.toolCalls.get("tc")?.status).toBe("running");
      expect(row(opts!.prior!, "tc")?.result).toBeUndefined();
      checks.push(retain(s), retain(opts!.prior!));
      if (mode === "decline") return undefined;
      returned = mode === "copy" ? { ...s, toolCalls: new Map(s.toolCalls) } : s;
      checks.push(retain(returned));
      return returned;
    },
  });
  if (mode === "disabled") setSessionReducerEnabledSet(new Set());
  const updated = reduceEvent(initial, tick("tc", "ag"), { isLive });
  expect(calls).toEqual(mode === "disabled" ? [] : ["tool"]);
  expect(updated.toolCalls === initial.toolCalls).toBe(mode !== "copy");
  if (returned) expect(updated).toBe(returned);
  calls.length = 0;
  const session = reduceEvent(updated, event("cow_read"), { isLive });
  expect(calls).toEqual(mode === "disabled" ? [] : mode === "decline" ? ["session", "slice"] : ["session"]);
  reduceEvent(session, end("tc", "later", "Agent"));
  checks.forEach((check) => check());
}

function measureNoWriteWorkload(size: number, plugin: boolean) {
  __resetSessionReducersForTests();
  if (plugin) registerSessionEventReducer<SessionState>("reader", { eventTypes: ["cow_read"], reduce: (s) => s });
  let state = historical(size);
  const original = state.toolCalls;
  let copies = 0;
  let enumerations = 0;
  let changedMaps = 0;
  const began = performance.now();
  for (let i = 0; i < 1000; i++) {
    const probe = observe(state.toolCalls);
    const before = state.toolCalls;
    try {
      state = reduceEvent(state, i % 3 === 0 ? text(`text-${i}`) : i % 3 === 1
        ? event("message_update", { assistantMessageEvent: { type: "thinking_delta", delta: "x" } })
        : event(plugin ? "cow_read" : "turn_end"));
      if (state.toolCalls !== before) changedMaps++;
      copies += probe.counts().copies;
      enumerations += probe.counts().enumerations;
    } finally { probe.restore(); }
  }
  console.info("COW P1", JSON.stringify({ size, plugin, copies, enumerations, changedMaps, elapsedMs: performance.now() - began }));
  expect(state).toEqual({ ...historical(size), streamingText: "text-999", streamingThinking: "x".repeat(333) });
  expect(state.toolCalls).toEqual(original);
  return { copies, enumerations, changedMaps };
}

function assertLifecycleSeed(seed: number) {
  const draw = random(seed);
  const size = seed % 2 === 0 ? 0 : 1 + draw(64);
  const generated = lifecycle(seed);
  const id = `rev-${seed}`;
  const transitions = [
    { e: event("tool_execution_update", { toolCallId: id }), status: "running", result: undefined },
    { e: event("tool_execution_end", { toolCallId: id, toolName: "Agent", result: "heal", healedBy: "session_ended", isError: true }), status: "error", result: "heal" },
    { e: event("tool_execution_update", { toolCallId: id, partialResult: "alive" }), status: "running", result: "alive" },
    { e: end(id, `real-${seed}`, "Agent"), status: "complete", result: `real-${seed}` },
  ];
  const context = `seed=${seed} initialCompleted=${size} actions=${JSON.stringify(generated.actions)} elidedId=${id} healRevive=${JSON.stringify(transitions)}`;
  expect(generated.actions.length, context).toBeLessThanOrEqual(64);
  let state = historical(size);
  const checks: (() => void)[] = [];
  try {
    for (const action of generated.actions) {
      checks.push(retain(state));
      const previous = state.toolCalls;
      state = reduceEvent(state, action.event);
      assertLifecycle(state, action.expected);
      if (action.noWrite) expect(state.toolCalls, context).toBe(previous);
      checks.forEach((check) => check());
    }
    // Backfill-elided -> running -> session-ended -> running -> real end.
    // Expectations describe the lifecycle; no oracle calls the reducer.
    state = { ...elided(id), toolCalls: state.toolCalls };
    expect(generated.actions.length + transitions.length, context).toBeLessThanOrEqual(64);
    for (const transition of transitions) {
      checks.push(retain(state));
      state = reduceEvent(state, transition.e);
      expect(state.toolCalls.get(id)?.status, context).toBe(transition.status);
      expect(row(state, id)?.toolStatus, context).toBe(transition.status);
      expect(row(state, id)?.result, context).toBe(transition.result);
      checks.forEach((check) => check());
    }
  } catch (error) { throw new Error(context, { cause: error }); }

  return { size, generated };
}

function createAgentSeed(seed: number) {
  const draw = random(seed);
  const id = `agent-${seed}-${draw(1000)}`;
  const agentId = `sub-${seed}-${draw(1000)}`;
  const payload = `result-${seed}-${draw(1000)}`;
  const variant = seed % 4;
  const isLive = seed % 2 === 0;
  const captured = captureRealFinalizer();
  let state = variant === 1 || variant === 2
    ? elided(id, agentId)
    : reduceEvent(reduceEvent(historical(draw(65)), start(id, "Agent")), tick(id, agentId));
  if (variant === 2) state = reduceEvent(state, event("subagent_completed", { id: agentId, result: payload }));
  if (variant === 3) state = reduceEvent(state, event("tool_execution_end", { toolCallId: id, toolName: "Agent", healedBy: "session_ended", isError: true, result: "heal" }));
  // Keep a live nested array in published maps. Completion must replace it
  // with unfinished entries; no retained callback may observe that change.
  if (variant === 0) state = reduceEvent(state, event("tool_execution_start", { toolCallId: `${id}/1`, parentToolCallId: id, toolName: "read" }));
  const initial = state;
  const check = retain(state);
  const context = `seed=${seed} variant=${variant} isLive=${isLive} callbackPartition=${seed % 5} input=${JSON.stringify({
    initial,
    actions: [tick(id, agentId), ...(variant !== 2 ? [event("subagent_completed", { id: agentId, result: payload })] : []), end(id, "late real", "Agent")],
    callbackActions: [start(id, "Agent"), tick(id, agentId), event("cow_probe"), end(id, "later", "Agent")],
  }, (_key, value) => value instanceof Map ? [...value] : value)}`;

  return { seed, draw, id, agentId, payload, variant, isLive, captured, initial, state, check, context };
}

function assertAgentCompletion(fixture: ReturnType<typeof createAgentSeed>) {
  const { id, agentId, payload, variant, isLive, captured, initial, check, context } = fixture;
  let { state } = fixture;
  state = reduceEvent(state, tick(id, agentId), { isLive });
  expect(row(state, id)?.toolStatus, context).toBe(variant === 2 ? "elided" : "running");
  expect(state.toolCalls.has(id), context).toBe(variant !== 2);
  if (variant !== 2) {
    state = reduceEvent(state, event("subagent_completed", { id: agentId, result: payload }), { isLive });
    expect(state.toolCalls.get(id)?.status, context).toBe("complete");
    expect(row(state, id)?.result, context).toBe(payload);
    expect(state.subagents.get(agentId)?.status, context).toBe("completed");
    if (variant === 0) {
      expect(state.toolCalls.get(id)?.nested?.[0].status, context).toBe("unfinished");
      expect(initial.toolCalls.get(id)?.nested?.[0].status, context).toBe("running");
    }
    expect(captured.nested.length, context).toBeGreaterThan(0);
  }
  const returnedCheck = retain(state);
  state = reduceEvent(state, end(id, "late real", "Agent"));
  expect(row(state, id)?.result, context).toBe("late real");
  check(); returnedCheck(); captured.check();
  expect(initial.toolCalls.get(id)?.status, context).toBe(variant === 3 ? "error" : variant === 0 ? "running" : undefined);
  return variant !== 2;
}

function assertGeneratedCallbackPartition(fixture: ReturnType<typeof createAgentSeed>) {
  const { seed, draw, id, agentId, isLive, context } = fixture;
  // Run coherent callback partitions on a fresh linked running tool. A
  // plugin may copy independently; read/decline never justify a core copy.
  __resetSessionReducersForTests();
  const mode = (["enabled", "disabled", "decline", "read", "copy"] as const)[seed % 5];
  const calls: string[] = [];
  const snapshots: (() => void)[] = [];
  registerSessionEventReducer<SessionState>("generated", { eventTypes: ["cow_probe"], reduce: (s) => { calls.push("slice"); snapshots.push(retain(s)); return s; } });
  registerToolRowFinalizer<SessionState>("generated", {
    toolName: "Agent",
    onSessionEvent: (s, _e, opts) => {
      calls.push("session"); expect(opts?.isLive, context).toBe(isLive); snapshots.push(retain(s));
      if (mode === "decline") return undefined;
      const returned = mode === "copy" ? { ...s, toolCalls: new Map(s.toolCalls) } : s;
      snapshots.push(retain(returned)); return returned;
    },
    onToolExecution: (s, _e, opts) => {
      if (_e.eventType !== "tool_execution_update") return undefined;
      calls.push("tool"); expect(opts?.isLive, context).toBe(isLive);
      expect(row(opts!.prior!, id)?.result, context).toBeUndefined();
      snapshots.push(retain(s), retain(opts!.prior!));
      return mode === "decline" ? undefined : s;
    },
  });
  if (mode === "disabled") setSessionReducerEnabledSet(new Set());
  const base = reduceEvent(historical(draw(65)), start(id, "Agent"));
  const updated = reduceEvent(base, tick(id, agentId), { isLive });
  expect(calls, context).toEqual(mode === "disabled" ? [] : ["tool"]);
  expect(updated.toolCalls, context).toBe(base.toolCalls);
  calls.length = 0;
  const selected = reduceEvent(updated, event("cow_probe"), { isLive });
  expect(calls, context).toEqual(mode === "disabled" ? [] : mode === "decline" ? ["session", "slice"] : ["session"]);
  expect(selected.toolCalls === updated.toolCalls, context).toBe(mode !== "copy");
  reduceEvent(selected, end(id, "later", "Agent"));
  snapshots.forEach((snapshot) => snapshot());

  return mode;
}

function assertAgentSeed(seed: number) {
  const fixture = createAgentSeed(seed);
  try {
    const reentry = assertAgentCompletion(fixture);
    const mode = assertGeneratedCallbackPartition(fixture);
    return { variant: fixture.variant, isLive: fixture.isLive, reentry, mode };
  } catch (error) { throw new Error(fixture.context, { cause: error }); }
}

describe("copy-tool-state-on-write fixed ownership contracts", () => {
  it("E1: text-flush decision table shares tool state without changing previous values", () => {
    for (const size of [0, 100]) for (const flushed of [false, true]) for (const plugin of [false, true]) {
      assertTextOwnership(size, flushed, plugin);
    }
  });

  it("E2/E3: start, partial row-only update, shared text, end preserve published entries", () => {
    const initial = historical(100);
    const checks = [retain(initial)];
    const running = reduceEvent(initial, start("t1"));
    checks.push(retain(running));
    expect(running.toolCalls).not.toBe(initial.toolCalls);
    expect(running.toolCalls.get("t1")?.status).toBe("running");
    const partial = reduceEvent(running, event("tool_execution_update", { toolCallId: "t1", partialResult: "partial" }));
    checks.push(retain(partial));
    expect(partial.toolCalls).toBe(running.toolCalls);
    expect(row(partial, "t1")?.result).toBe("partial");
    const shared = reduceEvent(partial, text("next"));
    checks.push(retain(shared));
    expect(shared.toolCalls).toBe(running.toolCalls);
    const done = reduceEvent(shared, end("t1"));
    expect(done.toolCalls).not.toBe(shared.toolCalls);
    expect(done.toolCalls.get("t1")?.status).toBe("complete");
    expect(row(done, "t1")?.result).toBe("done");
    checks.forEach((check) => check());
  });

  it("E4: child/grandchild updates, record merges, root close and late real end isolate nested arrays", () => {
    let state = createInitialState();
    const checks: (() => void)[] = [];
    const actions = [
      start("root", "codemode"),
      event("tool_execution_start", { toolCallId: "root/1", parentToolCallId: "root", toolName: "codemode" }),
      event("tool_execution_start", { toolCallId: "root/1/1", parentToolCallId: "root/1", toolName: "read" }),
      event("tool_execution_update", { toolCallId: "root/1/1", parentToolCallId: "root/1", partialResult: "partial" }),
      event("tool_execution_end", { toolCallId: "root/1", parentToolCallId: "root", toolName: "codemode", result: "child done" }),
      end("root", "root done", "codemode"),
      event("tool_execution_end", { toolCallId: "root/1/1", parentToolCallId: "root/1", toolName: "read", result: "late done" }),
    ];
    for (const action of actions) {
      checks.push(retain(state));
      state = reduceEvent(state, action);
      checks.forEach((check) => check());
    }
    expect([...state.toolCalls.keys()]).toEqual(["root"]);
    expect(state.toolCalls.get("root")?.nested).toMatchObject([
      { id: "root/1", parentId: "root", status: "complete", result: "child done" },
      { id: "root/1/1", parentId: "root/1", status: "complete", result: "late done" },
    ]);
    // Existing record-envelope fixtures cover message_start/message_end as well;
    // here a replay end merges a record and closes its still-running member.
    const before = retain(state);
    const merged = reduceEvent(state, event("tool_execution_end", {
      toolCallId: "root", toolName: "codemode", result: "record", nestedCalls: {
        v: 1, complete: true, calls: [{ id: "root/2", parentId: "root", name: "read", status: "running", startedAt: 3 }],
      },
    }));
    expect(merged.toolCalls.get("root")?.nested?.find((n) => n.id === "root/2")?.status).toBe("unfinished");
    before();
  });

  it("E5: standalone/backfill seeding preserves no-op identity and input rows", () => {
    const initial = elided("seed");
    const check = retain(initial);
    const kept = finalizeBackfillSegment(reduceEvent(createInitialState(), start("kept")).messages, new Set(["kept"]));
    const noId = { ...initial.messages[0], toolCallId: undefined };
    expect(seedRunningToolCall(initial.toolCalls, noId, 4)).toBe(initial.toolCalls);
    const seeded = seedRunningToolCall(initial.toolCalls, initial.messages[0], 4, 7);
    expect(seeded).not.toBe(initial.toolCalls);
    expect(seeded.get("seed")).toMatchObject({ status: "running", emittedAtInferenceSeq: 4, startedAt: 1000 });
    expect(seedRunningToolCall(seeded, initial.messages[0], 5)).toBe(seeded);
    const terminal = new Map(seeded);
    terminal.set("seed", { ...seeded.get("seed")!, status: "complete" });
    const restored = seedRunningToolCall(terminal, initial.messages[0], 6);
    expect(restored.get("seed")).toMatchObject({ status: "running", emittedAtInferenceSeq: 6 });
    expect(terminal.get("seed")?.status).toBe("complete");
    let map = initial.toolCalls;
    for (const m of kept) if (m.toolStatus === "running") map = seedRunningToolCall(map, m, 9);
    expect(map.get("kept")).toMatchObject({ status: "running", emittedAtInferenceSeq: 9 });
    check();
  });

  it("E6/X1: missing/declining plugins, neutral settle, real terminals and malformed names", () => {
    for (const decline of [false, true]) {
      disableSubagentsPlugin();
      if (decline) registerToolRowFinalizer("decline", { toolName: "Agent", onSessionEvent: () => undefined });
      const running = reduceEvent(createInitialState(), start("agent", "Agent"));
      const check = retain(running);
      const settled = reduceEvent(running, event("agent_settled"));
      expect(settled.status).toBe("idle");
      expect(row(settled, "agent")).toMatchObject({ toolStatus: "complete", result: SUBAGENT_STOPPED_SENTINEL_BODY });
      expect(settled.toolCalls.get("agent")?.status).toBe("running");
      const done = reduceEvent(running, end("agent", "real", "Agent"));
      const keepDone = retain(done);
      const lateHeal = reduceEvent(done, event("tool_execution_end", {
        toolCallId: "agent", toolName: "Agent", result: "heal", isError: true, healedBy: "session_ended",
      }));
      expect(row(lateHeal, "agent")?.result).toBe("real");
      expect(lateHeal.toolCalls.get("agent")?.status).toBe("complete");
      check(); keepDone();
    }
    for (const toolName of [undefined, null, 17]) {
      const initial = historical(2);
      const check = retain(initial);
      const running = reduceEvent(initial, event("tool_execution_start", { toolCallId: "bad", toolName }));
      expect(row(running, "bad")?.toolName).toBe("unknown");
      expect(reduceEvent(running, end("bad")).toolCalls.get("bad")?.status).toBe("complete");
      check();
    }
  });

  it("F1: registered Agent completion re-enters without changing outer/callback running maps", () => {
    const captured = captureRealFinalizer();
    const linked = reduceEvent(reduceEvent(createInitialState(), start("tc", "Agent")), tick("tc", "ag-1"));
    const check = retain(linked);
    const result = reduceEvent(linked, event("subagent_completed", { id: "ag-1", result: "R" }));
    expect(captured.nested).toHaveLength(1);
    expect(captured.nested[0].toolCalls.get("tc")?.status).toBe("running");
    expect(result.toolCalls.get("tc")?.status).toBe("complete");
    expect(row(result, "tc")?.result).toBe("R");
    expect(result.subagents.get("ag-1")).toMatchObject({ status: "completed", result: "R" });
    reduceEvent(result, end("tc", "later", "Agent"));
    check(); captured.check();
  });

  it("F2: terminal-subagent undo removes a false seed; session-ended reopen preserves prior map", () => {
    for (const terminal of [false, true]) for (const partial of [false, true]) {
      assertElidedRevive(terminal, partial);
    }
    const captured = captureRealFinalizer();
    let state = reduceEvent(reduceEvent(createInitialState(), start("rev", "Agent")), tick("rev", "ag-rev"));
    state = reduceEvent(state, event("tool_execution_end", { toolCallId: "rev", toolName: "Agent", isError: true, result: "heal", healedBy: "session_ended" }));
    const check = retain(state);
    const reopened = reduceEvent(state, tick("rev", "ag-rev"));
    expect(reopened.toolCalls.get("rev")?.status).toBe("running");
    expect(row(reopened, "rev")?.toolStatus).toBe("running");
    check(); captured.check();
  });

  it("F3: enabled/filter/order/live/prior/selection and independent allocation contracts", () => {
    for (const isLive of [false, true]) for (const mode of ["disabled", "decline", "read", "copy"] as const) {
      assertCallbackContract(isLive, mode);
    }
  });

  it("F4 baseline: complete mixed burst state matches the reviewed eager-copy fixture", () => {
    for (const isLive of [false, true]) {
      const state = burst().reduce((s, e) => reduceEvent(s, e, { isLive }), createInitialState());
      expect(state.toolCalls.get("tc-agent")?.status).toBe("complete");
      expect(state.subagents.get("ag-fold")).toMatchObject({ status: "completed", result: "R" });
      expect(state).toMatchSnapshot(`isLive=${isLive}`);
    }
  });

  it("F4: every legal split/live-replay fold matches the retained complete fixture", () => {
    const actions = burst();
    for (const isLive of [false, true]) for (let split = 0; split <= actions.length; split++) {
      const expected = actions.reduce((s, e) => reduceEvent(s, e, { isLive }), createInitialState());
      const head = actions.slice(0, split).reduce((s, e) => reduceEvent(s, e, { isLive }), createInitialState());
      const check = retain(head);
      const result = actions.slice(split).reduce((s, e) => reduceEvent(s, e, { isLive }), head);
      expect(result).toEqual(expected);
      check();
    }
  });
});

describe("copy-tool-state-on-write deterministic work counts", () => {
  it("P1: 1000-event no-write mix at 0/100/1000/10000 historical calls", () => {
    const measurements: { copies: number; enumerations: number; changedMaps: number }[] = [];
    for (const size of [0, 100, 1000, 10000]) for (const plugin of [false, true]) {
      measurements.push(measureNoWriteWorkload(size, plugin));
    }
    expect(measurements).toEqual(Array.from({ length: 8 }, () => ({ copies: 0, enumerations: 0, changedMaps: 0 })));
  });

  it("P2: write-heavy 10000-history/500 fresh read lifecycle measurement and checkpoints", () => {
    let state = historical(10000);
    const checks = [retain(state)];
    let copies = 0;
    const began = performance.now();
    for (let i = 1; i <= 500; i++) {
      for (const action of [start(`t${i}`), end(`t${i}`, `done-${i}`)]) {
        const probe = observe(state.toolCalls);
        try { state = reduceEvent(state, action); copies += probe.counts().copies; }
        finally { probe.restore(); }
      }
      if (i === 1 || i === 250) checks.push(retain(state));
    }
    console.info("COW P2", JSON.stringify({ copies, elapsedMs: performance.now() - began, size: state.toolCalls.size }));
    expect(state.toolCalls.size).toBe(10500);
    expect(state.toolCalls.get("t500")?.status).toBe("complete");
    expect(row(state, "t500")?.result).toBe("done-500");
    checks.forEach((check) => check());
  });
});

describe("copy-tool-state-on-write bounded generated properties", () => {
  it("E7: 200 annotated lifecycle seeds preserve every published map and nested record", () => {
    __resetSessionReducersForTests();
    const counts = { empty: 0, nonempty: 0, depth1: 0, depth2: 0, depth3: 0, childFirst: 0, rootFirst: 0, noWriteStreak: 0, writeAfterSharing: 0, healRevive: 0, lateRealEnd: 0 };
    for (let seed = 0; seed < 200; seed++) {
      const { size, generated } = assertLifecycleSeed(seed);
      counts[size === 0 ? "empty" : "nonempty"]++;
      counts[`depth${generated.depth}` as "depth1" | "depth2" | "depth3"]++;
      counts[generated.childFirst ? "childFirst" : "rootFirst"]++;
      counts.noWriteStreak++; counts.writeAfterSharing++; counts.healRevive++; counts.lateRealEnd++;
    }
    console.info("COW E7 partitions", JSON.stringify(counts));
    expect(counts.empty).toBe(100); expect(counts.nonempty).toBe(100);
    for (const count of Object.values(counts)) expect(count).toBeGreaterThan(0);
  }, 30000);

  it("E8: 200 callback/re-entry seeds retain prior, callback, nested and independently returned maps", () => {
    const counts = { running: 0, elided: 0, terminal: 0, sessionEnded: 0, live: 0, replay: 0, enabled: 0, disabled: 0, decline: 0, read: 0, copy: 0, reentry: 0 };
    for (let seed = 0; seed < 200; seed++) {
      const { variant, isLive, reentry, mode } = assertAgentSeed(seed);
      counts[isLive ? "live" : "replay"]++;
      counts[(["running", "elided", "terminal", "sessionEnded"] as const)[variant]]++;
      if (reentry) counts.reentry++;
      counts[mode]++;
    }
    console.info("COW E8 partitions", JSON.stringify(counts));
    for (const name of ["running", "elided", "terminal", "sessionEnded"] as const) expect(counts[name]).toBe(50);
    for (const name of ["enabled", "disabled", "decline", "read", "copy"] as const) expect(counts[name]).toBe(40);
    expect(counts.reentry).toBe(150);
    expect(counts.live).toBe(100); expect(counts.replay).toBe(100);
  }, 30000);
});
