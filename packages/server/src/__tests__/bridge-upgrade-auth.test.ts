/**
 * Who may open a bridge WebSocket, per transport (task 6.3, D5/D7/D10b).
 *
 * The TCP listener is what made the container default indefensible: anything
 * that could reach `0.0.0.0:9999` could register an arbitrary `sessionId`.
 * This is the gate. It is a pure decision table on purpose — the refusal
 * reasons have to be distinguishable, and an emergent one cannot be.
 *
 * (test-plan #E21) See change: add-pi-gateway-transport-identity.
 */
import { afterEach, describe, expect, it } from "vitest";
import { WsTicketStore } from "../auth/ws-ticket.js";
import { decideBridgeUpgrade } from "../pi/bridge-upgrade-auth.js";

const store = () => new WsTicketStore();
const consumeWith = (s: WsTicketStore) => (t: string | null | undefined) => s.consumeDetailed(t, "bridge");

describe("decideBridgeUpgrade", () => {
  // D5: on the socket the kernel already decided. Requiring a token there
  // would re-introduce the very secret the transport exists to delete.
  it("allows a unix-socket upgrade with no credential", () => {
    const v = decideBridgeUpgrade({ transport: "unix", consumeTicket: () => ({ ok: false, reason: "missing" }) });
    expect(v.allow).toBe(true);
  });

  it("refuses an unauthenticated REMOTE tcp upgrade", () => {
    const v = decideBridgeUpgrade({
      transport: "tcp",
      remoteAddress: "10.1.2.3",
      consumeTicket: () => ({ ok: false, reason: "missing" }),
    });
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.reason).toContain("missing");
  });

  it("allows a REMOTE tcp upgrade presenting a valid bridge ticket", () => {
    const s = store();
    const ticket = s.mint("bridge");
    const v = decideBridgeUpgrade({
      transport: "tcp",
      remoteAddress: "10.1.2.3",
      url: `/ws/bridge?ticket=${ticket}`,
      consumeTicket: consumeWith(s),
    });
    expect(v.allow).toBe(true);
  });

  it("distinguishes reuse, expiry and wrong scope from plain absence", () => {
    const s = store();
    const used = s.mint("bridge");
    s.consume(used, "bridge");
    const reuse = decideBridgeUpgrade({
      transport: "tcp",
      remoteAddress: "10.1.2.3",
      url: `/ws/bridge?ticket=${used}`,
      consumeTicket: consumeWith(s),
    });
    expect(reuse.allow === false && reuse.reason).toContain("unknown");

    const wrongScope = s.mint("browser");
    const scoped = decideBridgeUpgrade({
      transport: "tcp",
      remoteAddress: "10.1.2.3",
      url: `/ws/bridge?ticket=${wrongScope}`,
      consumeTicket: consumeWith(s),
    });
    expect(scoped.allow === false && scoped.reason).toContain("wrong-scope");
  });

  // The deprecation window (D10b / task 8.4): an old bridge on this host has
  // no way to mint a ticket, and breaking every un-upgraded local session at
  // server-update time is a worse failure than the window it closes. Remote
  // peers get NO such grace.
  it("allows a tokenless LOOPBACK tcp upgrade while the window is open", () => {
    const v = decideBridgeUpgrade({
      transport: "tcp",
      remoteAddress: "127.0.0.1",
      requireTicketOnLoopback: false,
      consumeTicket: () => ({ ok: false, reason: "missing" }),
    });
    expect(v.allow).toBe(true);
    expect(v.allow === true && v.deprecated).toBe(true);
  });

  it("refuses a tokenless loopback upgrade once the window closes", () => {
    const v = decideBridgeUpgrade({
      transport: "tcp",
      remoteAddress: "127.0.0.1",
      requireTicketOnLoopback: true,
      consumeTicket: () => ({ ok: false, reason: "missing" }),
    });
    expect(v.allow).toBe(false);
  });

  it("never extends the loopback grace to a remote peer", () => {
    for (const addr of ["10.1.2.3", "192.168.1.9", "::ffff:10.0.0.7", undefined]) {
      const v = decideBridgeUpgrade({
        transport: "tcp",
        remoteAddress: addr,
        requireTicketOnLoopback: false,
        consumeTicket: () => ({ ok: false, reason: "missing" }),
      });
      expect(v.allow).toBe(false);
    }
  });

  it("treats IPv6 loopback forms as loopback", () => {
    for (const addr of ["::1", "::ffff:127.0.0.1"]) {
      const v = decideBridgeUpgrade({
        transport: "tcp",
        remoteAddress: addr,
        requireTicketOnLoopback: false,
        consumeTicket: () => ({ ok: false, reason: "missing" }),
      });
      expect(v.allow).toBe(true);
    }
  });
});

describe("WsTicketStore.consumeDetailed (task 6.3)", () => {
  it("names each refusal cause", () => {
    let now = 1_000_000;
    const s = new WsTicketStore(() => now);
    expect(s.consumeDetailed(undefined, "bridge")).toEqual({ ok: false, reason: "missing" });
    expect(s.consumeDetailed("nope", "bridge")).toEqual({ ok: false, reason: "unknown" });

    const wrong = s.mint("browser");
    expect(s.consumeDetailed(wrong, "bridge")).toEqual({ ok: false, reason: "wrong-scope" });

    const stale = s.mint("bridge");
    now += 60_000;
    expect(s.consumeDetailed(stale, "bridge")).toEqual({ ok: false, reason: "expired" });

    const good = s.mint("bridge");
    expect(s.consumeDetailed(good, "bridge")).toEqual({ ok: true });
    expect(s.consumeDetailed(good, "bridge")).toEqual({ ok: false, reason: "unknown" });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// The gate on a REAL listener. The decision table above proves the policy;
// this proves the policy is actually installed — a `verifyClient` that is
// wired but never consulted would pass every test above.
// ──────────────────────────────────────────────────────────────────────────
describe("the gate on a live TCP gateway (task 6.3)", () => {
  const gateways: Array<{ stop: () => void }> = [];
  afterEach(() => {
    for (const g of gateways.splice(0)) g.stop();
  });

  const startGateway = async (tickets: WsTicketStore, requireTicketOnLoopback: boolean) => {
    const { createPiGateway } = await import("../pi/pi-gateway.js");
    const { createMemorySessionManager } = await import("../session/memory-session-manager.js");
    const gw = createPiGateway(createMemorySessionManager(), {
      pingInterval: 0,
      bridgeAuth: {
        consumeTicket: (t) => tickets.consumeDetailed(t, "bridge"),
        requireTicketOnLoopback,
        log: () => {},
      },
    });
    gw.start(0, "127.0.0.1");
    gateways.push(gw);
    for (let i = 0; i < 100 && gw.address() === null; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    return gw;
  };

  const dial = (port: number, query = "") =>
    new Promise<"open" | "refused">(async (resolve) => {
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/bridge${query}`);
      ws.once("open", () => {
        ws.close();
        resolve("open");
      });
      ws.once("error", () => resolve("refused"));
    });

  it("refuses a tokenless upgrade once the deprecation window closes", async () => {
    const tickets = new WsTicketStore();
    const gw = await startGateway(tickets, true);
    expect(await dial(gw.address() as number)).toBe("refused");
  });

  it("accepts an upgrade presenting a valid bridge ticket", async () => {
    const tickets = new WsTicketStore();
    const gw = await startGateway(tickets, true);
    const t = tickets.mint("bridge");
    expect(await dial(gw.address() as number, `?ticket=${t}`)).toBe("open");
  });

  it("refuses a browser ticket replayed at the bridge route", async () => {
    const tickets = new WsTicketStore();
    const gw = await startGateway(tickets, true);
    const t = tickets.mint("browser");
    expect(await dial(gw.address() as number, `?ticket=${t}`)).toBe("refused");
  });

  // (task 6.4) The durable bearer must never be an accepted socket credential:
  // if it were, it would ride the URL/headers/logs of every bridge connection,
  // which is exactly what the ephemeral ticket exists to prevent.
  it("refuses an upgrade presenting a durable bearer instead of a ticket", async () => {
    const tickets = new WsTicketStore();
    const gw = await startGateway(tickets, true);
    const { WebSocket } = await import("ws");
    const outcome = await new Promise<"open" | "refused">((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${gw.address() as number}/ws/bridge`, {
        headers: { authorization: "Bearer a-perfectly-valid-device-bearer" },
      });
      ws.once("open", () => {
        ws.close();
        resolve("open");
      });
      ws.once("error", () => resolve("refused"));
    });
    expect(outcome).toBe("refused");
  });

  it("refuses a REPLAYED bridge ticket", async () => {
    const tickets = new WsTicketStore();
    const gw = await startGateway(tickets, true);
    const t = tickets.mint("bridge");
    expect(await dial(gw.address() as number, `?ticket=${t}`)).toBe("open");
    expect(await dial(gw.address() as number, `?ticket=${t}`)).toBe("refused");
  });
});
