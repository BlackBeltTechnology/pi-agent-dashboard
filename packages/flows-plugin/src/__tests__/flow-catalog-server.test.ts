/**
 * Plugin server side of the flow catalog: stateStore fed from `flow_catalog`
 * events, per-session ask limit (independent of the files ask), sibling follow
 * without loops, and the server-start ask loop.
 * See change: flows-dock-chip-and-panel-actions (test-plan E9–E11, E14–E16, X2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLOW_FILES_REQUEST_EVENT } from "../flow-files-contract.js";
import { makeFlowsForCwd } from "../server/index.js";
import { registerFlowCatalog } from "../server/flow-catalog.js";
import { stateStore } from "../server/state-store.js";

type EventHandler = (sessionId: string, event: unknown) => void;

function harness(opts: { live?: Array<{ id: string; cwd: string }>; config?: Record<string, unknown>; emitResult?: () => boolean } = {}) {
  let onEvent: EventHandler = () => {};
  let onEnded: (id: string) => void = () => {};
  const live = opts.live ?? [];
  const config = opts.config ?? {};
  const emitEventToSession = vi.fn((_sid: string, _type: string, _data: Record<string, unknown>) => (opts.emitResult ? opts.emitResult() : true));
  const ctl = registerFlowCatalog({
    onEvent: (h) => {
      onEvent = h;
      return () => {};
    },
    onSessionEnded: (h) => {
      onEnded = h;
      return () => {};
    },
    sessionManager: { listActive: () => live },
    emitEventToSession,
    getPluginConfig: () => config,
    store: stateStore,
  });
  const publish = (sid: string, names: string[]) =>
    onEvent(sid, {
      eventType: "flow_catalog",
      timestamp: Date.now(),
      data: { catalogKey: "catalog", flows: names.map((name) => ({ name, description: "", source: "", taskRequired: false })) },
    });
  const asksTo = (sid: string) => emitEventToSession.mock.calls.filter(([s, type]) => s === sid && type === FLOW_FILES_REQUEST_EVENT);
  return { ctl, live, config, emitEventToSession, publish, asksTo, raw: (sid: string, e: unknown) => onEvent(sid, e), end: (id: string) => onEnded(id) };
}

beforeEach(() => {
  stateStore.__resetForTests();
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe("catalog feeds the plugin store (E9)", () => {
  it("flowsForCwd reflects the catalog; cleared when the session ends", () => {
    const h = harness({ live: [{ id: "S", cwd: "/p" }] });
    const flowsForCwd = makeFlowsForCwd({ listActive: () => h.live }, stateStore);
    h.publish("S", ["batch:apply"]);
    expect(flowsForCwd("/p")).toEqual(["batch:apply"]);
    h.end("S");
    expect(flowsForCwd("/p")).toEqual([]);
  });

  it("ignores other events and malformed catalogs", () => {
    const h = harness({ live: [{ id: "S", cwd: "/p" }] });
    const flowsForCwd = makeFlowsForCwd({ listActive: () => h.live }, stateStore);
    h.publish("S", ["a"]);
    // a non-catalog event and a payload without `flows` change nothing
    h.raw("S", { eventType: "flow_started", data: { flows: [] } });
    h.raw("S", { eventType: "flow_catalog", data: { catalogKey: "catalog" } });
    h.raw("S", null);
    const store = stateStore.getState("S");
    expect(store?.flows.map((f) => f.name)).toEqual(["a"]);
    expect(flowsForCwd("/p")).toEqual(["a"]);
  });
});

describe("2 s catalog ask limit (E10, E11)", () => {
  it("E10: a second ask within the limit is dropped", () => {
    const h = harness();
    h.ctl.requestCatalog("S");
    vi.setSystemTime(1999);
    h.ctl.requestCatalog("S");
    expect(h.asksTo("S")).toHaveLength(1);
  });

  it("E11: a second ask after the limit is sent; another session's / the files ask do not block it", () => {
    const h = harness();
    h.ctl.requestCatalog("S");
    vi.setSystemTime(500);
    // The flow-files ask lives in its own map (server/flow-files.ts); asking
    // another session here must not consume S's budget either.
    h.ctl.requestCatalog("T");
    vi.setSystemTime(2001);
    h.ctl.requestCatalog("S");
    expect(h.asksTo("S")).toHaveLength(2);
    expect(h.asksTo("T")).toHaveLength(1);
  });

  it("passes rediscover through", () => {
    const h = harness();
    h.ctl.requestCatalog("S", { rediscover: true });
    expect(h.emitEventToSession).toHaveBeenCalledWith("S", FLOW_FILES_REQUEST_EVENT, { rediscover: true });
  });
});

describe("sibling follow (E14, E15)", () => {
  it("E14: a changed catalog asks same-folder siblings to rediscover, not itself or other folders", () => {
    const h = harness({ live: [{ id: "A", cwd: "/p" }, { id: "B", cwd: "/p" }, { id: "C", cwd: "/q" }] });
    h.publish("A", ["x"]);
    expect(h.emitEventToSession).not.toHaveBeenCalled(); // first catalog: nothing to follow
    vi.setSystemTime(10_000);
    h.publish("A", ["x", "y"]);
    expect(h.asksTo("B")).toEqual([["B", FLOW_FILES_REQUEST_EVENT, { rediscover: true }]]);
    expect(h.asksTo("A")).toHaveLength(0);
    expect(h.asksTo("C")).toHaveLength(0);
  });

  it("E15: an equal catalog asks nothing (no loop)", () => {
    const h = harness({ live: [{ id: "A", cwd: "/p" }, { id: "B", cwd: "/p" }] });
    h.publish("B", ["x", "y"]);
    vi.setSystemTime(10_000);
    h.publish("B", ["y", "x"]);
    expect(h.emitEventToSession).not.toHaveBeenCalled();
  });
});

describe("server start asks (E16, X2)", () => {
  it("E16: re-asks a silent session every 5 s for 60 s; a reporting session is asked once", async () => {
    const h = harness({ live: [{ id: "silent", cwd: "/p" }, { id: "talker", cwd: "/p" }] });
    h.ctl.startServerStartAsks();
    h.publish("talker", ["a"]);
    await vi.advanceTimersByTimeAsync(65_000);
    expect(h.asksTo("silent").length).toBe(13);
    expect(h.asksTo("talker").length).toBe(1);
  });

  it("X2: after a restart, automation learns the flows once the session reports — no browser", async () => {
    const h = harness({ live: [{ id: "S", cwd: "/p" }] });
    const flowsForCwd = makeFlowsForCwd({ listActive: () => h.live }, stateStore);
    h.ctl.startServerStartAsks();
    expect(flowsForCwd("/p")).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    h.publish("S", ["batch:apply"]);
    expect(flowsForCwd("/p")).toEqual(["batch:apply"]);
    const before = h.asksTo("S").length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.asksTo("S").length).toBe(before);
  });

  it("a session that registers later (bridge reconnect) is asked within the window", async () => {
    const h = harness({ live: [] });
    h.ctl.startServerStartAsks();
    await vi.advanceTimersByTimeAsync(7_000);
    h.live.push({ id: "late", cwd: "/p" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.asksTo("late").length).toBeGreaterThanOrEqual(1);
  });
});
