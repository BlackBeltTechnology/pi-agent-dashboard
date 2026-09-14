/**
 * Smoke integration tests — validates end-to-end flows without SQLite.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";
import type { DashboardServer } from "../server.js";
import { WebSocket } from "ws";

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", resolve);
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

function collectMsgs(ws: WebSocket, ms: number): Promise<any[]> {
  return new Promise((resolve) => {
    const arr: any[] = [];
    const h = (raw: any) => arr.push(JSON.parse(raw.toString()));
    ws.on("message", h);
    setTimeout(() => { ws.off("message", h); resolve(arr); }, ms);
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let handle: TestServerHandle;
let server: DashboardServer;
let httpPort: number;
let piPort: number;

describe("Smoke integration", () => {
  afterAll(async () => {
    if (handle) await handle.stop();
  });

  it("9.2 — events flow and replay from memory on reconnect", async () => {
    handle = await createTestServer();
    server = handle.server;
    httpPort = handle.httpPort;
    piPort = handle.piPort;

    // Bridge connects and registers
    const bridge = new WebSocket(`ws://localhost:${piPort}`);
    await waitForOpen(bridge);
    bridge.send(JSON.stringify({
      type: "session_register", sessionId: "s1", cwd: "/tmp", source: "tui", name: "Test",
    }));
    bridge.send(JSON.stringify({ type: "replay_complete", sessionId: "s1" }));
    await delay(150);

    // Browser connects, subscribes, receives event
    const b1 = new WebSocket(`ws://localhost:${httpPort}/ws`);
    await waitForOpen(b1);
    await delay(100); // drain session_added
    b1.send(JSON.stringify({ type: "subscribe", sessionId: "s1", lastSeq: 0 }));
    await delay(50);

    bridge.send(JSON.stringify({
      type: "event_forward", sessionId: "s1",
      event: { eventType: "message_start", timestamp: Date.now(), data: { role: "user" } },
    }));

    const msgs1 = await collectMsgs(b1, 300);
    const liveEvent = msgs1.find((m) => m.type === "event" && m.sessionId === "s1");
    expect(liveEvent).toBeDefined();
    expect(liveEvent.seq).toBe(1);

    // Reconnect browser — should replay from memory
    b1.close();
    await delay(100);

    const b2 = new WebSocket(`ws://localhost:${httpPort}/ws`);
    await waitForOpen(b2);
    await delay(100); // drain session_added
    b2.send(JSON.stringify({ type: "subscribe", sessionId: "s1", lastSeq: 0 }));

    const msgs2 = await collectMsgs(b2, 300);
    const replay = msgs2.find((m) => m.type === "event_replay" && m.sessionId === "s1");
    expect(replay).toBeDefined();
    expect(replay.events.length).toBeGreaterThanOrEqual(1);
    expect(replay.events[0].event.eventType).toBe("message_start");

    b2.close();
    bridge.close();
    await delay(100);
  }, 15000);

  it("9.3 — legacy hide_session no longer hides (archive replaced it)", async () => {
    const bridge = new WebSocket(`ws://localhost:${piPort}`);
    await waitForOpen(bridge);
    bridge.send(JSON.stringify({
      type: "session_register", sessionId: "s3", cwd: "/tmp", source: "tui",
    }));
    await delay(150);

    const browser = new WebSocket(`ws://localhost:${httpPort}/ws`);
    await waitForOpen(browser);
    await delay(100); // drain session_added

    // Archived replaced hidden; the removed verb must not mutate the manager.
    browser.send(JSON.stringify({ type: "hide_session", sessionId: "s3" }));

    const msgs = await collectMsgs(browser, 300);
    const hideUpdate = msgs.find((m) =>
      m.type === "session_updated" && m.sessionId === "s3" && m.updates?.hidden === true
    );
    expect(hideUpdate).toBeUndefined();
    expect(server.sessionManager.get("s3")?.hidden).toBeFalsy();

    browser.close();
    bridge.close();
    await delay(100);
  }, 10000);

  it.skip("9.5 — old session with no bridge shows dataUnavailable", async () => {
    // Use a unique cwd that won't match other sessions
    const bridge = new WebSocket(`ws://localhost:${piPort}`);
    await waitForOpen(bridge);
    bridge.send(JSON.stringify({
      type: "session_register", sessionId: "s5", cwd: "/unique/isolated/path",
      source: "tui", sessionFile: "/unique/old.json",
    }));
    await delay(100);
    bridge.send(JSON.stringify({
      type: "event_forward", sessionId: "s5",
      event: { eventType: "agent_start", timestamp: Date.now(), data: {} },
    }));
    await delay(50);
    bridge.send(JSON.stringify({ type: "session_unregister", sessionId: "s5" }));
    await delay(50);
    bridge.close();
    await delay(200);

    // Simulate eviction
    server.eventStore.deleteEventsForSession("s5");

    // Browser subscribes — should get dataUnavailable
    const browser = new WebSocket(`ws://localhost:${httpPort}/ws`);
    await waitForOpen(browser);
    await delay(200); // drain session_added

    browser.send(JSON.stringify({ type: "subscribe", sessionId: "s5", lastSeq: 0 }));

    // Collect messages over time — the async loadSessionEvents may take a while
    // due to dynamic imports in the test environment
    const allMsgs: any[] = [];
    const handler = (raw: any) => allMsgs.push(JSON.parse(raw.toString()));
    browser.on("message", handler);

    // Poll until we see dataUnavailable or timeout
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await delay(200);
      const unavail = allMsgs.find((m: any) =>
        m.type === "session_updated" && m.sessionId === "s5" && m.updates?.dataUnavailable === true
      );
      if (unavail) break;
    }
    browser.off("message", handler);

    // Verify we got at least one empty replay
    const replays = allMsgs.filter((m: any) => m.type === "event_replay" && m.sessionId === "s5");
    expect(replays.length).toBeGreaterThan(0);

    // Verify dataUnavailable was set
    const unavail = allMsgs.find((m: any) =>
      m.type === "session_updated" && m.sessionId === "s5" && m.updates?.dataUnavailable === true
    );
    expect(unavail).toBeDefined();

    browser.close();
    await delay(50);
  }, 15000);
});
