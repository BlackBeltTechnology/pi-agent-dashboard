/**
 * See change: add-passkey-user-auth (passkey-user-auth › Primary switch warns
 * about orphaned passkeys, › Passkeys gated on a stable origin).
 */
import { describe, expect, it } from "vitest";
import { impactConsequence, unstableReasonText } from "../users-text.js";

describe("impactConsequence", () => {
  it("states passkey and user counts", () => {
    const s = impactConsequence({ currentRpId: "a", nextRpId: "b", orphaned: 3, users: 2 });
    expect(s).toContain("3 passkey");
    expect(s).toContain("2 user");
  });
  it("is null when nothing would be orphaned", () => {
    expect(impactConsequence({ currentRpId: "a", nextRpId: "a", orphaned: 0, users: 0 })).toBeNull();
    expect(impactConsequence(null)).toBeNull();
  });
});

describe("unstableReasonText", () => {
  it("explains each reason", () => {
    expect(unstableReasonText("ephemeral_tunnel")).toMatch(/ephemeral/);
    expect(unstableReasonText("ip_or_localhost")).toMatch(/domain name/);
    expect(unstableReasonText(undefined)).toMatch(/unavailable/);
  });
});
