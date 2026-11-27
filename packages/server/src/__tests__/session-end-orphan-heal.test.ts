/**
 * Integration: a session that ends terminates every tool card + subagent it
 * left open, on BOTH end seams (`unregister()` and `update({status:"ended"})`).
 *
 * Folded 1:1 from the change's test-plan manifest: X1–X5.
 * See change: heal-orphaned-tool-cards-on-session-end.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createInitialState, reduceEvent } from "../../../client/src/lib/chat/event-reducer.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createPluginEventAppender } from "../plugin-append-event.js";
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";
import { proofWebSocket } from "../test-support/local-credential-stamp.js";
import { createSubagentsPolicyRegistry, subagentsOf } from "./setup/subagents-reducer-slice.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const baseConfig: ServerConfig = {
  port: 0,
  piPort: 0,
  host: "127.0.0.1",
  dev: true,
  autoShutdown: false,
  shutdownIdleSeconds: 999,
  tunnel: false,
};

let server: DashboardServer | undefined;
afterEach(async () => {
  try { await server?.stop(); } catch { /* already stopped */ }
  server = undefined;
});

interface Harness {
  server: DashboardServer;
  bridge: WebSocket;
  browser: WebSocket;
  /** Every `event` + `session_updated` frame the browser saw, in arrival order. */
  frames: Array<Record<string, any>>;
}

/**
 * A running server, one registered session, one subscribed browser.
 * `replayComplete: false` leaves the session inside `replayingSessions` (#X5).
 */
async function harness(sessionId: string, opts: { replayComplete?: boolean } = {}): Promise<Harness> {
  server = await createServer(baseConfig);
  await server.start();
  const piPort = server.piPort()!;
  const browserPort = server.httpPort()!;

  const bridge = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve) => {
    bridge.on("open", () => {
      bridge.send(JSON.stringify({ type: "session_register", sessionId, cwd: process.cwd(), source: "cli" }));
      if (opts.replayComplete !== false) bridge.send(JSON.stringify({ type: "replay_complete", sessionId }));
      setTimeout(resolve, 60);
    });
  });

  const frames: Array<Record<string, any>> = [];
  const browser = proofWebSocket(`ws://127.0.0.1:${browserPort}/ws`);
  browser.on("message", (raw) => {
    try {
      const m = JSON.parse(String(raw));
      if (m.type === "event" || m.type === "session_updated") frames.push(m);
    } catch { /* ignore */ }
  });
  await new Promise<void>((resolve) => browser.on("open", () => setTimeout(resolve, 50)));
  browser.send(JSON.stringify({ type: "subscribe", sessionId, lastSeq: 0 }));
  await wait(80);
  frames.length = 0;

  return { server, bridge, browser, frames };
}

function forward(bridge: WebSocket, sessionId: string, eventType: string, data: Record<string, unknown>) {
  // A manifest-owned type must carry its owner's pluginId (the bridge registry
  // stamps it; the server drops a mis-stamped forward). See change: move-subagents-to-plugin (D1).
  const pluginId = eventType.startsWith("subagent_") ? { pluginId: "subagents" } : {};
  bridge.send(JSON.stringify({ type: "event_forward", sessionId, ...pluginId, event: { eventType, timestamp: Date.now(), data } }));
}

/** The synthesized heal frames the browser received, in arrival order. */
const healFrames = (frames: Array<Record<string, any>>) =>
  frames.filter((f) => f.type === "event" && f.event?.data?.healedBy === "session_ended");

/** Open two tool calls (one `Agent`, ticked with an agentId) + one subagent. */
async function openWork(bridge: WebSocket, sessionId: string) {
  forward(bridge, sessionId, "agent_start", {});
  forward(bridge, sessionId, "tool_execution_start", { toolCallId: "A", toolName: "Agent" });
  forward(bridge, sessionId, "tool_execution_update", {
    toolCallId: "A",
    partialResult: { content: [{ type: "text", text: "(running…)" }], details: { agentId: "ag-1" } },
  });
  forward(bridge, sessionId, "subagent_started", { id: "ag-1" });
  forward(bridge, sessionId, "tool_execution_start", { toolCallId: "B", toolName: "bash" });
  await wait(120);
}

describe("session-end orphan heal", () => {
  it("heals identically on the unregister seam, before session_updated (#X1)", async () => {
    const SID = "heal-unregister";
    const h = await harness(SID);
    await openWork(h.bridge, SID);

    h.server.sessionManager.unregister(SID);
    await wait(150);

    const heals = healFrames(h.frames);
    expect(heals.map((f) => f.event.eventType)).toEqual([
      "tool_execution_end",
      "tool_execution_end",
      "subagent_failed",
    ]);
    expect(heals[0].event.data).toMatchObject({
      toolCallId: "A",
      toolName: "Agent",
      isError: true,
      result: "parent session ended",
      details: { agentId: "ag-1" },
    });
    expect(heals[2].event.data).toMatchObject({ id: "ag-1", error: "parent session ended" });

    // Ordered BEFORE the session_updated{ended} the browser sees.
    const endedIdx = h.frames.findIndex((f) => f.type === "session_updated" && f.updates?.status === "ended");
    const lastHealIdx = h.frames.lastIndexOf(heals[2]);
    expect(endedIdx).toBeGreaterThan(lastHealIdx);

    h.bridge.close();
    h.browser.close();
  });

  it("heals identically on the update({status:'ended'}) seam (#X1)", async () => {
    const SID = "heal-update";
    const h = await harness(SID);
    await openWork(h.bridge, SID);

    h.server.sessionManager.update(SID, { status: "ended" });
    await wait(150);

    const heals = healFrames(h.frames);
    expect(heals.map((f) => f.event.eventType)).toEqual([
      "tool_execution_end",
      "tool_execution_end",
      "subagent_failed",
    ]);
    // Ordering is vacuous on THIS seam: the `session_updated{ended}` broadcast
    // lives in `onUnregister`, which an `update()`-only ending never reaches.
    // Asserted explicitly so the difference is recorded, not assumed.
    expect(
      h.frames.filter((f) => f.type === "session_updated" && f.updates?.status === "ended"),
    ).toEqual([]);

    h.bridge.close();
    h.browser.close();
  });

  it("synthesizes nothing when the session had nothing open (#X2)", async () => {
    const SID = "heal-noop";
    const h = await harness(SID);
    forward(h.bridge, SID, "agent_start", {});
    forward(h.bridge, SID, "tool_execution_start", { toolCallId: "A", toolName: "bash" });
    forward(h.bridge, SID, "tool_execution_end", { toolCallId: "A", toolName: "bash" });
    await wait(120);
    const before = h.server.eventStore.getEvents(SID, 1).length;

    h.server.sessionManager.unregister(SID);
    await wait(150);

    expect(healFrames(h.frames)).toEqual([]);
    expect(h.server.eventStore.getEvents(SID, 1).length).toBe(before);

    h.bridge.close();
    h.browser.close();
  });

  it("is idempotent when onEnded fires again (#X3)", async () => {
    const SID = "heal-twice";
    const h = await harness(SID);
    await openWork(h.bridge, SID);

    h.server.sessionManager.unregister(SID);
    await wait(150);
    // A later `closedReason` change re-fires `onEnded` for the same session.
    h.server.sessionManager.update(SID, { closedReason: "process_gone" });
    await wait(150);

    const stored = h.server.eventStore
      .getEvents(SID, 1)
      .filter((e) => (e.event.data as Record<string, unknown>).healedBy === "session_ended");
    expect(stored).toHaveLength(3);

    h.bridge.close();
    h.browser.close();
  });

  it("skips a relocation — movedTo is not a death (#X4)", async () => {
    const SID = "heal-moved";
    const h = await harness(SID);
    await openWork(h.bridge, SID);

    h.server.sessionManager.update(SID, {
      movedTo: { instanceId: "other", endpoint: "ws://elsewhere", at: Date.now() },
      status: "ended",
    });
    await wait(150);

    expect(healFrames(h.frames)).toEqual([]);
    expect(
      h.server.eventStore
        .getEvents(SID, 1)
        .filter((e) => (e.event.data as Record<string, unknown>).healedBy === "session_ended"),
    ).toHaveLength(0);

    h.bridge.close();
    h.browser.close();
  });

  it("inserts but does not broadcast while the session is replaying (#X5)", async () => {
    const SID = "heal-replaying";
    const h = await harness(SID, { replayComplete: false });
    forward(h.bridge, SID, "tool_execution_start", { toolCallId: "A", toolName: "bash" });
    await wait(120);

    h.server.sessionManager.unregister(SID);
    await wait(150);

    expect(healFrames(h.frames)).toEqual([]);
    expect(
      h.server.eventStore
        .getEvents(SID, 1)
        .filter((e) => (e.event.data as Record<string, unknown>).healedBy === "session_ended"),
    ).toHaveLength(1);

    h.bridge.close();
    h.browser.close();
  });
});

// A live bridge replay leaves a running call open, then re-announces the turn
// with a SYNTHETIC agent_start. If the process then really dies, the open call
// must still be healed. See change: fix-replay-fabricates-orphan-end-for-live-calls (D4).
describe("session-end orphan heal — across a synthetic reconnect agent_start", () => {
  it("heals a call opened before agent_start{synthetic:true} (test-plan #X1)", async () => {
    const SID = "heal-synthetic-start";
    const h = await harness(SID);
    forward(h.bridge, SID, "agent_start", {});
    forward(h.bridge, SID, "tool_execution_start", { toolCallId: "A", toolName: "bash" });
    forward(h.bridge, SID, "agent_start", { synthetic: true });
    await wait(120);

    h.server.sessionManager.unregister(SID);
    await wait(150);

    const heals = healFrames(h.frames).filter((f) => f.event.eventType === "tool_execution_end");
    expect(heals).toHaveLength(1);
    expect(heals[0].event.data).toMatchObject({ toolCallId: "A", isError: true, result: "parent session ended" });

    h.bridge.close();
    h.browser.close();
  });
});

// ── Plugin session-end seams (move-subagents-to-plugin D3/D4) ────────────────
// The subagent heal is the subagents plugin's, running from
// `ctx.onSessionStatusEnded`; the tool-call heal's identity fields come from the
// claiming plugin's store policy. See change: move-subagents-to-plugin.

describe("ctx.appendEvent — owned types only (test-plan #E24, #E26)", () => {
  const SID = "append-S";
  const failed = (id: string): DashboardEvent => ({
    eventType: "subagent_failed",
    timestamp: 1,
    data: { id, healedBy: "session_ended" },
  });
  function fixture(replaying: boolean) {
    const registry = createSubagentsPolicyRegistry();
    const eventStore = createMemoryEventStore(() => false);
    const broadcast = vi.fn();
    const append = createPluginEventAppender({
      registry: () => registry,
      eventStore,
      isReplaying: () => replaying,
      broadcastEvent: broadcast,
    });
    return { registry, eventStore, broadcast, append };
  }

  it("stores an owned event with the next seq and broadcasts it; refuses a core type (#E24)", () => {
    const f = fixture(false);
    f.eventStore.insertEvent(SID, { eventType: "agent_start", timestamp: 0, data: {} }); // seq 1
    const ok = f.append("subagents", SID, failed("a1"));
    expect(ok).toEqual({ ok: true, seq: 2, broadcast: true });
    expect(f.broadcast).toHaveBeenCalledTimes(1);
    expect(f.broadcast).toHaveBeenCalledWith(SID, 2, expect.objectContaining({ eventType: "subagent_failed" }));

    const refused = f.append("subagents", SID, { eventType: "tool_execution_end", timestamp: 2, data: {} });
    expect(refused).toEqual({ ok: false, reason: "not-owned" });
    expect(f.eventStore.getEvents(SID, 0)).toHaveLength(2); // nothing stored
    expect(f.broadcast).toHaveBeenCalledTimes(1); // nothing broadcast
    expect(f.registry.stats().refusedAppends).toBe(1);
    // A type another plugin (or nobody) owns is refused too.
    expect(f.append("other", SID, failed("a2")).ok).toBe(false);
    expect(f.append("subagents", SID, { eventType: "not_owned_anywhere", timestamp: 3, data: {} }).ok).toBe(false);
  });

  it("stores without broadcasting while the session replays (#E26)", () => {
    const f = fixture(true);
    const res = f.append("subagents", SID, failed("a1"));
    expect(res).toEqual({ ok: true, seq: 1, broadcast: false });
    expect(f.eventStore.getEvents(SID, 0)).toHaveLength(1);
    expect(f.broadcast).not.toHaveBeenCalled();
  });
});

describe("plugin status-ended fan-out (test-plan #E25)", () => {
  /** Calls of the plugin heal's store read: it reads from seq 0, the core heal from seq 1. */
  const pluginReads = (spy: { mock: { calls: unknown[][] } }, sid: string) =>
    spy.mock.calls.filter((c) => c[0] === sid && c[1] === 0).length;

  it("fires on status-ended and on a reason re-fire; one failed frame per open subagent; not on relocation", async () => {
    const SID = "status-ended";
    const h = await harness(SID);
    forward(h.bridge, SID, "subagent_started", { id: "a1" });
    await wait(120);
    const spy = vi.spyOn(h.server.eventStore, "getEvents");

    h.server.sessionManager.update(SID, { status: "ended" });
    await wait(150);
    expect(pluginReads(spy, SID)).toBe(1);
    h.server.sessionManager.update(SID, { closedReason: "process_gone" });
    await wait(150);
    expect(pluginReads(spy, SID)).toBe(2);

    const failedFrames = h.server.eventStore
      .getEvents(SID, 1)
      .filter((e) => e.event.eventType === "subagent_failed" && (e.event.data as any).id === "a1");
    expect(failedFrames).toHaveLength(1);
    // The unregister-only `onSessionEnded` seam stayed silent: its broadcast never went out.
    expect(h.frames.filter((f) => f.type === "session_updated" && f.updates?.status === "ended")).toEqual([]);
    h.bridge.close();
    h.browser.close();

    // Another fixture: a relocation is not an end.
    await server?.stop();
    server = undefined;
    const SID2 = "status-moved";
    const m = await harness(SID2);
    forward(m.bridge, SID2, "subagent_started", { id: "a1" });
    await wait(120);
    const spy2 = vi.spyOn(m.server.eventStore, "getEvents");
    m.server.sessionManager.update(SID2, {
      movedTo: { instanceId: "other", endpoint: "ws://elsewhere", at: Date.now() },
      status: "ended",
    });
    await wait(150);
    expect(pluginReads(spy2, SID2)).toBe(0);
    expect(m.server.eventStore.getEvents(SID2, 1).some((e) => e.event.eventType === "subagent_failed")).toBe(false);
    m.bridge.close();
    m.browser.close();
  });
});

describe("tool-call heal identity comes from the claiming plugin's policy (test-plan #E27)", () => {
  /**
   * @structural-pin boundary: core `open-tool-calls.ts` must name no `agentId` — the absence is the contract, with no runtime seam to observe it
   */
  it("an Agent call keeps details.agentId, a bash call none; core source names no agentId", async () => {
    const SID = "identity-heal";
    const h = await harness(SID);
    forward(h.bridge, SID, "agent_start", {});
    forward(h.bridge, SID, "tool_execution_start", { toolCallId: "A", toolName: "Agent" });
    forward(h.bridge, SID, "tool_execution_update", {
      toolCallId: "A",
      toolName: "Agent",
      partialResult: { content: [{ type: "text", text: "(running…)" }], details: { agentId: "ag-1" } },
    });
    forward(h.bridge, SID, "tool_execution_start", { toolCallId: "B", toolName: "bash" });
    await wait(120);

    h.server.sessionManager.unregister(SID);
    await wait(150);

    const ends = healFrames(h.frames).filter((f) => f.event.eventType === "tool_execution_end");
    expect(ends).toHaveLength(2);
    const agentEnd = ends.find((f) => f.event.data.toolCallId === "A")!;
    const bashEnd = ends.find((f) => f.event.data.toolCallId === "B")!;
    expect(agentEnd.event.data.details.agentId).toBe("ag-1");
    expect(bashEnd.event.data.details).toBeUndefined();
    h.bridge.close();
    h.browser.close();

    const heal = readFileSync(join(__dirname, "../session/open-tool-calls.ts"), "utf8");
    expect(heal).not.toMatch(/agentId/);
  });
});

describe("crash without a terminal frame (test-plan #X3)", () => {
  it("heals once with healedBy:session_ended, and a replay renders scalar state + 12 steps", async () => {
    const SID = "crash-no-terminal";
    const h = await harness(SID);
    forward(h.bridge, SID, "subagent_created", { id: "ag-x", type: "Explore", description: "scan the repo" });
    forward(h.bridge, SID, "subagent_started", { id: "ag-x" });
    for (let i = 0; i < 12; i++) {
      forward(h.bridge, SID, "subagent_entry", { agentId: "ag-x", index: i, entry: { kind: "text", text: `step ${i}`, ts: i } });
    }
    await wait(150);
    h.bridge.close(); // pi killed: no terminal frame ever arrives
    h.server.sessionManager.update(SID, { status: "ended" });
    await wait(150);

    const stored = h.server.eventStore.getEvents(SID, 1);
    const failed = stored.filter((e) => e.event.eventType === "subagent_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].event.data).toMatchObject({ id: "ag-x", healedBy: "session_ended" });

    // Replay: fold the stored stream the way a reconnecting browser does.
    let state = createInitialState();
    for (const { event } of stored) state = reduceEvent(state, event);
    const sub = subagentsOf(state).get("ag-x")!;
    expect(sub).toMatchObject({ id: "ag-x", type: "Explore", description: "scan the repo", status: "failed" });
    expect(sub.entries!.filter(Boolean)).toHaveLength(12);
    h.browser.close();
  });
});
