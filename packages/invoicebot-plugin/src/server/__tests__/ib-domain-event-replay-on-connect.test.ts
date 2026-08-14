/**
 * replay-invoice-domain-events · integration (full server). A browser that
 * connects AFTER an ib_domain_event was broadcast MUST be replayed the latest
 * cached frame on connect, marked `replay: true`, so a late-mounting surface
 * converges on current truth. A subsequently-broadcast LIVE event MUST arrive
 * without the `replay` marker.
 *
 * RED on the pre-change tree: nothing caches ib_domain_event, so a
 * later-connecting browser receives nothing on connect.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function sendIbPluginMessage(ws: WebSocket, sessionId: string, payload: unknown): void {
  ws.send(JSON.stringify({ type: "plugin_pi_message", sessionId, pluginId: "invoicebot", messageType: "ib_domain_event", payload }));
}

describe("invoicebot: ib_domain_event replay on connect", () => {
  let server: DashboardServer;
  let piPort: number;
  let browserPort: number;

  beforeEach(async () => {
    ibDomainEventCache.reset();
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
    ibDomainEventCache.reset();
  });

  it("replays the latest cached domain event to a LATER-connecting browser marked replay:true", async () => {
    const session = await connectSession(piPort, "ib-replay");

    // A live event is broadcast while NO late browser is connected yet.
    sendIbPluginMessage(session, "ib-replay", {
      eventType: "ib_invoice_state_changed",
      data: { invoice_id: "inv-1", state: "partner_pending" },
    });
    await wait(150);

    // Browser connects AFTER the event — on the pre-change tree it gets nothing.
    const { ws: late, messages } = await connectBrowser(browserPort);
    await wait(150);

    const replayed = messages.filter((m) => m.type === "ib_domain_event");
    expect(replayed.length).toBe(1);
    expect(replayed[0]).toEqual({
      type: "ib_domain_event",
      sessionId: "ib-replay",
      event: { eventType: "ib_invoice_state_changed", data: { invoice_id: "inv-1", state: "partner_pending" } },
      replay: true,
    });

    // A subsequent LIVE event arrives WITHOUT the replay marker.
    sendIbPluginMessage(session, "ib-replay", {
      eventType: "ib_invoice_state_changed",
      data: { invoice_id: "inv-1", state: "approved" },
    });
    await wait(150);

    const live = messages.filter((m) => m.type === "ib_domain_event" && m.replay !== true);
    expect(live.length).toBe(1);
    expect((live[0] as { event: { data: { state: string } } }).event.data.state).toBe("approved");

    session.close();
    late.close();
  });

  it("replays only the LATEST state per invoice, not superseded intermediates", async () => {
    const session = await connectSession(piPort, "ib-latest");
    for (const state of ["received", "extracted", "partner_pending"]) {
      sendIbPluginMessage(session, "ib-latest", {
        eventType: "ib_invoice_state_changed",
        data: { invoice_id: "inv-2", state },
      });
      await wait(40);
    }
    await wait(120);

    const { ws: late, messages } = await connectBrowser(browserPort);
    await wait(150);

    const replayed = messages.filter((m) => m.type === "ib_domain_event");
    expect(replayed.length).toBe(1);
    expect((replayed[0] as { event: { data: { state: string } }; replay?: boolean }).event.data.state).toBe("partner_pending");
    expect((replayed[0] as { replay?: boolean }).replay).toBe(true);

    session.close();
    late.close();
  });
});
