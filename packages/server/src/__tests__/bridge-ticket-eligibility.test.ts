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
import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { decideBridgeTicketMint, formatBridgeTicketRefusalLine } from "../auth/bridge-ticket-eligibility.js";

const base = {
  ip: "192.168.1.50",
  headers: {} as Record<string, unknown>,
  verifyDeviceBearer: (t: string): { id: string; tier: Tier } | null => (t === "good-device-bearer" ? { id: "device-7", tier: "operate" as const } : null),
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
  // `base` is a NON-local LAN caller, so `allow` can only come from the bearer
  // path — which makes this a clean probe of the parser itself.
  it("parses the accepted shapes", () => {
    const seen: string[] = [];
    const capture = (authorization: string) =>
      decideBridgeTicketMint({
        ...base,
        authorization,
        verifyDeviceBearer: (t: string) => {
          seen.push(t);
          return { id: "device-7", tier: "operate" as const };
        },
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
          ...base,
          authorization: bad,
          verifyDeviceBearer: () => ({ id: "device-7", tier: "operate" as const }),
        }).allow,
      ).toBe(false);
    }
  });
});

/**
 * The minted ticket must carry WHICH device minted it: a session registered
 * over that ticket is otherwise unattributable, and the origin gate then
 * cannot tell a remote session from a local one (#E15).
 */
it("names the paired device that authenticated, so the ticket is attributable", () => {
  const verdict = decideBridgeTicketMint({ ...base, authorization: "Bearer good-device-bearer" });
  expect(verdict.allow).toBe(true);
  expect(verdict.deviceId).toBe("device-7");
});

it("does not attribute a genuinely-local caller to any device", () => {
  const verdict = decideBridgeTicketMint({ ...base, ip: "127.0.0.1", authorization: undefined });
  expect(verdict.allow).toBe(true);
  expect(verdict.deviceId).toBeUndefined();
});

/**
 * D2: the mint enforces `operate` itself. The `/api/ws-ticket` route is `operate`, but its tier
 * gate is exempt for a `legacy`-mode trusted-network peer, so the decider cannot rely on it.
 * See change: harden-bridge-session-claim.
 */
describe("bridge-ticket mint requires the operate tier (D2)", () => {
  const withTier = (tier: Tier) => ({
    ...base,
    authorization: "Bearer any",
    verifyDeviceBearer: () => ({ id: "device-9abcdef012", tier }),
  });

  it("allows an operate bearer as a device", () => {
    const v = decideBridgeTicketMint(withTier("operate"));
    expect(v).toMatchObject({ allow: true, deviceId: "device-9abcdef012" });
    expect(v.belowOperate).toBeUndefined();
  });

  it.each(["observe", "control"] as const)("refuses a %s bearer from a non-local caller, naming the tier rule", (tier) => {
    const v = decideBridgeTicketMint(withTier(tier));
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/operate/);
    expect(v.belowOperate).toEqual({ tier, deviceId: "device-9abcdef012" });
  });

  it("a below-operate bearer from a genuinely-local caller mints a DEVICELESS local ticket", () => {
    const v = decideBridgeTicketMint({ ...withTier("observe"), ip: "127.0.0.1" });
    expect(v.allow).toBe(true);
    expect(v.deviceId).toBeUndefined();
  });

  it("an unknown bearer reports no tier (nothing to audit)", () => {
    const v = decideBridgeTicketMint({ ...base, authorization: "Bearer nope" });
    expect(v.allow).toBe(false);
    expect(v.belowOperate).toBeUndefined();
  });

  it("the refusal line carries tier + prefix only, no full id", () => {
    expect(formatBridgeTicketRefusalLine("observe", "device-9")).toBe("[auth] bridge ticket refused: tier=observe device=device-9");
  });
});
