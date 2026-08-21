/**
 * Endpoint precedence (D3) and stickiness (D4).
 *
 * These are the decision tables the hijack class dies on: an explicitly
 * configured endpoint may never be replaced by something the network offered,
 * and a bridge already registered with one instance may not drift to another.
 *
 * (test-plan #E7, #E8, #E9, #E12)
 * See change: add-pi-gateway-transport-identity.
 */
import { describe, expect, it } from "vitest";
import {
  decideRetarget,
  type EndpointInputs,
  type EndpointSource,
  resolveEndpoint,
} from "../endpoint-resolution.js";

const RECORD = { endpoint: "ws+unix:///home/u/.pi/dashboard/gateway-9999.sock:/", instanceId: "rec-1" };
const ALL: EndpointInputs = {
  socketEnv: "/explicit/gateway.sock",
  urlEnv: "ws://explicit-host:9999",
  pinnedInstance: { endpoint: "ws://pinned:9999", instanceId: "pin-1" },
  record: RECORD,
  pairedRemote: { endpoint: "wss://remote.example:443", instanceId: "remote-1" },
  discovered: { endpoint: "ws://mdns-host:9999", instanceId: "mdns-1" },
};

/** Drop the highest-precedence sources one at a time, highest first. */
const LADDER: Array<[keyof EndpointInputs, EndpointSource, boolean]> = [
  ["socketEnv", "PI_DASHBOARD_SOCKET", true],
  ["urlEnv", "PI_DASHBOARD_URL", true],
  ["pinnedInstance", "pinned-instance", true],
  ["record", "rendezvous-record", false],
  ["pairedRemote", "paired-remote", false],
];

describe("resolveEndpoint — precedence ladder (D3)", () => {
  // (test-plan #E7) One row per reachable combination: the highest-precedence
  // PRESENT source wins, and mDNS wins none of them.
  it.each(LADDER.map(([, source], i) => [i, source] as const))(
    "row %i: %s wins when every higher source is absent",
    (i, expectedSource) => {
      const inputs: EndpointInputs = { ...ALL };
      for (let higher = 0; higher < i; higher++) {
        delete inputs[LADDER[higher][0]];
      }
      const res = resolveEndpoint(inputs);
      expect(res.available).toBe(true);
      if (!res.available) throw new Error("unreachable");
      expect(res.source).toBe(expectedSource);
      expect(res.pinned).toBe(LADDER[i][2]);
    },
  );

  it("PI_DASHBOARD_SOCKET wins with every other source also present", () => {
    const res = resolveEndpoint(ALL);
    expect(res.available && res.source).toBe("PI_DASHBOARD_SOCKET");
    expect(res.available && res.url).toBe("ws+unix:///explicit/gateway.sock:/");
  });

  it("mDNS never wins a row, even as the only remaining candidate", () => {
    const res = resolveEndpoint({ discovered: ALL.discovered });
    expect(res.available).toBe(false);
  });

  // (test-plan #E8) A discovered candidate may SUGGEST, never override.
  it("a reachable mDNS candidate does not override a pinned URL", () => {
    const res = resolveEndpoint({ urlEnv: ALL.urlEnv, discovered: ALL.discovered });
    expect(res.available).toBe(true);
    if (!res.available) throw new Error("unreachable");
    expect(res.url).toBe("ws://explicit-host:9999");
    expect(res.pinned).toBe(true);
    expect(res.suggestion?.endpoint).toBe("ws://mdns-host:9999");
  });

  // (test-plan #E9) Absence of a record means "no local dashboard", NOT
  // "go ask the network" — that substitution is the hijack.
  it("an absent record reports unavailable and substitutes no discovered candidate", () => {
    const res = resolveEndpoint({ discovered: ALL.discovered });
    expect(res.available).toBe(false);
    if (res.available) throw new Error("unreachable");
    expect(res.reason).toMatch(/no local dashboard available/i);
    // The candidate is reported as a suggestion, but nothing was selected:
    // there is no `url` to dial, so no substitution can have happened.
    expect(res).not.toHaveProperty("url");
    expect(res.suggestion?.endpoint).toBe("ws://mdns-host:9999");
  });

  it("blank env values are treated as unset, not as an endpoint", () => {
    const res = resolveEndpoint({ socketEnv: "   ", urlEnv: "  ", record: RECORD });
    expect(res.available && res.source).toBe("rendezvous-record");
  });
});

describe("decideRetarget — stickiness (D4)", () => {
  const current = { endpoint: "ws://X:9999", instanceId: "X" };
  const candidate = { endpoint: "ws://Y:9999", instanceId: "Y" };

  // (test-plan #E12) Re-target requires ALL of: unpinned, failed, verified.
  const rows: Array<[boolean, boolean, boolean, boolean]> = [];
  for (const pinned of [true, false]) {
    for (const failed of [true, false]) {
      for (const verified of [true, false]) {
        rows.push([pinned, failed, verified, !pinned && failed && verified]);
      }
    }
  }

  it.each(rows)(
    "pinned=%s failed=%s identityVerified=%s → retarget=%s",
    (pinned, failed, identityVerified, expected) => {
      const d = decideRetarget({ current, candidate, pinned, failed, identityVerified });
      expect(d.retarget).toBe(expected);
      // Every refusal is explained and names BOTH endpoints (task 3.3 / 10.2).
      if (!expected) {
        expect(d.reason).toContain("ws://X:9999");
        expect(d.reason).toContain("ws://Y:9999");
      }
    },
  );

  it("keeps the current endpoint when the candidate is the same instance", () => {
    const d = decideRetarget({
      current,
      candidate: { endpoint: "ws://X-moved:9999", instanceId: "X" },
      pinned: false,
      failed: true,
      identityVerified: true,
    });
    // Same instance reachable at a new address is a re-address, not a drift.
    expect(d.retarget).toBe(true);
    expect(d.reason).toMatch(/same instance/i);
  });
});
