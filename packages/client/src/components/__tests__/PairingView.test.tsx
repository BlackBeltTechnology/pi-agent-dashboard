/**
 * Tests for PairingView — the operator-side pairing surface.
 * Mocks pairing-api so no real transport is exercised (change: wire-nonzrok-pairing-view).
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPairPayload = vi.fn();
const approvePairing = vi.fn();
vi.mock("../../lib/pairing/pairing-api.js", () => ({
  getPairPayload: (...a: any[]) => getPairPayload(...a),
  approvePairing: (...a: any[]) => approvePairing(...a),
}));

const navigateFn = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/", navigateFn],
}));

import { PairingView } from "../connectivity/PairingView.js";

const PAYLOAD = { v: 1, id: "sha256:abc", code: "123456", urls: ["wss://x.zrok.io/ws"] };

beforeEach(() => {
  getPairPayload.mockReset();
  approvePairing.mockReset();
  navigateFn.mockReset();
});
afterEach(() => cleanup());

describe("PairingView", () => {
  it("renders empty state on no_reachable_endpoint", async () => {
    getPairPayload.mockResolvedValue({ ok: false, error: "no_reachable_endpoint" });
    render(<PairingView />);
    await waitFor(() => expect(screen.getByTestId("pairing-empty")).toBeDefined());
    // Start-tunnel action navigates to the secure road, never implies plain LAN works.
    fireEvent.click(screen.getByTestId("pairing-start-tunnel"));
    expect(navigateFn).toHaveBeenCalledWith("/settings/gateway");
  });

  it("renders QR + copy-string + fingerprint when payload present", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
    render(<PairingView />);
    await waitFor(() => expect(screen.getByTestId("pairing-view")).toBeDefined());
    expect(screen.getByTestId("pairing-qr-canvas")).toBeDefined();
    expect(screen.getByTestId("pairing-copy-string").textContent).toBeTruthy();
    expect(screen.getByTestId("pairing-fingerprint").textContent).toBe("sha256:abc");
    expect(screen.getByTestId("pairing-url").textContent).toBe("wss://x.zrok.io/ws");
  });

  it("approves the device with a matching confirm code", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
    approvePairing.mockResolvedValue({ id: "d1", label: "iPhone", createdAt: "", lastSeen: null });
    render(<PairingView />);
    await waitFor(() => expect(screen.getByTestId("pairing-view")).toBeDefined());

    fireEvent.change(screen.getByTestId("pairing-confirm-input"), { target: { value: "00112233" } });
    fireEvent.click(screen.getByTestId("pairing-approve-btn"));

    await waitFor(() => expect(screen.getByTestId("pairing-approved")).toBeDefined());
    expect(approvePairing).toHaveBeenCalledWith("123456", "00112233");
    expect(screen.getByTestId("pairing-approved").textContent).toContain("iPhone");
  });

  it("shows an error on wrong confirm code without pairing", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
    approvePairing.mockRejectedValue(new Error("mismatch"));
    render(<PairingView />);
    await waitFor(() => expect(screen.getByTestId("pairing-view")).toBeDefined());

    fireEvent.change(screen.getByTestId("pairing-confirm-input"), { target: { value: "99999999" } });
    fireEvent.click(screen.getByTestId("pairing-approve-btn"));

    await waitFor(() => expect(screen.getByTestId("pairing-approve-error")).toBeDefined());
    expect(screen.getByTestId("pairing-approve-error").textContent).toContain("mismatch");
    expect(screen.queryByTestId("pairing-approved")).toBeNull();
  });
});
