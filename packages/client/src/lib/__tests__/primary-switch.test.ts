/**
 * Primary designation (D10 / task 7.8) — folded from the shipped
 * "Designating the primary is an explicit, confirmed action" scenarios.
 *
 * The interesting assertions are the NEGATIVE ones: the action must be absent
 * on the current primary and on every non-connected state, and the patch must
 * not carry anything beyond `tunnel.provider` — a switch that also blanked
 * `tunnel.<id>.mode` would disable the provider it just promoted.
 */
import { describe, expect, it } from "vitest";
import {
  buildPrimarySwitchPatch,
  canMakePrimary,
  primarySwitchConsequence,
} from "../gateway/primary-switch.js";

describe("eligibility", () => {
  it("offers the action on a connected non-primary", () => {
    expect(canMakePrimary({ state: "connected", isPrimary: false })).toBe(true);
  });

  it("does NOT offer it on the current primary", () => {
    expect(canMakePrimary({ state: "connected", isPrimary: true })).toBe(false);
  });

  it.each(["not-installed", "not-set", "disconnected"] as const)(
    "does NOT offer it on a %s provider",
    (state) => {
      expect(canMakePrimary({ state, isPrimary: false })).toBe(false);
    },
  );
});

describe("the consequence is stated, not merely confirmed", () => {
  const copy = primarySwitchConsequence("tailscale", "zrok");

  it("names the redirect URI", () => {
    expect(copy).toMatch(/redirect URI/i);
  });

  it("names the sign-in breakage", () => {
    expect(copy).toMatch(/reject sign-in/i);
  });

  it("names both the outgoing and the incoming provider", () => {
    expect(copy).toContain("zrok");
    expect(copy).toContain("tailscale");
  });

  it("still names the consequence when there is no current primary", () => {
    const none = primarySwitchConsequence("tailscale");
    expect(none).toMatch(/redirect URI/i);
    expect(none).not.toContain("from undefined");
  });
});

describe("the patch", () => {
  it("writes only the primary", () => {
    expect(buildPrimarySwitchPatch("tailscale")).toEqual({ tunnel: { provider: "tailscale" } });
  });

  it("does not carry a mode key — a deep merge must leave per-provider config alone", () => {
    const patch = buildPrimarySwitchPatch("tailscale").tunnel as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["provider"]);
  });
});
