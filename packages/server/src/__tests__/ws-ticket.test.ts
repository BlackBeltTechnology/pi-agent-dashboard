import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { decideBridgeTicketMint } from "../auth/bridge-ticket-eligibility.js";
import { extractTicket, routeScopeForUrl, WsTicketStore } from "../auth/ws-ticket.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { decideBridgeUpgrade } from "../pi/bridge-upgrade-auth.js";

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

/**
 * #X11 (task 12.30) — revocation actually locks a device out.
 *
 * Two doors must both close: minting a `bridge` ticket (the durable bearer is
 * the only thing a REMOTE bridge has), and the upgrade itself. A revoked
 * device that could still mint would keep full bridge access for as long as it
 * kept minting.
 */
describe("revoked paired device (#X11)", () => {
  let registryFile: string;
  let registry: PairedDeviceRegistry;

  beforeEach(() => {
    registryFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "paired-")), "devices.json");
    registry = new PairedDeviceRegistry(registryFile);
  });

  const mintVerdict = (token: string) =>
    decideBridgeTicketMint({
      authorization: `Bearer ${token}`,
      // A REMOTE bridge — the genuinely-local branch must not rescue it.
      ip: "203.0.113.7",
      headers: {},
      verifyDeviceBearer: (t) => registry.verify(t),
    });

  it("mints for a paired device and refuses once revoked, with a named reason", () => {
    const { device, token } = registry.add("remote-laptop");
    expect(mintVerdict(token)).toMatchObject({ allow: true });

    expect(registry.revoke(device.id)).toBe(true);
    const after = mintVerdict(token);
    expect(after.allow).toBe(false);
    expect(after.reason).toMatch(/paired-device bearer/);
  });

  it("refuses the upgrade too — a revoked device cannot register", () => {
    const { device, token } = registry.add("remote-laptop");
    registry.revoke(device.id);
    expect(mintVerdict(token).allow).toBe(false);
    // With no mintable ticket, the upgrade gate sees a remote peer with no
    // credential at all.
    const verdict = decideBridgeUpgrade({
      transport: "tcp",
      remoteAddress: "203.0.113.7",
      headers: {},
      consumeTicket: () => ({ ok: false as const, reason: "missing" as const }),
    });
    expect(verdict).toMatchObject({ allow: false, cause: "no-ticket" });
  });

  it("survives a reload from disk — revocation is persisted, not in-memory only", () => {
    const { device, token } = registry.add("remote-laptop");
    registry.revoke(device.id);
    const reloaded = new PairedDeviceRegistry(registryFile);
    expect(reloaded.verify(token)).toBeNull();
  });
});
