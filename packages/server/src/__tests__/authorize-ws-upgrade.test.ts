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
