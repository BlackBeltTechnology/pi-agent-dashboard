/**
 * A cookie session or a trusted-network host must NOT be able to mint a
 * bridge-scoped ticket (@review Audit, major; task 6.2).
 *
 * The bridge surface is more privileged than `/ws`: it registers sessions and
 * attributes events to them.
 *
 * See change: add-pi-gateway-transport-identity.
 */
import { describe, expect, it } from "vitest";
import { decideBridgeTicketMint } from "../auth/bridge-ticket-eligibility.js";

const base = {
  ip: "192.168.1.50",
  headers: {} as Record<string, unknown>,
  verifyDeviceBearer: (t: string) => t === "good-device-bearer",
};

describe("decideBridgeTicketMint", () => {
  it("allows a paired device presenting its durable bearer", () => {
    expect(
      decideBridgeTicketMint({ ...base, authorization: "Bearer good-device-bearer" }).allow,
    ).toBe(true);
  });

  it("allows a genuinely-local caller", () => {
    expect(decideBridgeTicketMint({ ...base, ip: "127.0.0.1" }).allow).toBe(true);
  });

  it("refuses a LAN host that merely passed the network guard", () => {
    expect(decideBridgeTicketMint(base).allow).toBe(false);
  });

  it("refuses a cookie-session browser (no bearer, not local)", () => {
    expect(decideBridgeTicketMint({ ...base, ip: "10.0.0.9" }).allow).toBe(false);
  });

  it("refuses an unknown or revoked bearer", () => {
    expect(
      decideBridgeTicketMint({ ...base, authorization: "Bearer revoked" }).allow,
    ).toBe(false);
  });

  it("refuses a relayed peer presenting as loopback", () => {
    expect(
      decideBridgeTicketMint({
        ...base,
        ip: "127.0.0.1",
        headers: { "x-forwarded-for": "203.0.113.9" },
      }).allow,
    ).toBe(false);
  });
});

/**
 * CodeQL js/polynomial-redos flagged `/^Bearer\s+(.+)$/i` here as polynomial on
 * attacker-supplied input. Honest note: the blowup could NOT be reproduced —
 * the parser trims first, which strips exactly the leading/trailing repetition
 * the query names, and no interior shape degraded either. The parser was made
 * linear by construction anyway (cheap, clearer, and it silences a blocking
 * high-severity alert), but this is defensive, not a proven exploit fix.
 *
 * So there is deliberately NO timing assertion here: a threshold the OLD code
 * already met would be a test that passes for the wrong reason. What is worth
 * pinning is that the rewrite still parses exactly what it used to.
 */
describe("the bearer parser accepts and rejects exactly what it used to", () => {
  it("parses the accepted shapes", () => {
    const seen: string[] = [];
    const capture = (auth: string) =>
      decideBridgeTicketMint({
        authorization: auth,
        verifyDeviceBearer: (t) => {
          seen.push(t);
          return true;
        },
        isGenuinelyLocal: false,
      }).allow;

    expect(capture("Bearer abc123")).toBe(true);
    expect(capture("bearer   abc123  ")).toBe(true);
    expect(capture("BEARER\tabc123")).toBe(true);
    expect(seen).toEqual(["abc123", "abc123", "abc123"]);
  });

  it("rejects the shapes that are not a bearer credential", () => {
    for (const bad of ["Bearer", "Bearer   ", "Basic abc123", "Bearerabc123", ""]) {
      expect(
        decideBridgeTicketMint({
          authorization: bad,
          verifyDeviceBearer: () => true,
          isGenuinelyLocal: false,
        }).allow,
      ).toBe(false);
    }
  });
});
