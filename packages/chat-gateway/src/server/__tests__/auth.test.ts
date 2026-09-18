import { describe, expect, it } from "vitest";

import { authorize, createPairing } from "../auth.js";

const config = { allowlist: ["u-talker", "u-admin"], admins: ["u-admin", "u-ghost"], groupChannels: ["c-open"] };

describe("authorize (E12 decision table)", () => {
  it("E12: an allowlisted user may talk in a DM", () => {
    expect(
      authorize({ config, userId: "u-talker", action: "talk", channelId: "dm", isDM: true }),
    ).toEqual({ allowed: true, reason: "authorized" });
  });

  it("X10: a not-allowlisted user's talk produces no grant", () => {
    expect(
      authorize({ config, userId: "u-stranger", action: "talk", channelId: "dm", isDM: true }),
    ).toEqual({ allowed: false, reason: "not_allowlisted" });
  });

  it("E12: an allowlisted admin may bind", () => {
    expect(
      authorize({ config, userId: "u-admin", action: "bind", channelId: "dm", isDM: true }),
    ).toEqual({ allowed: true, reason: "authorized" });
  });

  it("E12: an allowlisted non-admin may NOT bind", () => {
    expect(
      authorize({ config, userId: "u-talker", action: "bind", channelId: "dm", isDM: true }),
    ).toEqual({ allowed: false, reason: "not_admin" });
  });

  it("E12: admin WITHOUT allowlist is refused for bind (bind is narrower than talk)", () => {
    expect(
      authorize({ config, userId: "u-ghost", action: "bind", channelId: "dm", isDM: true }),
    ).toEqual({ allowed: false, reason: "not_allowlisted" });
  });

  it("E12: admin alone is not sufficient to talk", () => {
    expect(
      authorize({ config, userId: "u-ghost", action: "talk", channelId: "dm", isDM: true }),
    ).toEqual({ allowed: false, reason: "not_allowlisted" });
  });

  it("E12/L4: a non-opted-in guild channel is inert even for an admin", () => {
    expect(
      authorize({ config, userId: "u-admin", action: "talk", channelId: "c-random", isDM: false }),
    ).toEqual({ allowed: false, reason: "group_channel_not_opted_in" });
  });

  it("E12/L4: an opted-in guild channel passes the group gate", () => {
    expect(
      authorize({ config, userId: "u-talker", action: "talk", channelId: "c-open", isDM: false }),
    ).toEqual({ allowed: true, reason: "authorized" });
  });

  it("E12: an empty userId is refused as ambiguous_identity", () => {
    expect(
      authorize({ config, userId: "", action: "talk", channelId: "dm", isDM: true }),
    ).toEqual({ allowed: false, reason: "ambiguous_identity" });
  });
});

describe("createPairing (E13)", () => {
  it("defaults to a 15-minute TTL and 10-attempt lockout", () => {
    const now = 1_000;
    const p = createPairing({ now: () => now });
    expect(p.state().expiresAt).toBe(1_000 + 15 * 60_000);
    expect(p.state()).toMatchObject({ attempts: 0, locked: false });
    expect(p.currentCode()).toMatch(/^\d{6}$/);
  });

  it("accepts the correct code and consumes it", () => {
    const now = 0;
    const p = createPairing({ now: () => now });
    const code = p.currentCode();
    expect(p.attempt(code)).toBe(true);
    expect(p.currentCode()).toBe("");
    expect(p.attempt(code)).toBe(false); // already consumed
  });

  it("E13: an attempt at 15m01s is refused AND invalidates the code", () => {
    let now = 0;
    const p = createPairing({ now: () => now });
    const code = p.currentCode();
    now = 15 * 60_000 + 1_000;
    expect(p.attempt(code)).toBe(false);
    expect(p.currentCode()).toBe("");
    now = 0; // even if the clock went back, the code is gone
    expect(p.attempt(code)).toBe(false);
  });

  it("E13: the 11th wrong attempt locks the pairing permanently", () => {
    const now = 0;
    const p = createPairing({ now: () => now });
    const code = p.currentCode();
    for (let i = 1; i <= 10; i += 1) {
      expect(p.attempt("000000-wrong")).toBe(false);
      expect(p.state().locked).toBe(false);
      expect(p.state().attempts).toBe(i);
    }
    expect(p.attempt("000000-wrong")).toBe(false); // 11th
    expect(p.state().locked).toBe(true);
    // a locked pairing never accepts a code, not even the right one
    expect(p.attempt(code)).toBe(false);
  });

  it("honours custom ttlMs / maxAttempts", () => {
    const now = 0;
    const p = createPairing({ now: () => now, ttlMs: 1_000, maxAttempts: 1 });
    expect(p.attempt("nope")).toBe(false);
    expect(p.state().locked).toBe(false);
    expect(p.attempt("nope")).toBe(false);
    expect(p.state().locked).toBe(true);
  });
});
