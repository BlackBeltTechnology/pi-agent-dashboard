/**
 * E8/E9 (test-plan expand-mcp-tiered-surface) — tier resolution at the auth
 * boundary. See change: expand-mcp-tiered-surface (D1).
 */
import { describe, expect, it } from "vitest";
import { authenticate } from "../auth.js";
import { McpTokenRegistry } from "../tokens.js";

const noTokens = { resolve: () => null };

describe("E8 — a device bearer resolves its registry tier", () => {
  it("uses the tier-aware verifier when the host provides it", () => {
    const caller = authenticate("Bearer tok", {
      tokens: noTokens,
      verifyDeviceToken: () => "ignored",
      verifyDeviceTokenTier: (t) => (t === "tok" ? { id: "dev1", tier: "control" } : null),
    });
    expect(caller).toEqual({ kind: "device", deviceId: "dev1", tier: "control" });
  });

  it("falls back to the id-only verifier with operate (old host)", () => {
    const caller = authenticate("Bearer tok", {
      tokens: noTokens,
      verifyDeviceToken: (t) => (t === "tok" ? "dev1" : null),
    });
    expect(caller).toEqual({ kind: "device", deviceId: "dev1", tier: "operate" });
  });

  it("prefers the tier-aware verifier when both are present", () => {
    const caller = authenticate("Bearer tok", {
      tokens: noTokens,
      verifyDeviceToken: () => "old-id",
      verifyDeviceTokenTier: () => ({ id: "new-id", tier: "observe" }),
    });
    expect(caller).toEqual({ kind: "device", deviceId: "new-id", tier: "observe" });
  });

  it("an unknown bearer resolves to null", () => {
    expect(
      authenticate("Bearer nope", {
        tokens: noTokens,
        verifyDeviceToken: () => null,
        verifyDeviceTokenTier: () => null,
      }),
    ).toBeNull();
  });
});

describe("E9 — a bridge-minted session token resolves to control", () => {
  it("resolves kind session with tier control", () => {
    const reg = new McpTokenRegistry();
    const token = reg.mintForSession("S1");
    const caller = authenticate(`Bearer ${token}`, {
      tokens: reg,
      verifyDeviceToken: () => null,
    });
    expect(caller).toEqual({ kind: "session", sessionId: "S1", tier: "control" });
  });
});
