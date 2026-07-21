import { describe, expect, it } from "vitest";
import { extractTicket, routeScopeForUrl, WsTicketStore } from "../auth/ws-ticket.js";

describe("routeScopeForUrl", () => {
  it("maps WS routes to scopes and rejects unknowns", () => {
    expect(routeScopeForUrl("/ws")).toBe("browser");
    expect(routeScopeForUrl("/ws?ticket=x")).toBe("browser");
    expect(routeScopeForUrl("/ws/terminal/abc")).toBe("terminal");
    expect(routeScopeForUrl("/editor/xyz")).toBe(null);
    expect(routeScopeForUrl("/live/1")).toBe("live");
    expect(routeScopeForUrl("/api/health")).toBe(null);
    expect(routeScopeForUrl(undefined)).toBe(null);
  });
});

describe("extractTicket", () => {
  it("reads ticket from URL query or pi-ticket subprotocol", () => {
    expect(extractTicket("/ws?ticket=abc", undefined)).toBe("abc");
    expect(extractTicket("/ws", "pi-ticket.def")).toBe("def");
    expect(extractTicket("/ws", "json, pi-ticket.ghi")).toBe("ghi");
    expect(extractTicket("/ws", "json")).toBe(null);
    expect(extractTicket("/ws", undefined)).toBe(null);
  });
});

describe("WsTicketStore", () => {
  it("mints and consumes a scoped ticket exactly once", () => {
    const now = 1000;
    const store = new WsTicketStore(() => now);
    const t = store.mint("browser");
    expect(store.consume(t, "browser")).toBe(true);
    // Single-use: second consume fails.
    expect(store.consume(t, "browser")).toBe(false);
  });

  it("refuses a ticket presented against a different route scope (privilege escalation)", () => {
    const now = 1000;
    const store = new WsTicketStore(() => now);
    const t = store.mint("browser");
    // Deleted on first attempt even though scope mismatched.
    expect(store.consume(t, "terminal")).toBe(false);
    expect(store.consume(t, "browser")).toBe(false);
  });

  it("refuses an expired ticket", () => {
    let now = 1000;
    const store = new WsTicketStore(() => now);
    const t = store.mint("browser");
    now += 20_000;
    expect(store.consume(t, "browser")).toBe(false);
  });

  it("refuses missing/unknown tickets", () => {
    const store = new WsTicketStore();
    expect(store.consume(null, "browser")).toBe(false);
    expect(store.consume("never-minted", "browser")).toBe(false);
  });
});
