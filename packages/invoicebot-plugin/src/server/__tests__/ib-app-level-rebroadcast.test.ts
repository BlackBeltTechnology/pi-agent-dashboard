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
import { ibDomainEventCache } from "../../../../server/src/ib-domain-event-cache.js";

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
    // The domain-event cache is a module singleton that outlives per-test server
    // instances; reset it so replay-on-connect starts clean each test.
    // See change: replay-invoice-domain-events.
    ibDomainEventCache.reset();
  });

  afterEach(async () => {
    await server.stop();
    ibDomainEventCache.reset();
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

    // Only LIVE frames (replay !== true) assert the malformed-skip contract; the
    // pre-connect event is now cached and replayed on connect (replay: true),
    // which is the intended new behavior. See change: replay-invoice-domain-events.
    const liveFrames = messages.filter((m) => m.type === "ib_domain_event" && (m as { replay?: boolean }).replay !== true);
    expect(liveFrames.length).toBe(1);
    expect(liveFrames[0].event).toEqual({
      eventType: "ib_approval_decided",
      data: { invoiceId: "inv-1", decision: "approve" },
    });
    // The null-data (malformed) frame is neither cached nor broadcast.
    expect(server.sessionManager.get("ib3")).toBeDefined();

    session.close();
    browser.close();
  });

  // restore-assistant-greeting-stream — END-TO-END proof through the REAL WS
  // path (plugin_pi_message → server broadcastToSubscribers → browser) that a
  // greeting now (a) reaches a client live carrying the server-assigned stable
  // id + ordering key (the producer payload carries none), and (b) replays IN
  // ORDER on connect, not collapsed to newest.
  it("stamps a LIVE greeting with a server-assigned id + order and delivers it to a client", async () => {
    const session = await connectSession(piPort, "ib-greet");
    const { ws: browser, messages } = await connectBrowser(browserPort);

    // The producer payload carries NO id — just the structured state (design D3).
    sendIbPluginMessage(session, "ib-greet", {
      eventType: "ib_greeting",
      data: { customType: "ib-greeting", state: "exported", content: "Kész", details: { state: "exported" } },
    });
    await wait(150);

    const live = messages.filter((m) => m.type === "ib_domain_event" && (m as { replay?: boolean }).replay !== true);
    expect(live).toHaveLength(1);
    expect((live[0].event as { eventType: string }).eventType).toBe("ib_greeting");
    // Server stamped the stable id (derived from state) + ordering key onto the
    // LIVE frame, so the client can fold + dedupe it.
    expect((live[0] as { greetingId?: string }).greetingId).toBe("exported");
    expect(typeof (live[0] as { greetingOrder?: number }).greetingOrder).toBe("number");

    session.close();
    browser.close();
  });

  it("replays the full greeting stream IN ORDER on connect, not collapsed to newest", async () => {
    const session = await connectSession(piPort, "ib-greet-order");

    // Three greetings emitted BEFORE any browser connects.
    for (const state of ["partner_pending", "pending_approval", "exported"]) {
      sendIbPluginMessage(session, "ib-greet-order", {
        eventType: "ib_greeting",
        data: { customType: "ib-greeting", state, content: state, details: { state } },
      });
      await wait(40);
    }

    const browser = await connectBrowser(browserPort);
    await wait(120);

    const replayed = browser.messages.filter(
      (m) => m.type === "ib_domain_event" && (m as { replay?: boolean }).replay === true && (m.event as { eventType?: string }).eventType === "ib_greeting",
    );
    // All three replayed (NOT collapsed to only "exported"), in emission order.
    expect(replayed.map((m) => (m.event as { data: { state: string } }).data.state)).toEqual([
      "partner_pending",
      "pending_approval",
      "exported",
    ]);
    expect(replayed.map((m) => (m as { greetingId?: string }).greetingId)).toEqual([
      "partner_pending",
      "pending_approval",
      "exported",
    ]);

    session.close();
    browser.ws.close();
  });

  it("replays the latest cached state on reconnect, then resumes the live stream", async () => {
    // Supersedes the prior "no historical replay" guarantee: a browser that
    // (re)connects now receives the latest cached domain event per key marked
    // replay:true, then live deltas. See change: replay-invoice-domain-events.
    const session = await connectSession(piPort, "ib4");

    const first = await connectBrowser(browserPort);
    // Empty cache at connect → the first live event is the only frame.
    sendIbPluginMessage(session, "ib4", { eventType: "ib_approval_requested", data: { invoiceId: "before" } });
    await wait(120);
    expect(first.messages.filter((m) => m.type === "ib_domain_event").length).toBe(1);

    first.ws.close();
    await wait(60);
    sendIbPluginMessage(session, "ib4", { eventType: "ib_approval_decided", data: { invoiceId: "while-gone" } });
    await wait(100);

    const second = await connectBrowser(browserPort);
    await wait(100);
    // On connect the second browser is replayed the latest cached state (both
    // event types), each marked replay:true — it converges without waiting.
    const replayed = second.messages.filter((m) => m.type === "ib_domain_event" && (m as { replay?: boolean }).replay === true);
    expect(replayed.length).toBe(2);
    expect(replayed.every((m) => (m as { replay?: boolean }).replay === true)).toBe(true);

    sendIbPluginMessage(session, "ib4", { eventType: "ib_approval_requested", data: { invoiceId: "after" } });
    await wait(150);

    // The subsequent live delta arrives WITHOUT the replay marker.
    const live = second.messages.filter((m) => m.type === "ib_domain_event" && (m as { replay?: boolean }).replay !== true);
    expect(live.length).toBe(1);
    expect((live[0].event as Record<string, unknown>).data).toEqual({ invoiceId: "after" });

    session.close();
    second.ws.close();
  });
});
