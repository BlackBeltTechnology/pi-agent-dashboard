/**
 * relocate-ib-domain-events-to-plugin · integration (full server) — THE
 * REGRESSION TEST. An `ib_domain_event` plugin message arriving over the pi
 * WebSocket (the generic `plugin_pi_message` envelope a plugin bridge entry
 * produces) MUST reach a connected-but-UNSUBSCRIBED browser as the unchanged
 * wire frame `{ type:"ib_domain_event", sessionId, event:{ eventType, data } }`.
 *
 * RED on the pre-change tree: nothing registers an `ib_domain_event` pi
 * handler, so the dispatch is a no-op and no browser frame is produced (the
 * exact live failure: app-level rebroadcast fired zero times).
 *
 * Scenarios ported like-for-like from the retired core test
 * `packages/server/src/__tests__/event-wiring-ib-app-level.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../../../../server/src/server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connectSession(piPort: number, sessionId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: "/tmp", source: "cli" }));
      ws.send(JSON.stringify({ type: "replay_complete", sessionId }));
      setTimeout(resolve, 60);
    });
  });
  return ws;
}

async function connectBrowser(browserPort: number): Promise<{
  ws: WebSocket;
  messages: Array<Record<string, unknown>>;
}> {
  const ws = new WebSocket(`ws://127.0.0.1:${browserPort}/ws`);
  const messages: Array<Record<string, unknown>> = [];
  await new Promise<void>((resolve) => {
    ws.on("open", () => {
      ws.on("message", (raw) => {
        try {
          messages.push(JSON.parse(raw.toString()));
        } catch { /* ignore */ }
      });
      setTimeout(resolve, 60);
    });
  });
  return { ws, messages };
}

/** Send the generic plugin envelope the invoicebot bridge entry produces. */
function sendIbPluginMessage(
  ws: WebSocket,
  sessionId: string,
  payload: unknown,
): void {
  ws.send(JSON.stringify({
    type: "plugin_pi_message",
    sessionId,
    pluginId: "invoicebot",
    messageType: "ib_domain_event",
    payload,
  }));
}

describe("invoicebot plugin: app-level ib_domain_event rebroadcast", () => {
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

  it("reaches a connected-but-UNSUBSCRIBED browser with the unchanged wire frame", async () => {
    const session = await connectSession(piPort, "ib1");
    const { ws: browser, messages } = await connectBrowser(browserPort);
    // NOTE: deliberately NOT subscribed to "ib1".

    sendIbPluginMessage(session, "ib1", {
      eventType: "ib_approval_requested",
      data: { invoiceId: "inv-42", amount: 100 },
    });
    await wait(150);

    const appLevel = messages.filter((m) => m.type === "ib_domain_event");
    expect(appLevel.length).toBe(1);
    expect(appLevel[0]).toEqual({
      type: "ib_domain_event",
      sessionId: "ib1",
      event: { eventType: "ib_approval_requested", data: { invoiceId: "inv-42", amount: 100 } },
    });

    session.close();
    browser.close();
  });

  it("rebroadcasts full cost accrual + freeze payloads without rounding", async () => {
    const session = await connectSession(piPort, "ib-cost");
    const unsubscribed = await connectBrowser(browserPort);

    const cost = (final: boolean) => ({
      invoice_id: "inv-cost-1",
      currency: "USD",
      total: 0.000321,
      tokens: { input: 101, output: 17 },
      perStep: [{ stepId: "extract", agent: "ib-extractor", provider: "anthropic", model: "claude-sonnet-4-6", tokensIn: 101, tokensOut: 17, cost: 0.000321 }],
      updatedAt: "2026-07-23T12:00:00.000Z",
      final,
    });

    sendIbPluginMessage(session, "ib-cost", { eventType: "ib_invoice_cost_updated", data: cost(false) });
    await wait(150);
    sendIbPluginMessage(session, "ib-cost", { eventType: "ib_invoice_cost_updated", data: cost(true) });
    await wait(150);

    const frames = unsubscribed.messages.filter((m) => m.type === "ib_domain_event");
    expect(frames).toHaveLength(2);
    expect((frames[0].event as Record<string, unknown>).data).toEqual(cost(false));
    expect((frames[1].event as Record<string, unknown>).data).toEqual(cost(true));

    session.close();
    unsubscribed.ws.close();
  });

  it("no-ops with no browser connected and skips a malformed message without crashing", async () => {
    const session = await connectSession(piPort, "ib3");

    // No browser connected: must not throw server-side.
    sendIbPluginMessage(session, "ib3", { eventType: "ib_approval_requested", data: { invoiceId: "inv-1" } });
    await wait(80);

    // Malformed (null data) then well-formed: malformed skipped, well-formed delivered.
    const { ws: browser, messages } = await connectBrowser(browserPort);
    sendIbPluginMessage(session, "ib3", { eventType: "ib_approval_requested", data: null });
    await wait(60);
    sendIbPluginMessage(session, "ib3", { eventType: "ib_approval_decided", data: { invoiceId: "inv-1", decision: "approve" } });
    await wait(150);

    const liveFrames = messages.filter((m) => m.type === "ib_domain_event");
    expect(liveFrames.length).toBe(1);
    expect(liveFrames[0].event).toEqual({
      eventType: "ib_approval_decided",
      data: { invoiceId: "inv-1", decision: "approve" },
    });
    // The null-data (malformed) frame is never broadcast.
    expect(server.sessionManager.get("ib3")).toBeDefined();

    session.close();
    browser.close();
  });

  it("delivers LIVE deltas only — a browser connecting AFTER an event gets no replay", async () => {
    // The host-side latest-per-entity cache is GONE: the plugin broadcasts live
    // deltas and nothing else. A late-mounting surface converges by READING
    // current state over `POST /api/plugins/invoicebot/query` (view:"list"),
    // never by replaying cached wire frames. See change: merge-dashboard-develop.
    const session = await connectSession(piPort, "ib4");

    sendIbPluginMessage(session, "ib4", { eventType: "ib_approval_decided", data: { invoiceId: "while-gone" } });
    await wait(120);

    const late = await connectBrowser(browserPort);
    await wait(120);
    // Nothing is replayed on connect.
    expect(late.messages.filter((m) => m.type === "ib_domain_event").length).toBe(0);

    // The subsequent live delta still arrives, unchanged and unmarked.
    sendIbPluginMessage(session, "ib4", { eventType: "ib_approval_requested", data: { invoiceId: "after" } });
    await wait(150);
    const live = late.messages.filter((m) => m.type === "ib_domain_event");
    expect(live.length).toBe(1);
    expect((live[0].event as Record<string, unknown>).data).toEqual({ invoiceId: "after" });
    expect((live[0] as { replay?: boolean }).replay).toBeUndefined();

    session.close();
    late.ws.close();
  });
});
