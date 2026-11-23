/**
 * Plugin server side of the flow catalog: stateStore fed from `flow_catalog`
 * events, per-session ask limit (independent of the files ask), sibling follow
 * without loops, and the server-start ask loop.
 * See change: flows-dock-chip-and-panel-actions (test-plan E9–E11, E14–E16, X2).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLOW_FILES_REQUEST_EVENT } from "../flow-files-contract.js";
import { makeFlowsForCwd } from "../server/index.js";
import { registerFlowCatalog } from "../server/flow-catalog.js";
import { stateStore } from "../server/state-store.js";
import { entry, openHarness } from "./flow-open-harness.js";

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

// ── flow/open lane handler. See change: add-flow-open-tool. ──

describe("flow/open lane handler (E1, E8–E11, E17, X1–X3, X8, X11)", () => {
  let w: string;
  beforeEach(() => {
    vi.useFakeTimers();
    w = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "flow-open-")));
  });
  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(w, { recursive: true, force: true });
  });

  it("E1: invalid arguments are refused without a broadcast", async () => {
    const h = openHarness({ sessions: { S: w } });
    for (const p of [{}, { flow: "a:b", path: "x" }, { flow: "a/b" }, { flow: "x".repeat(201) }, { flow: ".." }]) {
      expect(await h.call(p)).toEqual({ status: "refused", reason: "invalid-arguments" });
    }
    expect(h.broadcasts).toHaveLength(0);
  });

  it("E8: a catalog name opens runnable; one ack → shown, acks:1", async () => {
    const source = path.join(w, ".pi/flows/flows/custom/a/flow.yaml");
    const h = openHarness({ sessions: { S: w }, flows: { S: [entry("custom:a", source)] } });
    const p = h.ctl.handle({ flow: "custom:a" }, { sessionId: "S" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.broadcasts[0]).toMatchObject({ type: "flows_open", sessionId: "S", attachment: { name: "custom:a", viewOnly: false } });
    h.ack("ws1", "S", h.broadcasts[0].requestId);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await p).toEqual({ status: "shown", acks: 1, name: "custom:a", path: ".pi/flows/flows/custom/a/flow.yaml", viewOnly: false });
  });

  it("E9: a cold catalog is rediscovered, retrying a cooldown-suppressed ask", async () => {
    let first = true;
    const h = openHarness({
      sessions: { S: w },
      autoAck: ["ws"],
      requestCatalog: () => {
        if (first) {
          first = false;
          return false;
        }
        return true;
      },
    });
    setTimeout(() => h.setFlows("S", [entry("custom:a", "/x/flow.yaml")]), 400);
    expect(await h.call({ flow: "custom:a" })).toMatchObject({ status: "shown", name: "custom:a" });
    expect(h.requestCatalog).toHaveBeenCalledTimes(2);
    expect(h.requestCatalog).toHaveBeenCalledWith("S", { rediscover: true });
  });

  it("E10: unknown after the rediscovery poll → unknown-flow, no broadcast", async () => {
    const h = openHarness({ sessions: { S: w } });
    const t0 = Date.now();
    const r = await h.call({ flow: "custom:missing" });
    expect(r).toEqual({ status: "refused", reason: "unknown-flow" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1_500);
    expect(h.broadcasts).toHaveLength(0);
  });

  it("E11: a path equal to a catalog definition (relative source) opens the catalog flow", async () => {
    const rel = ".pi/flows/flows/custom/a/flow.yaml";
    fs.mkdirSync(path.join(w, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(w, rel), "steps: []\n");
    const h = openHarness({ sessions: { S: w }, flows: { S: [entry("custom:a", rel)] }, autoAck: ["ws"] });
    expect(await h.call({ path: ".pi/flows/flows/custom/a" })).toMatchObject({ status: "shown", viewOnly: false, name: "custom:a" });
    expect(h.broadcasts[0].attachment).toMatchObject({ name: "custom:a", viewOnly: false });
  });

  it("E17: 11th call within 10 s is rate-limited; session end clears the limiter", async () => {
    const h = openHarness({ sessions: { S: w } });
    for (let i = 0; i < 10; i++) expect(await h.ctl.handle({}, { sessionId: "S" })).toMatchObject({ reason: "invalid-arguments" });
    expect(await h.ctl.handle({}, { sessionId: "S" })).toEqual({ status: "refused", reason: "rate-limited" });
    h.end("S");
    expect(h.ctl.limiterSize()).toBe(0);
    expect(await h.ctl.handle({}, { sessionId: "S" })).toMatchObject({ reason: "invalid-arguments" });
  });

  it("X1: no ack → no-viewer after the 1.5 s window; pending map empty", async () => {
    const h = openHarness({ sessions: { S: w }, flows: { S: [entry("custom:a", "/x/flow.yaml")] } });
    let done: unknown;
    const p = h.ctl.handle({ flow: "custom:a" }, { sessionId: "S" }).then((r) => (done = r));
    await vi.advanceTimersByTimeAsync(1_499);
    expect(done).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toMatchObject({ status: "no-viewer", name: "custom:a" });
    expect(h.ctl.pendingSize()).toBe(0);
  });

  it("X2: acks count distinct sockets; a duplicate ack from one socket counts once", async () => {
    const h = openHarness({ sessions: { S: w }, flows: { S: [entry("custom:a", "/x/flow.yaml")] } });
    const p = h.ctl.handle({ flow: "custom:a" }, { sessionId: "S" });
    await vi.advanceTimersByTimeAsync(0);
    const id = h.broadcasts[0].requestId;
    h.ack("ws1", "S", id);
    h.ack("ws1", "S", id);
    h.ack("ws2", "S", id);
    h.ack("ws3", "OTHER", id);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(await p).toMatchObject({ status: "shown", acks: 2 });
  });

  it("X3: unknown or late acks are ignored; pending map bounded at 64", async () => {
    const flows = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`S${i}`, [entry("custom:a", "/x/flow.yaml")]]));
    const h = openHarness({ sessions: { S: w }, flows });
    expect(() => h.ack("ws", "S", "nope")).not.toThrow();
    expect(() => h.ack("ws", "S", 42)).not.toThrow();
    const ps = [];
    for (let i = 0; i < 70; i++) ps.push(h.ctl.handle({ flow: "custom:a" }, { sessionId: `S${i}` }));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.ctl.pendingSize()).toBeLessThanOrEqual(64);
    const firstId = h.broadcasts[0].requestId;
    await vi.advanceTimersByTimeAsync(1_500);
    await Promise.all(ps);
    h.ack("ws", "S0", firstId);
    expect(h.ctl.pendingSize()).toBe(0);
  });

  it("X8: the lane is registered hub-local-only (a remote origin is denied by the host)", () => {
    const h = openHarness({ sessions: { S: w } });
    expect(h.lane()).toEqual({ type: "flow/open", opts: { hubLocalOnly: true } });
  });

  it("X11: exactly one log line per call with session, kind, outcome, reason/acks — no content", async () => {
    fs.mkdirSync(path.join(w, "f"), { recursive: true });
    fs.writeFileSync(path.join(w, "f", "flow.yaml"), "name: SECRET_CONTENT\nsteps: []\n");
    const h = openHarness({ sessions: { S: w }, autoAck: ["a", "b"] });
    await h.call({ path: "/etc/flow.yaml" });
    await h.call({ path: "f" });
    expect(h.logs).toHaveLength(2);
    expect(h.logs[0]).toBe("flow_open session=S kind=path outcome=refused reason=path-not-allowed acks=0");
    expect(h.logs[1]).toBe("flow_open session=S kind=path outcome=shown reason=- acks=2");
    expect(h.logs.join("\n")).not.toContain("SECRET_CONTENT");
  });
});
