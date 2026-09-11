import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

/**
 * Wiring tests for the heartbeat-carried agent-liveness reconcile.
 *
 * A dropped `agent_end` latches `status: "streaming"` forever, because
 * `agent_end` is the only path back to `idle`. The bridge's periodic
 * `session_heartbeat` now carries `agentRunning`, and the wiring reconciles
 * the session's status against it.
 *
 * See change: fix-stuck-streaming-status-latch
 * (test-plan #X2, #X4, #E9, #E11, #E13, #E14, #E15, #F2, #F4, #F5, #P1).
 */

async function connectSession(piPort: number, sessionId: string, opts: { replayComplete?: boolean } = {}): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session_register",
        sessionId,
        cwd: "/tmp",
        source: "cli",
      }));
      if (opts.replayComplete !== false) {
        ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
      }
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

function sendEvent(ws: WebSocket, sessionId: string, eventType: string, data: Record<string, unknown> = {}): void {
  ws.send(JSON.stringify({
    type: "event_forward",
    sessionId,
    event: { eventType, timestamp: Date.now(), data },
  }));
}

function sendBeat(ws: WebSocket, sessionId: string, agentRunning?: boolean): void {
  ws.send(JSON.stringify({
    type: "session_heartbeat",
    sessionId,
    ...(agentRunning === undefined ? {} : { agentRunning }),
  }));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("heartbeat agent-liveness reconcile — server wiring", () => {
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
    vi.restoreAllMocks();
  });

  it("heals a latched session on one beat (#X2)", async () => {
    const piWs = await connectSession(piPort, "h1");
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "h1");

    // agent_start latches streaming; the agent_end is "lost in transport".
    sendEvent(piWs, "h1", "agent_start");
    await wait(60);
    expect(server.sessionManager.get("h1")?.status).toBe("streaming");

    sendBeat(piWs, "h1", false);
    await wait(120);

    expect(server.sessionManager.get("h1")?.status).toBe("idle");
    expect(server.sessionManager.get("h1")?.currentTool).toBeFalsy();
    const statusBroadcast = broadcasts.find(
      (b) => (b.updates as Record<string, unknown> | undefined)?.status === "idle",
    );
    expect(statusBroadcast).toBeDefined();

    piWs.close();
    browser.close();
  });

  it("leaves everything unchanged when the field is absent (#E9)", async () => {
    const piWs = await connectSession(piPort, "h2");
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "h2");

    sendEvent(piWs, "h2", "agent_start");
    await wait(60);
    broadcasts.length = 0;

    sendBeat(piWs, "h2");
    await wait(120);

    expect(server.sessionManager.get("h2")?.status).toBe("streaming");
    const statusBroadcasts = broadcasts.filter(
      (b) => (b.updates as Record<string, unknown> | undefined)?.status !== undefined,
    );
    expect(statusBroadcasts.length).toBe(0);

    piWs.close();
    browser.close();
  });

  it("does not stamp unread (#F4)", async () => {
    const piWs = await connectSession(piPort, "h3");
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "h3");
    // Deliberately NOT viewing — a real agent_end here would stamp unread.

    sendEvent(piWs, "h3", "agent_start");
    await wait(60);
    expect(server.sessionManager.get("h3")?.unread).toBeFalsy();

    sendBeat(piWs, "h3", false);
    await wait(150);

    expect(server.sessionManager.get("h3")?.status).toBe("idle");
    expect(server.sessionManager.get("h3")?.unread).toBeFalsy();
    const unreadTrue = broadcasts.filter(
      (b) => (b.updates as Record<string, unknown> | undefined)?.unread === true,
    );
    expect(unreadTrue.length).toBe(0);

    piWs.close();
    browser.close();
  });

  it("carries no run-boundary meaning — no agent_end appended, lastSettledAt untouched (#F5)", async () => {
    const piWs = await connectSession(piPort, "h4");

    sendEvent(piWs, "h4", "agent_start");
    sendEvent(piWs, "h4", "message_end", { text: "hi" });
    await wait(80);

    const before = server.eventStore.getEvents("h4", 1);
    const settledBefore = server.sessionManager.get("h4")?.lastSettledAt;

    sendBeat(piWs, "h4", false);
    await wait(150);

    const after = server.eventStore.getEvents("h4", 1);
    expect(after.length).toBe(before.length);
    expect(after.some((e) => e.event.eventType === "agent_end")).toBe(false);
    expect(server.sessionManager.get("h4")?.lastSettledAt).toBe(settledBefore);
    expect(server.sessionManager.get("h4")?.status).toBe("idle");

    piWs.close();
  });

  it("is suppressed during the replay window (#F2)", async () => {
    // No replay_complete → the session stays inside its replay window.
    const piWs = await connectSession(piPort, "h5", { replayComplete: false });
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "h5");

    sendEvent(piWs, "h5", "agent_start");
    await wait(60);
    expect(server.sessionManager.get("h5")?.status).toBe("streaming");
    broadcasts.length = 0;

    sendBeat(piWs, "h5", false);
    await wait(120);

    expect(server.sessionManager.get("h5")?.status).toBe("streaming");
    const statusBroadcasts = broadcasts.filter(
      (b) => (b.updates as Record<string, unknown> | undefined)?.status !== undefined,
    );
    expect(statusBroadcasts.length).toBe(0);

    piWs.close();
    browser.close();
  });

  it("preserves a live ask_user tool across the correction (#E11)", async () => {
    const piWs = await connectSession(piPort, "h6");

    sendEvent(piWs, "h6", "agent_start");
    await wait(50);
    // A live prompt request keeps `currentTool: "ask_user"` on the card.
    piWs.send(JSON.stringify({
      type: "prompt_request",
      sessionId: "h6",
      promptId: "p1",
      prompt: { type: "input", question: "which one?" },
    }));
    await wait(80);
    expect(server.sessionManager.get("h6")?.currentTool).toBe("ask_user");

    sendBeat(piWs, "h6", false);
    await wait(150);

    expect(server.sessionManager.get("h6")?.status).toBe("idle");
    expect(server.sessionManager.get("h6")?.currentTool).toBe("ask_user");

    piWs.close();
  });

  it("never resurrects a session racing teardown (#X4)", async () => {
    const piWs = await connectSession(piPort, "h7");
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "h7");

    server.sessionManager.update("h7", { status: "ended" });
    await wait(60);
    broadcasts.length = 0;

    sendBeat(piWs, "h7", true);
    await wait(120);

    expect(server.sessionManager.get("h7")?.status).toBe("ended");
    const statusBroadcasts = broadcasts.filter(
      (b) => (b.updates as Record<string, unknown> | undefined)?.status !== undefined,
    );
    expect(statusBroadcasts.length).toBe(0);

    piWs.close();
    browser.close();
  });

  it("the → streaming arm leaves currentTool alone (#E15)", async () => {
    const piWs = await connectSession(piPort, "h8");

    // The agent_start was lost; a later tool event still stamped currentTool.
    sendEvent(piWs, "h8", "tool_execution_start", { toolName: "bash" });
    await wait(60);
    expect(server.sessionManager.get("h8")?.currentTool).toBe("bash");

    sendBeat(piWs, "h8", true);
    await wait(150);

    expect(server.sessionManager.get("h8")?.status).toBe("streaming");
    expect(server.sessionManager.get("h8")?.currentTool).toBe("bash");

    piWs.close();
  });

  it("emits no churn in steady state over 20 agreeing beats (#P1)", async () => {
    const piWs = await connectSession(piPort, "h9");
    const { ws: browser, broadcasts } = await connectBrowser(browserPort, "h9");

    sendEvent(piWs, "h9", "agent_start");
    await wait(50);
    sendEvent(piWs, "h9", "agent_end");
    await wait(80);
    expect(server.sessionManager.get("h9")?.status).toBe("idle");
    broadcasts.length = 0;

    for (let i = 0; i < 20; i++) sendBeat(piWs, "h9", false);
    await wait(200);

    expect(server.sessionManager.get("h9")?.status).toBe("idle");
    const statusBroadcasts = broadcasts.filter(
      (b) => (b.updates as Record<string, unknown> | undefined)?.status !== undefined,
    );
    expect(statusBroadcasts.length).toBe(0);

    piWs.close();
    browser.close();
  });

  it("logs a correcting reconcile (#E13) and stays silent on an inert one (#E14)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const piWs = await connectSession(piPort, "ha");
    sendEvent(piWs, "ha", "agent_start");
    await wait(60);

    logSpy.mockClear();
    sendBeat(piWs, "ha", false);
    await wait(150);

    const lines = logSpy.mock.calls.map((c) => c.join(" ")).filter((l) => l.includes("ha"));
    const healLine = lines.find((l) => l.includes("streaming") && l.includes("idle"));
    expect(healLine).toBeDefined();

    // Now inert: idle + not running.
    logSpy.mockClear();
    sendBeat(piWs, "ha", false);
    await wait(150);
    const inert = logSpy.mock.calls
      .map((c) => c.join(" "))
      .filter((l) => l.includes("reconcile"));
    expect(inert.length).toBe(0);

    piWs.close();
  });
});
