import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

/**
 * App-level InvoiceBot domain-event rebroadcast (event-wiring.ts).
 *
 * A forwarded lifecycle `ib_*` domain event fans out to EVERY connected
 * browser on the `ib_domain_event` channel, carrying the originating
 * `sessionId` + payload, WITHOUT a per-session subscribe. Additive: the
 * per-session `event` stream is preserved. Headless-safe: no-browser is a
 * no-op and a malformed frame never crashes the gateway. Delta-only: a
 * reconnecting client resumes the live stream with no historical replay.
 *
 * See change: surface-invoice-domain-events-app-level.
 */

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

/** Connect a browser and capture every server → browser message. */
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

function sendIbEvent(
  ws: WebSocket,
  sessionId: string,
  eventType: string,
  data: Record<string, unknown>,
): void {
  ws.send(JSON.stringify({
    type: "event_forward",
    sessionId,
    event: { eventType, timestamp: Date.now(), data },
  }));
}

function costPayload(final: boolean): Record<string, unknown> {
  return {
    invoice_id: "inv-cost-1",
    currency: "USD",
    total: 0.000321,
    tokens: { input: 101, output: 17 },
    perStep: [{
      stepId: "extract",
      agent: "ib-extractor",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      tokensIn: 101,
      tokensOut: 17,
      cost: 0.000321,
    }],
    updatedAt: "2026-07-23T12:00:00.000Z",
    final,
  };
}

describe("event-wiring: app-level ib_* domain-event rebroadcast", () => {
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
      editor: { idleTimeoutMinutes: 10, maxInstances: 3 },
    });
    await server.start();
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterEach(async () => {
    await server.stop();
  });

  // 4.1 — reaches a connected-but-unsubscribed browser, carrying sessionId + payload.
  it("reaches a connected-but-unsubscribed browser with correct sessionId and payload", async () => {
    const session = await connectSession(piPort, "ib1");
    const { ws: browser, messages } = await connectBrowser(browserPort);
    // NOTE: deliberately NOT subscribed to "ib1".

    sendIbEvent(session, "ib1", "ib_approval_requested", { invoiceId: "inv-42", amount: 100 });
    await wait(120);

    const appLevel = messages.filter((m) => m.type === "ib_domain_event");
    expect(appLevel.length).toBe(1);
    expect(appLevel[0].sessionId).toBe("ib1");
    expect(appLevel[0].event).toEqual({
      eventType: "ib_approval_requested",
      data: { invoiceId: "inv-42", amount: 100 },
    });

    session.close();
    browser.close();
  });

  it("rebroadcasts full cost accrual and freeze payloads without rounding", async () => {
    const session = await connectSession(piPort, "ib-cost");
    const unsubscribed = await connectBrowser(browserPort);
    const subscribed = await connectBrowser(browserPort);
    subscribed.ws.send(JSON.stringify({ type: "subscribe", sessionId: "ib-cost" }));
    await wait(100);

    const accrual = costPayload(false);
    sendIbEvent(session, "ib-cost", "ib_invoice_cost_updated", accrual);
    await wait(120);

    const unsubscribedApp = unsubscribed.messages.filter((m) => m.type === "ib_domain_event");
    expect(unsubscribedApp).toHaveLength(1);
    expect(unsubscribedApp[0]).toEqual({
      type: "ib_domain_event",
      sessionId: "ib-cost",
      event: { eventType: "ib_invoice_cost_updated", data: accrual },
    });

    const subscribedPerSession = subscribed.messages.filter(
      (m) => m.type === "event" && m.sessionId === "ib-cost" &&
        (m.event as Record<string, unknown>)?.eventType === "ib_invoice_cost_updated",
    );
    expect(subscribedPerSession).toHaveLength(1);
    expect((subscribedPerSession[0].event as Record<string, unknown>).data).toEqual(accrual);
    expect(subscribed.messages.filter((m) => m.type === "ib_domain_event")).toHaveLength(1);

    const freeze = costPayload(true);
    sendIbEvent(session, "ib-cost", "ib_invoice_cost_updated", freeze);
    await wait(120);

    const unsubscribedFrames = unsubscribed.messages.filter((m) => m.type === "ib_domain_event");
    expect(unsubscribedFrames).toHaveLength(2);
    expect((unsubscribedFrames[1].event as Record<string, unknown>).data).toEqual(freeze);

    session.close();
    unsubscribed.ws.close();
    subscribed.ws.close();
  });

  // 4.2 — per-session stream still delivers to that session's subscribers (additive).
  it("preserves the per-session stream for subscribers (additive, not replacing)", async () => {
    const session = await connectSession(piPort, "ib2");
    const { ws: browser, messages } = await connectBrowser(browserPort);
    browser.send(JSON.stringify({ type: "subscribe", sessionId: "ib2" }));
    await wait(100);

    sendIbEvent(session, "ib2", "ib_approval_decided", { invoiceId: "inv-7", decision: "approve" });
    await wait(120);

    // Per-session `event` message still arrives for the subscriber.
    const perSession = messages.filter(
      (m) => m.type === "event" && m.sessionId === "ib2" &&
        (m.event as Record<string, unknown>)?.eventType === "ib_approval_decided",
    );
    expect(perSession.length).toBe(1);

    // And the app-level channel fired in addition.
    const appLevel = messages.filter((m) => m.type === "ib_domain_event");
    expect(appLevel.length).toBe(1);

    session.close();
    browser.close();
  });

  // 4.3 — no-browser is a no-op; malformed event does not crash the gateway.
  it("no-ops with no browser connected and skips a malformed event without crashing", async () => {
    const session = await connectSession(piPort, "ib3");

    // No browser connected: broadcastToAll is a no-op and must not throw.
    sendIbEvent(session, "ib3", "ib_approval_requested", { invoiceId: "inv-1" });
    await wait(80);

    // Now connect a browser and send a MALFORMED (payload-less) ib_ event,
    // then a well-formed one. The malformed frame must be skipped without
    // crashing the gateway, and the subsequent well-formed frame must still
    // be broadcast.
    const { ws: browser, messages } = await connectBrowser(browserPort);
    session.send(JSON.stringify({
      type: "event_forward",
      sessionId: "ib3",
      event: { eventType: "ib_approval_requested", timestamp: Date.now() }, // no `data`
    }));
    await wait(60);
    sendIbEvent(session, "ib3", "ib_approval_decided", { invoiceId: "inv-1", decision: "approve" });
    await wait(120);

    const appLevel = messages.filter((m) => m.type === "ib_domain_event");
    expect(appLevel.length).toBe(1);
    expect(appLevel[0].event).toEqual({
      eventType: "ib_approval_decided",
      data: { invoiceId: "inv-1", decision: "approve" },
    });

    // Server is still healthy.
    expect(server.sessionManager.get("ib3")).toBeDefined();

    session.close();
    browser.close();
  });

  // 4.4 — reconnecting client resumes live stream with no historical replay.
  it("resumes the live stream on reconnect with no historical replay", async () => {
    const session = await connectSession(piPort, "ib4");

    const first = await connectBrowser(browserPort);
    sendIbEvent(session, "ib4", "ib_approval_requested", { invoiceId: "before" });
    await wait(100);
    expect(first.messages.filter((m) => m.type === "ib_domain_event").length).toBe(1);

    // Browser disconnects; an event is forwarded while it is gone.
    first.ws.close();
    await wait(60);
    sendIbEvent(session, "ib4", "ib_approval_decided", { invoiceId: "while-gone" });
    await wait(100);

    // A NEW browser connects and only receives subsequently-forwarded events.
    const second = await connectBrowser(browserPort);
    sendIbEvent(session, "ib4", "ib_approval_requested", { invoiceId: "after" });
    await wait(120);

    const received = second.messages.filter((m) => m.type === "ib_domain_event");
    // Exactly the post-reconnect event — no replay of "before" or "while-gone".
    expect(received.length).toBe(1);
    expect((received[0].event as Record<string, unknown>).data).toEqual({ invoiceId: "after" });

    session.close();
    second.ws.close();
  });
});
