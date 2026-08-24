/**
 * A remote bridge authenticates like every other remote client: it is a paired
 * device that mints a SHORT-LIVED, SINGLE-USE, SCOPE-BOUND ticket with its
 * durable bearer, and presents only that ticket on the WebSocket upgrade
 * (D7, section 6).
 *
 * The properties that matter are the ones that make the TCP listener
 * defensible at all (D10b): a bridge ticket must not open a browser or
 * terminal route, a browser ticket must not open the bridge route, the durable
 * bearer never rides the socket, and revocation is immediate.
 *
 * (test-plan #E20) See change: add-pi-gateway-transport-identity.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { routeScopeForUrl, WsTicketStore } from "../auth/ws-ticket.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";

describe("routeScopeForUrl: the bridge route (task 6.1)", () => {
  it("maps the gateway upgrade path to the bridge scope", () => {
    expect(routeScopeForUrl("/ws/bridge")).toBe("bridge");
    expect(routeScopeForUrl("/ws/bridge?ticket=abc")).toBe("bridge");
  });

  it("keeps the existing scopes distinct from it", () => {
    expect(routeScopeForUrl("/ws")).toBe("browser");
    expect(routeScopeForUrl("/ws/terminal/abc")).toBe("terminal");
    expect(routeScopeForUrl("/live/abc")).toBe("live");
  });
});

describe("bridge tickets are scope-bound (task 6.3)", () => {
  it("a bridge ticket does not open the browser or terminal routes", () => {
    const store = new WsTicketStore();
    expect(store.consume(store.mint("bridge"), "browser")).toBe(false);
    expect(store.consume(store.mint("bridge"), "terminal")).toBe(false);
    expect(store.consume(store.mint("bridge"), "live")).toBe(false);
  });

  it("a browser ticket does not open the bridge route", () => {
    const store = new WsTicketStore();
    expect(store.consume(store.mint("browser"), "bridge")).toBe(false);
  });

  it("a bridge ticket opens the bridge route exactly once", () => {
    const store = new WsTicketStore();
    const t = store.mint("bridge");
    expect(store.consume(t, "bridge")).toBe(true);
    expect(store.consume(t, "bridge")).toBe(false); // replay
  });

  it("refuses an expired bridge ticket", () => {
    let now = 1_000_000;
    const store = new WsTicketStore(() => now);
    const t = store.mint("bridge");
    now += 60_000;
    expect(store.consume(t, "bridge")).toBe(false);
  });

  it("refuses an unauthenticated upgrade — no ticket at all", () => {
    const store = new WsTicketStore();
    expect(store.consume(undefined, "bridge")).toBe(false);
    expect(store.consume("", "bridge")).toBe(false);
    expect(store.consume("not-a-ticket", "bridge")).toBe(false);
  });
});

describe("the bridge's durable credential (tasks 6.2, 6.5, 6.6)", () => {
  let dir: string;
  let registry: PairedDeviceRegistry;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bridge-dev-"));
    registry = new PairedDeviceRegistry(path.join(dir, "paired-devices.json"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("a paired bridge device can mint a bridge-scoped ticket", () => {
    const { token } = registry.add("laptop-bridge");
    const store = new WsTicketStore();
    // The bearer authenticates the MINT (a REST call), never the socket.
    expect(registry.verify(token)).not.toBeNull();
    expect(store.consume(store.mint("bridge"), "bridge")).toBe(true);
  });

  it.skipIf(process.platform === "win32")("persists the device credential 0600", () => {
    registry.add("laptop-bridge");
    const file = path.join(dir, "paired-devices.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("stores only a hash — a leaked registry cannot be replayed", () => {
    const { token } = registry.add("laptop-bridge");
    const raw = fs.readFileSync(path.join(dir, "paired-devices.json"), "utf8");
    expect(raw).not.toContain(token);
  });

  // (task 6.6) Revocation is a row delete, so it must take effect on the very
  // next mint attempt — not on the next restart, and not after a TTL.
  it("a revoked device cannot obtain a ticket", () => {
    const { device, token } = registry.add("laptop-bridge");
    expect(registry.revoke(device.id)).toBe(true);
    expect(registry.verify(token)).toBeNull();
  });

  it("revocation survives a reload from disk", () => {
    const { device, token } = registry.add("laptop-bridge");
    registry.revoke(device.id);
    const reloaded = new PairedDeviceRegistry(path.join(dir, "paired-devices.json"));
    expect(reloaded.verify(token)).toBeNull();
  });
});
