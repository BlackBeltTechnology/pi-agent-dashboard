/**
 * Trust-posture read model. See change: retire-trusted-networks-bypass.
 */
import { describe, expect, it } from "vitest";
import { displayTrustMode, parseTrustPosture, resolveClientTrustMode } from "../trust-posture.js";

const posture = (over: Record<string, unknown> = {}) => ({
  trustedHasLoopback: false,
  trustMode: "legacy",
  trustModeOrigin: "upgrade",
  networkOnly: { admissions: 9, distinctPeers: 3, lastAt: 5 },
  ...over,
});

describe("parseTrustPosture", () => {
  it("reads a disclosed posture", () => {
    expect(parseTrustPosture({ trustPosture: posture() })).toEqual({
      trustedHasLoopback: false,
      trustMode: "legacy",
      trustModeOrigin: "upgrade",
      networkOnly: { admissions: 9, distinctPeers: 3, lastAt: 5 },
    });
  });

  it.each([[null], [undefined], [{}], [{ trustPosture: null }], [{ trustPosture: "x" }], [{ trustPosture: posture({ trustMode: "open" }) }]])(
    "undisclosed or malformed ⇒ null (%j)",
    (h) => expect(parseTrustPosture(h)).toBeNull(),
  );

  it("clamps junk counters and an unknown origin", () => {
    const p = parseTrustPosture({ trustPosture: posture({ trustModeOrigin: "x", networkOnly: { admissions: -1, distinctPeers: "3" } }) });
    expect(p?.trustModeOrigin).toBeNull();
    expect(p?.networkOnly).toEqual({ admissions: 0, distinctPeers: 0, lastAt: null });
  });
});

describe("resolveClientTrustMode / displayTrustMode", () => {
  it("mirrors the shared resolver", () => {
    expect(resolveClientTrustMode({})).toEqual({ mode: null, origin: null, unrecognised: null });
    expect(resolveClientTrustMode({ network: { trustMode: "legacy", trustModeOrigin: "upgrade" } })).toEqual({ mode: "legacy", origin: "upgrade", unrecognised: null });
    expect(resolveClientTrustMode({ network: { trustMode: "pair" } }).origin).toBe("operator");
    expect(resolveClientTrustMode({ network: { trustMode: "open" } })).toEqual({ mode: "pair", origin: null, unrecognised: "open" });
  });

  it("stored value wins, then the server's report, then legacy", () => {
    const pair = parseTrustPosture({ trustPosture: posture({ trustMode: "pair" }) });
    expect(displayTrustMode({ network: { trustMode: "legacy" } }, pair)).toBe("legacy");
    expect(displayTrustMode({}, pair)).toBe("pair");
    expect(displayTrustMode({}, null)).toBe("legacy");
  });
});
