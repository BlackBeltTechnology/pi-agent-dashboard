/**
 * PairLanding (browser `/pair`) tests — change: make-pairing-qr-camera-scannable.
 * Covers 1.4 (hash → decode → redeem→confirm→poll→store bearer) and
 * 5.2 (refuse to proceed on server-fingerprint mismatch).
 * Mocks the pair-protocol handshake so no real transport/crypto runs.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const challengeIdentity = vi.fn();
const postJson = vi.fn();
vi.mock("../../lib/pairing/pair-protocol.js", () => ({
  challengeIdentity: (...a: any[]) => challengeIdentity(...a),
  postJson: (...a: any[]) => postJson(...a),
}));

const storeDeviceBearer = vi.fn();
vi.mock("../../lib/pairing/device-auth.js", () => ({
  storeDeviceBearer: (...a: any[]) => storeDeviceBearer(...a),
  // The cookie exchange is covered in device-auth-cookie.test.ts; here it just stores.
  finishDevicePairing: async (...a: any[]) => storeDeviceBearer(...a),
}));

import { encodePayloadString } from "../../lib/pairing/pairing-qr.js";
import type { PairingPayload } from "../../lib/pairing/pairing-api.js";
import { PairLanding } from "../connectivity/PairLanding.js";

const PAYLOAD: PairingPayload = {
  v: 1,
  id: "sha256:server-fp",
  code: "482913",
  urls: ["https://relay.example.io"],
};

function setHash(payload: PairingPayload) {
  window.location.hash = `#${encodePayloadString(payload)}`;
}

beforeEach(() => {
  challengeIdentity.mockReset();
  postJson.mockReset();
  storeDeviceBearer.mockReset();
  window.location.hash = "";
});
afterEach(() => cleanup());

describe("PairLanding", () => {
  it("1.4 decodes the hash, redeems, shows the confirm code, then stores the bearer on approval", async () => {
    setHash(PAYLOAD);
    challengeIdentity.mockResolvedValue({ fingerprint: "sha256:server-fp", publicKey: "pk", verified: true });
    postJson.mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/pair/redeem") return { pendingId: "p1", confirmCode: "77 88 99" };
      if (path === "/api/pair/poll") {
        // Yield a macrotask so React commits the polling/confirm-code render
        // before approval flips the phase to done. This is a mock-internal
        // yield, not an assertion barrier — hence the opt-out below.
        // fixed-tick-waits: opt-out — mock-internal macrotask yield, gates no assertion
        await new Promise((r) => setTimeout(r, 0));
        return { status: "approved", token: "BEARER-XYZ" };
      }
      throw new Error(`unexpected ${path}`);
    });

    const onPaired = vi.fn();
    render(<PairLanding onPaired={onPaired} />);

    await waitFor(() => expect(screen.getByTestId("pair-landing-confirm-code").textContent).toBe("77 88 99"));
    await waitFor(() => expect(storeDeviceBearer).toHaveBeenCalledWith("BEARER-XYZ"));
    expect(onPaired).toHaveBeenCalledWith("BEARER-XYZ");
    // Redeem carried the one-time code from the payload.
    expect(postJson).toHaveBeenCalledWith("https://relay.example.io", "/api/pair/redeem", { code: "482913" });
    await waitFor(() => expect(screen.getByTestId("pair-landing-done")).toBeDefined());
  });

  it("5.2 refuses to redeem when the server fingerprint does not match the pinned payload.id", async () => {
    setHash(PAYLOAD);
    challengeIdentity.mockResolvedValue({ fingerprint: "sha256:IMPOSTOR", publicKey: "pk", verified: true });

    render(<PairLanding />);

    await waitFor(() => expect(screen.getByTestId("pair-landing-error")).toBeDefined());
    expect(screen.getByTestId("pair-landing-error").textContent).toMatch(/identity|refused|mismatch/i);
    // Never redeemed, never stored a bearer.
    expect(postJson).not.toHaveBeenCalled();
    expect(storeDeviceBearer).not.toHaveBeenCalled();
  });

  // change: add-pairing-approval-dialog — test-plan F11 / X12.
  function pollReturning(status: string) {
    setHash(PAYLOAD);
    challengeIdentity.mockResolvedValue({ fingerprint: "sha256:server-fp", publicKey: "pk", verified: true });
    postJson.mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/pair/redeem") return { pendingId: "p1", confirmCode: "12345678" };
      if (path === "/api/pair/poll") return { status };
      throw new Error(`unexpected ${path}`);
    });
  }
  const pollCalls = () => postJson.mock.calls.filter((c) => c[1] === "/api/pair/poll").length;

  it("F11 shows the decline on `rejected`, offers no restart, and stops polling", async () => {
    pollReturning("rejected");
    render(<PairLanding />);
    await waitFor(() => expect(screen.getByTestId("pair-landing-rejected")).toBeDefined());
    expect(screen.getByTestId("pair-landing-rejected").textContent).toContain("The dashboard declined this device");
    expect(screen.queryByTestId("pair-landing-restart")).toBeNull();
    const calls = pollCalls();
    expect(calls).toBe(1);
    // Past one poll interval (2s): no further poll was issued.
    // fixed-tick-waits: opt-out — proves ABSENCE of a poll past the 2s interval
    await new Promise((r) => setTimeout(r, 2100));
    expect(pollCalls()).toBe(calls);
  });

  it("X12 an unknown status is terminal: polling stops and an error shows", async () => {
    pollReturning("weird");
    render(<PairLanding />);
    await waitFor(() => expect(screen.getByTestId("pair-landing-error")).toBeDefined());
    const calls = pollCalls();
    expect(calls).toBe(1);
    // fixed-tick-waits: opt-out — proves ABSENCE of a poll past the 2s interval
    await new Promise((r) => setTimeout(r, 2100));
    expect(pollCalls()).toBe(calls);
  });

  it("shows an error + restart affordance when the hash is missing", async () => {
    window.location.hash = "";
    render(<PairLanding />);
    await waitFor(() => expect(screen.getByTestId("pair-landing-error")).toBeDefined());
    expect(screen.getByTestId("pair-landing-restart")).toBeDefined();
    expect(challengeIdentity).not.toHaveBeenCalled();
  });

  it("styles from theme tokens, never a hardcoded dark-only palette (readable in light + dark)", async () => {
    window.location.hash = "";
    const { container } = render(<PairLanding />);
    await waitFor(() => expect(screen.getByTestId("pair-landing-error")).toBeDefined());
    const classes = Array.from(container.querySelectorAll("[class]")).map((el) => el.getAttribute("class")).join(" ");
    expect(classes).not.toMatch(/\b(?:text|bg|border)-(?:neutral|red|green|blue)-\d/);
    expect(screen.getByTestId("pair-landing").className).toContain("text-[var(--text-primary)]");
    expect(screen.getByTestId("pair-landing-error").innerHTML).toContain("var(--severity-error-fg)");
  });
});
