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
