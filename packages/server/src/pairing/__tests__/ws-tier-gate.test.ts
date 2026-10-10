/**
 * See change: add-passkey-user-auth (WS half of the session tier gate).
 */
import { describe, expect, it } from "vitest";
import { decideWsTier } from "../ws-tier-gate.js";

describe("decideWsTier", () => {
  it("leaves sockets without a session tier ungated", () => {
    expect(decideWsTier({}, "force_kill")).toEqual({ kind: "allow" });
  });
  it("observe socket: reads pass, prompts and kills are dropped", () => {
    const s = { sessionTier: () => "observe" as const };
    expect(decideWsTier(s, "subscribe").kind).toBe("allow");
    expect(decideWsTier(s, "send_prompt")).toEqual({ kind: "drop", required: "control", principalTier: "observe" });
    expect(decideWsTier(s, "force_kill").kind).toBe("drop");
  });
  it("control socket: prompts pass, terminals/kill dropped, unknown types fail closed", () => {
    const s = { sessionTier: () => "control" as const };
    expect(decideWsTier(s, "send_prompt").kind).toBe("allow");
    expect(decideWsTier(s, "create_terminal").kind).toBe("drop");
    expect(decideWsTier(s, "plugin_custom_thing").kind).toBe("drop");
  });
  it("operate socket passes everything", () => {
    expect(decideWsTier({ sessionTier: () => "operate" }, "force_kill").kind).toBe("allow");
  });
  it("a revoked session closes the socket", () => {
    expect(decideWsTier({ sessionTier: () => null }, "subscribe")).toEqual({ kind: "close" });
  });
  it("re-reads the tier per message (re-tier applies immediately)", () => {
    let tier: "observe" | "control" = "observe";
    const s = { sessionTier: () => tier };
    expect(decideWsTier(s, "send_prompt").kind).toBe("drop");
    tier = "control";
    expect(decideWsTier(s, "send_prompt").kind).toBe("allow");
  });
});
