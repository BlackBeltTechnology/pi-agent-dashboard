import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

/**
 * End-to-end wiring test for `session.unread`:
 *  - trigger fires & not viewed → unread broadcast
 *  - trigger fires & viewed     → no unread
 *  - replay events do not trigger unread
 *
 * See change: session-card-unread-stripes.
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
      setTimeout(resolve, 60);
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

function sendEvent(
  ws: WebSocket,
  sessionId: string,
  eventType: string,
  data: Record<string, unknown> = {},
): void {
  ws.send(JSON.stringify({
    type: "event_forward",
    sessionId,
    event: { eventType, timestamp: Date.now(), data },
  }));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("unread trigger — server wiring", () => {
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

  it("streaming → idle while NOT viewed marks the session unread and broadcasts", async () => {
    const piWs = await connectSession(piPort, "u1");
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "u1");

    // Drive the session into streaming
    sendEvent(piWs, "u1", "agent_start");
    await wait(60);
    expect(server.sessionManager.get("u1")?.status).toBe("streaming");

    // Now finish the turn — agent_end transitions back to idle
    sendEvent(piWs, "u1", "agent_end");
    await wait(120);

    const session = server.sessionManager.get("u1");
    expect(session?.unread).toBe(true);

    const unreadTrue = broadcasts.filter(
      (b) => (b.updates as Record<string, unknown> | undefined)?.unread === true,
    );
    expect(unreadTrue.length).toBeGreaterThanOrEqual(1);

    piWs.close();
    browser.close();
  });

  it("trigger fires while a browser IS viewing → unread stays false", async () => {
    const piWs = await connectSession(piPort, "u2");
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "u2");

    // Browser declares it is viewing the session
    browser.send(JSON.stringify({ type: "session_view", sessionId: "u2" }));
    await wait(60);

    sendEvent(piWs, "u2", "agent_start");
    await wait(60);
    sendEvent(piWs, "u2", "agent_end");
    await wait(120);

    const session = server.sessionManager.get("u2");
    expect(session?.unread).toBeFalsy();

    const unreadTrue = broadcasts.filter(
      (b) => (b.updates as Record<string, unknown> | undefined)?.unread === true,
    );
    expect(unreadTrue.length).toBe(0);

    piWs.close();
    browser.close();
  });

  it("replay events do not flip unread", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "session_register",
          sessionId: "u3",
          cwd: "/tmp",
          source: "cli",
        }));
        // Send a replayable agent_start/agent_end pair BEFORE replay_complete.
        sendEvent(ws, "u3", "agent_start");
        sendEvent(ws, "u3", "agent_end");
        setTimeout(resolve, 150);
      });
    });

    const session = server.sessionManager.get("u3");
    expect(session?.unread).toBeFalsy();

    ws.close();
  });

  it("session_view clears unread and broadcasts unread=false", async () => {
    const piWs = await connectSession(piPort, "u4");
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "u4");

    // Drive into unread (browser not viewing)
    sendEvent(piWs, "u4", "agent_start");
    await wait(50);
    sendEvent(piWs, "u4", "agent_end");
    await wait(120);
    expect(server.sessionManager.get("u4")?.unread).toBe(true);

    // Now declare view
    browser.send(JSON.stringify({ type: "session_view", sessionId: "u4" }));
    await wait(80);

    expect(server.sessionManager.get("u4")?.unread).toBe(false);

    const unreadFalseBroadcast = broadcasts.find(
      (b) => (b.updates as Record<string, unknown> | undefined)?.unread === false,
    );
    expect(unreadFalseBroadcast).toBeDefined();

    piWs.close();
    browser.close();
  });

  it("session_view on an already-read session does not produce a redundant broadcast", async () => {
    const piWs = await connectSession(piPort, "u5");
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "u5");

    browser.send(JSON.stringify({ type: "session_view", sessionId: "u5" }));
    browser.send(JSON.stringify({ type: "session_view", sessionId: "u5" }));
    await wait(80);

    const unreadBroadcasts = broadcasts.filter(
      (b) => (b.updates as Record<string, unknown> | undefined)?.unread !== undefined,
    );
    expect(unreadBroadcasts.length).toBe(0);

    piWs.close();
    browser.close();
  });
});
