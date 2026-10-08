/**
 * F1: PairLanding navigates only AFTER the device-cookie exchange resolves.
 * See change: harden-trust-and-credential-boundaries (D5).
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const challengeIdentity = vi.fn();
const postJson = vi.fn();
vi.mock("../../lib/pairing/pair-protocol.js", () => ({
  challengeIdentity: (...a: any[]) => challengeIdentity(...a),
  postJson: (...a: any[]) => postJson(...a),
}));

let release: () => void = () => {};
const finishDevicePairing = vi.fn(
  () => new Promise<void>((r) => { release = r; }),
);
vi.mock("../../lib/pairing/device-auth.js", () => ({
  finishDevicePairing: (...a: any[]) => (finishDevicePairing as any)(...a),
}));

import { encodePayloadString } from "../../lib/pairing/pairing-qr.js";
import { PairLanding } from "../connectivity/PairLanding.js";

describe("PairLanding exchange ordering (F1)", () => {
  const original = window.location;
  let hrefSets: string[];
  beforeEach(() => {
    hrefSets = [];
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...original,
        hash: `#${encodePayloadString({ v: 1, id: "sha256:fp", code: "482913", urls: ["https://relay.example.io"] })}`,
        get href() { return "http://localhost/"; },
        set href(v: string) { hrefSets.push(v); },
      },
    });
    challengeIdentity.mockResolvedValue({ fingerprint: "sha256:fp", publicKey: "pk", verified: true });
    postJson.mockImplementation(async (_b: string, path: string) => {
      if (path === "/api/pair/redeem") return { pendingId: "p1", confirmCode: "11 22 33" };
      return { status: "approved", token: "T" };
    });
  });
  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("does not assign location.href until the exchange resolves", async () => {
    render(<PairLanding />);
    await waitFor(() => expect(finishDevicePairing).toHaveBeenCalledWith("T"));
    // fixed-tick-waits: opt-out — proves the ABSENCE of a navigation, nothing to poll for
    await new Promise((r) => setTimeout(r, 50));
    expect(hrefSets).toEqual([]);
    release();
    await waitFor(() => expect(hrefSets).toEqual(["/"]));
  });
});
