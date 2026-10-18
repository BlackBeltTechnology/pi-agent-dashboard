import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COOKIE_NAME, signToken } from "../auth/auth.js";
import { authorizeWsUpgrade, validateWsUpgrade } from "../auth/auth-plugin.js";
import { networkOnlySnapshot } from "../auth/network-trust-telemetry.js";
import { admissionTrustedNetworks } from "../auth/trust-mode.js";
import type { CoreWsRouteScope, TicketConsumption } from "../auth/ws-ticket.js";
import { WsTicketStore } from "../auth/ws-ticket.js";
import { type TrustModeHome, useTrustModeHome } from "../test-support/trust-mode-home.js";

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

// ── retire-trusted-networks-bypass: WS admission reads the live list ─────────
// The server passes `admissionTrustedNetworks()` PER UPGRADE (server.ts); these
// tests do the same against a real temp-HOME config.json. A network match
// authenticates only in `legacy`, and only AFTER ticket / cookie.
describe("WS upgrade — live mode-dependent admission list (E9, E10, E11, E12)", () => {
  const LISTED = "192.168.16.20";
  const LIST = ["192.168.16.0/24"];
  let th: TrustModeHome;
  beforeEach(() => {
    th = useTrustModeHome();
  });
  afterEach(() => {
    th.restore();
  });

  /** Mirrors the server's per-upgrade call: the list is read at the call site. */
  const authorize = (over: Partial<Parameters<typeof authorizeWsUpgrade>[0]> = {}) =>
    authorizeWsUpgrade({
      remoteAddress: LISTED,
      secret: null,
      trustedNetworks: admissionTrustedNetworks(),
      headers: {},
      scope: "browser",
      ...over,
    });

  // test-plan #E9 — WS (auth on → 401 at the caller) and WS (auth off → 403)
  describe.each([
    ["auth on (cookie realm)", SECRET],
    ["auth off", null],
  ] as const)("E9: %s", (_label, secret) => {
    it("pair: ticketless listed peer is rejected", () => {
      th.setTrustConfig({ trustMode: "pair", trustedNetworks: LIST });
      expect(authorize({ secret }).ok).toBe(false);
    });
    it("legacy: ticketless listed peer is admitted and counted as network-only", () => {
      th.setTrustConfig({ trustMode: "legacy", trustedNetworks: LIST });
      expect(authorize({ secret }).ok).toBe(true);
      expect(networkOnlySnapshot().admissions).toBe(1);
    });
  });

  it("E9: validateWsUpgrade (auth on) — pair rejects, legacy admits the listed peer", () => {
    th.setTrustConfig({ trustMode: "pair", trustedNetworks: LIST });
    expect(validateWsUpgrade(undefined, LISTED, SECRET, admissionTrustedNetworks(), { headers: {} })).toBe(false);
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: LIST });
    expect(validateWsUpgrade(undefined, LISTED, SECRET, admissionTrustedNetworks(), { headers: {} })).toBe(true);
  });

  // test-plan #E10 — live change, no restart
  it("E10: legacy → pair → legacy → pair is applied to the NEXT ticketless upgrade", () => {
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: LIST });
    expect(authorize().ok).toBe(true);
    th.setTrustConfig({ trustMode: "pair", trustedNetworks: LIST });
    expect(authorize().ok).toBe(false);
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: LIST });
    expect(authorize().ok).toBe(true);
    th.setTrustConfig({ trustMode: "pair", trustedNetworks: LIST });
    expect(authorize().ok).toBe(false);
  });

  // test-plan #E11 — ticket / cookie first, so credentialed upgrades are never network-only
  it("E11: legacy + listed peer with a ticket → admitted, ticket CONSUMED, not counted network-only", () => {
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: LIST });
    const store = new WsTicketStore();
    const ticket = store.mint("browser");
    const consume = (t: string, sc: CoreWsRouteScope) => store.consumeDetailed(t, sc);

    expect(authorize({ ticket, consumeTicket: consume }).ok).toBe(true);
    expect(networkOnlySnapshot().admissions, "ticket first → not network-only").toBe(0);
    // Single-use: the ticket is gone, so a replay falls through to the network match.
    expect(store.consumeDetailed(ticket, "browser").ok).toBe(false);
  });

  it("E11: a ticketed upgrade from a listed peer is admitted in pair mode too (ticket is the credential)", () => {
    th.setTrustConfig({ trustMode: "pair", trustedNetworks: LIST });
    const store = new WsTicketStore();
    const ticket = store.mint("browser");
    expect(authorize({ ticket, consumeTicket: (t, sc) => store.consumeDetailed(t, sc) }).ok).toBe(true);
    expect(store.consumeDetailed(ticket, "browser").ok).toBe(false);
  });

  it("E11: valid session cookie from a listed peer → session surfaced, not network-only", () => {
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: LIST });
    const token = signToken({ sub: "u@example.com", name: "U", username: "u", provider: "github" }, SECRET);
    const res = authorize({ secret: SECRET, cookieHeader: `${COOKIE_NAME}=${token}` });
    expect(res.ok).toBe(true);
    expect(res.ok && res.session?.sub).toBe("u@example.com");
    expect(networkOnlySnapshot().admissions).toBe(0);
    // validateWsUpgrade orders the same way.
    expect(validateWsUpgrade(`${COOKIE_NAME}=${token}`, LISTED, SECRET, admissionTrustedNetworks(), { headers: {} })).toBe(true);
    expect(networkOnlySnapshot().admissions).toBe(0);
  });

  it("E11: an invalid cookie from a listed peer falls through to the network match in legacy, rejected in pair", () => {
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: LIST });
    expect(authorize({ secret: SECRET, cookieHeader: `${COOKIE_NAME}=nope` }).ok).toBe(true);
    th.setTrustConfig({ trustMode: "pair", trustedNetworks: LIST });
    expect(authorize({ secret: SECRET, cookieHeader: `${COOKIE_NAME}=nope` }).ok).toBe(false);
  });

  // test-plan #E12 — relayed loopback never admitted by a loopback range, either mode
  describe.each(["pair", "legacy"] as const)("E12 (%s): relayed loopback", (mode) => {
    const relayed = { "x-forwarded-for": "203.0.113.9" };
    it("127.0.0.0/8 listed, peer 127.0.0.1 + X-Forwarded-For → rejected (auth on and off)", () => {
      th.setTrustConfig({ trustMode: mode, trustedNetworks: ["127.0.0.0/8"] });
      for (const secret of [SECRET, null]) {
        expect(authorize({ remoteAddress: "127.0.0.1", headers: relayed, secret }).ok).toBe(false);
        expect(validateWsUpgrade(undefined, "127.0.0.1", secret ?? SECRET, admissionTrustedNetworks(), { headers: relayed })).toBe(false);
      }
    });
    it("control: the same list admits a header-less genuine local upgrade", () => {
      th.setTrustConfig({ trustMode: mode, trustedNetworks: ["127.0.0.0/8"] });
      expect(authorize({ remoteAddress: "127.0.0.1", headers: {} }).ok).toBe(true);
    });
  });
});
