import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

/**
 * Tests for `lastActivityAt` server-side stamping + 30s debounced broadcast.
 * See change: session-card-last-activity-badge.
 */

async function connectSession(piPort: number, sessionId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session_register",
        sessionId,
        cwd: "/tmp",
        source: "cli",
      }));
      ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
      setTimeout(resolve, 50);
    });
  });
  return ws;
}

async function connectBrowser(browserPort: number, sessionId: string): Promise<{
  ws: WebSocket;
  broadcasts: Array<Record<string, unknown>>;
}> {
  const ws = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
  const broadcasts: Array<Record<string, unknown>> = [];
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "session_updated" && msg.sessionId === sessionId) {
            broadcasts.push(msg);
          }
        } catch { /* ignore */ }
      });
      ws.send(JSON.stringify({ type: "subscribe", sessionId }));
      setTimeout(resolve, 80);
    });
  });
  return { ws, broadcasts };
}

function sendActivityEvent(ws: WebSocket, sessionId: string, eventType: string): void {
  ws.send(JSON.stringify({
    type: "event_forward",
    sessionId,
    event: {
      eventType,
      timestamp: Date.now(),
      data: {},
    },
  }));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("lastActivityAt — server stamping and debounce", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;

  beforeEach(async () => {
    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterEach(async () => {
    await server.stop();
  });

  it("stamps lastActivityAt on an activity event and broadcasts immediately the first time", async () => {
    const ws = await connectSession(piPort, "a1");
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "a1");

    const before = Date.now();
    sendActivityEvent(ws, "a1", "message_start");
    await wait(120);

    const session = server.sessionManager.get("a1");
    expect(session?.lastActivityAt).toBeDefined();
    expect(session!.lastActivityAt!).toBeGreaterThanOrEqual(before);

    const lastActivityBroadcasts = broadcasts.filter(
      (b) => (b.updates as Record<string, unknown> | undefined)?.lastActivityAt !== undefined,
    );
    expect(lastActivityBroadcasts.length).toBeGreaterThanOrEqual(1);

    ws.close();
    browser.close();
  });

  it("does NOT broadcast lastActivityAt for non-activity events", async () => {
    const ws = await connectSession(piPort, "a2");
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "a2");

    sendActivityEvent(ws, "a2", "process_metrics");
    sendActivityEvent(ws, "a2", "git_info_update");
    sendActivityEvent(ws, "a2", "ui_data_list");
    await wait(120);

    const session = server.sessionManager.get("a2");
    expect(session?.lastActivityAt).toBeUndefined();

    const lastActivityBroadcasts = broadcasts.filter(
      (b) => (b.updates as Record<string, unknown> | undefined)?.lastActivityAt !== undefined,
    );
    expect(lastActivityBroadcasts.length).toBe(0);

    ws.close();
    browser.close();
  });

  it("debounces subsequent broadcasts within the 30s window — in-memory still updates", async () => {
    const ws = await connectSession(piPort, "a3");
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "a3");

    sendActivityEvent(ws, "a3", "tool_execution_start");
    await wait(120);

    const t1 = server.sessionManager.get("a3")?.lastActivityAt;
    expect(t1).toBeDefined();
    const broadcastCountAfterFirst = broadcasts.filter(
      (b) => (b.updates as Record<string, unknown> | undefined)?.lastActivityAt !== undefined,
    ).length;
    expect(broadcastCountAfterFirst).toBeGreaterThanOrEqual(1);

    // Send several more activity events well within the 30s debounce window
    await wait(200);
    sendActivityEvent(ws, "a3", "tool_execution_end");
    sendActivityEvent(ws, "a3", "message_end");
    sendActivityEvent(ws, "a3", "turn_end");
    await wait(120);

    const t2 = server.sessionManager.get("a3")?.lastActivityAt;
    expect(t2).toBeDefined();
    expect(t2!).toBeGreaterThan(t1!); // in-memory advances on every activity event

    const broadcastCountAfterMore = broadcasts.filter(
      (b) => (b.updates as Record<string, unknown> | undefined)?.lastActivityAt !== undefined,
    ).length;
    // No new lastActivityAt-only broadcast within 30s.
    expect(broadcastCountAfterMore).toBe(broadcastCountAfterFirst);

    ws.close();
    browser.close();
  });

  it("does not stamp lastActivityAt during replay (events arriving before replay_complete)", async () => {
    // Connect raw without sending replay_complete — event-wiring treats events as replay
    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "session_register",
          sessionId: "a4",
          cwd: "/tmp",
          source: "cli",
        }));
        // Intentionally NO replay_complete here.
        sendActivityEvent(ws, "a4", "message_end");
        sendActivityEvent(ws, "a4", "tool_execution_start");
        setTimeout(resolve, 150);
      });
    });

    const session = server.sessionManager.get("a4");
    expect(session?.lastActivityAt).toBeUndefined();

    ws.close();
  });
});
