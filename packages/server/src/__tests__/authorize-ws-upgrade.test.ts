import { describe, expect, it } from "vitest";
import { authorizeWsUpgrade } from "../auth/auth-plugin.js";
import type { CoreWsRouteScope, TicketConsumption } from "../auth/ws-ticket.js";

const SECRET = "s".repeat(32);
const principal = { iss: "https://kc/realms/app", sub: "user-1" };

/** A one-shot detailed-consume stub that returns `outcome` for a matching ticket. */
function consumer(match: string, outcome: TicketConsumption) {
  return (t: string, _s: CoreWsRouteScope): TicketConsumption =>
    t === match ? outcome : { ok: false, reason: "unknown" };
}

describe("authorizeWsUpgrade — identity-ticket-only mode (§9.2)", () => {
  const base = { remoteAddress: "127.0.0.1", scope: "browser" as const, secret: SECRET };

  it("accepts a principal-bearing ticket and surfaces the principal (§9.3)", () => {
    const res = authorizeWsUpgrade({
      ...base,
      ticket: "good",
      requireIdentityTicket: true,
      consumeTicket: consumer("good", { ok: true, principal, principalExpiresAt: 9000 }),
    });
    expect(res).toEqual({ ok: true, principal, principalExpiresAt: 9000 });
  });

  it("refuses genuine-local when an identity ticket is required", () => {
    const res = authorizeWsUpgrade({
      ...base,
      headers: {},
      requireIdentityTicket: true,
      consumeTicket: consumer("x", { ok: false, reason: "missing" }),
    });
    expect(res.ok).toBe(false);
  });

  it("refuses a cookie session when an identity ticket is required", () => {
    const res = authorizeWsUpgrade({
      ...base,
      remoteAddress: "1.2.3.4",
      cookieHeader: "irrelevant",
      requireIdentityTicket: true,
      consumeTicket: consumer("x", { ok: false, reason: "missing" }),
    });
    expect(res.ok).toBe(false);
  });

  it("refuses a valid-but-principal-less ticket when identity is required", () => {
    const res = authorizeWsUpgrade({
      ...base,
      remoteAddress: "1.2.3.4",
      ticket: "anon",
      requireIdentityTicket: true,
      consumeTicket: consumer("anon", { ok: true }),
    });
    expect(res.ok).toBe(false);
  });

  it("refuses when no ticket is presented", () => {
    const res = authorizeWsUpgrade({
      ...base,
      remoteAddress: "1.2.3.4",
      requireIdentityTicket: true,
      consumeTicket: consumer("x", { ok: false, reason: "missing" }),
    });
    expect(res.ok).toBe(false);
  });
});

describe("authorizeWsUpgrade — legacy allowances unchanged (inert / non-browser)", () => {
  it("genuine-local is allowed without a ticket", () => {
    expect(authorizeWsUpgrade({ remoteAddress: "127.0.0.1", secret: SECRET, headers: {} }).ok).toBe(true);
  });

  it("a ticket principal is still surfaced in non-identity mode", () => {
    const res = authorizeWsUpgrade({
      remoteAddress: "1.2.3.4",
      scope: "browser",
      secret: SECRET,
      ticket: "good",
      consumeTicket: consumer("good", { ok: true, principal, principalExpiresAt: 5 }),
    });
    expect(res).toEqual({ ok: true, principal, principalExpiresAt: 5 });
  });

  it("no-auth mode (secret null) allows a valid ticket, refuses a bad cookie", () => {
    const okRes = authorizeWsUpgrade({
      remoteAddress: "1.2.3.4",
      scope: "browser",
      secret: null,
      ticket: "good",
      consumeTicket: consumer("good", { ok: true }),
    });
    expect(okRes.ok).toBe(true);
    const badRes = authorizeWsUpgrade({
      remoteAddress: "1.2.3.4",
      scope: "browser",
      secret: null,
      cookieHeader: "whatever",
      consumeTicket: consumer("x", { ok: false, reason: "missing" }),
    });
    expect(badRes.ok).toBe(false);
  });
});

// Merge port of fix-trusted-network-tunnel-bypass (#751): the trusted-network
// allowance inside authorizeWsUpgrade goes through isTrustedSource, so a tunnel
// relaying as loopback is never admitted by a trusted-network entry.
describe("authorizeWsUpgrade — trusted-network tunnel bypass (fix-trusted-network-tunnel-bypass)", () => {
  const relayed = { "x-forwarded-for": "203.0.113.9" };
  const covering = ["127.0.0.0/8", "0.0.0.0/0"];

  for (const secret of [SECRET, null]) {
    const mode = secret ? "cookie realm" : "no-auth";

    it(`${mode}: relayed loopback is refused even when the trusted list covers loopback`, () => {
      const res = authorizeWsUpgrade({ remoteAddress: "127.0.0.1", secret, trustedNetworks: covering, headers: relayed, scope: "browser" });
      expect(res.ok).toBe(false);
    });

    it(`${mode}: relayed IPv4-mapped loopback is refused`, () => {
      const res = authorizeWsUpgrade({ remoteAddress: "::ffff:127.0.0.1", secret, trustedNetworks: covering, headers: { "x-forwarded-host": "t.example" }, scope: "browser" });
      expect(res.ok).toBe(false);
    });

    it(`${mode}: a genuine LAN peer inside a trusted network is still admitted`, () => {
      const res = authorizeWsUpgrade({ remoteAddress: "192.168.1.20", secret, trustedNetworks: ["192.168.1.0/24"], headers: {}, scope: "browser" });
      expect(res.ok).toBe(true);
    });

    it(`${mode}: a peer outside the trusted network is refused`, () => {
      const res = authorizeWsUpgrade({ remoteAddress: "10.0.0.5", secret, trustedNetworks: ["192.168.1.0/24"], headers: {}, scope: "browser" });
      expect(res.ok).toBe(false);
    });

    it(`${mode}: relayed loopback with a valid ticket is still admitted via the ticket`, () => {
      const res = authorizeWsUpgrade({
        remoteAddress: "127.0.0.1", secret, trustedNetworks: covering, headers: relayed, scope: "browser",
        ticket: "good", consumeTicket: consumer("good", { ok: true }),
      });
      expect(res.ok).toBe(true);
    });
  }

  it("identity mode: a trusted-network peer without an identity ticket is refused", () => {
    const res = authorizeWsUpgrade({
      remoteAddress: "192.168.1.20", secret: SECRET, trustedNetworks: ["192.168.1.0/24"], headers: {}, scope: "browser",
      requireIdentityTicket: true, consumeTicket: consumer("x", { ok: false, reason: "missing" }),
    });
    expect(res.ok).toBe(false);
  });
});
