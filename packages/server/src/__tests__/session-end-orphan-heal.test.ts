/**
 * Integration: a session that ends terminates every tool card + subagent it
 * left open, on BOTH end seams (`unregister()` and `update({status:"ended"})`).
 *
 * Folded 1:1 from the change's test-plan manifest: X1–X5.
 * See change: heal-orphaned-tool-cards-on-session-end.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";

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
  const browser = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
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
  bridge.send(JSON.stringify({ type: "event_forward", sessionId, event: { eventType, timestamp: Date.now(), data } }));
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
