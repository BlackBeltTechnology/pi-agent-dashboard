/**
 * Bridge `agent_settled` normalization — pure decision logic.
 *
 * The bridge guarantees exactly ONE terminal `agent_settled` per run on every
 * supported pi: native (≥ 0.80.4) is forwarded as-is with no synth; floor pi
 * (< 0.80.4) gets a synthetic settle synchronously after each `agent_end`.
 *
 * See change: adopt-pi-074-080-features (A.1 — E1, E2, F8, X2).
 */
import { describe, expect, it } from "vitest";
import {
  NATIVE_AGENT_SETTLED_FLOOR,
  nativeAgentSettledSupported,
  settleFollowUp,
  synthesizeAgentSettledEvent,
} from "../agent-settled.js";

describe("nativeAgentSettledSupported", () => {
  it("E1: 0.80.4 (boundary floor) supports native settle", () => {
    expect(nativeAgentSettledSupported("0.80.4")).toBe(true);
    expect(NATIVE_AGENT_SETTLED_FLOOR).toBe("0.80.4");
  });

  it("E2: 0.80.3 (just below floor) does NOT support native settle", () => {
    expect(nativeAgentSettledSupported("0.80.3")).toBe(false);
  });

  it("F8: a modern pi (0.80.10) supports native settle", () => {
    expect(nativeAgentSettledSupported("0.80.10")).toBe(true);
  });

  it("older majors/minors defer to synth", () => {
    expect(nativeAgentSettledSupported("0.78.0")).toBe(false);
    expect(nativeAgentSettledSupported("0.79.10")).toBe(false);
  });

  it("newer versions support native settle", () => {
    expect(nativeAgentSettledSupported("0.81.0")).toBe(true);
    expect(nativeAgentSettledSupported("1.0.0")).toBe(true);
  });

  it("ignores pre-release / build suffixes", () => {
    expect(nativeAgentSettledSupported("0.80.4-rc.1")).toBe(true);
    expect(nativeAgentSettledSupported("0.80.3-beta")).toBe(false);
  });

  it("unknown / unparseable version is treated as floor (synthesize)", () => {
    expect(nativeAgentSettledSupported(undefined)).toBe(false);
    expect(nativeAgentSettledSupported("")).toBe(false);
  });
});

describe("settleFollowUp", () => {
  it("E1/F8: native pi never synthesizes after agent_end", () => {
    expect(settleFollowUp("agent_end", true, 100)).toBeNull();
  });

  it("E2: floor pi synthesizes exactly one settle after agent_end", () => {
    const synth = settleFollowUp("agent_end", false, 100);
    expect(synth).toEqual({ eventType: "agent_settled", timestamp: 100, data: {} });
  });

  it("F8/X2: a real agent_settled never produces a follow-up synth", () => {
    expect(settleFollowUp("agent_settled", true, 100)).toBeNull();
    expect(settleFollowUp("agent_settled", false, 100)).toBeNull();
  });

  it("other events never synthesize", () => {
    expect(settleFollowUp("agent_start", false, 100)).toBeNull();
    expect(settleFollowUp("turn_end", false, 100)).toBeNull();
  });
});

describe("synthesizeAgentSettledEvent", () => {
  it("carries no payload (agent_settled has no data)", () => {
    expect(synthesizeAgentSettledEvent(42)).toEqual({
      eventType: "agent_settled",
      timestamp: 42,
      data: {},
    });
  });
});
