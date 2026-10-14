/**
 * Waiting-list provenance (change: add-lan-knock-pairing, test-plan E26, ui-plan D13).
 * Store seeded directly, like the Gateway host does via `PairingApprovalHost`.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PendingPairing } from "../../../lib/pairing/pairing-approval-api.js";
import { pairingApprovalStore } from "../../../lib/pairing/pairing-approval-store.js";
import { WaitingDevices } from "../WaitingDevices.js";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const KNOCK: PendingPairing = {
  pendingId: "knock-1",
  userAgent: CHROME_MAC,
  viaHost: "192.168.16.204:8000",
  remoteAddress: "192.168.16.31",
  createdAt: 1,
  expiresAt: 2,
  attemptsLeft: 5,
  provenance: "knock",
  requesterName: "Roberts-MacBook-Pro",
  unencrypted: true,
};
const QR: PendingPairing = {
  pendingId: "qr-1",
  userAgent: SAFARI_IOS,
  viaHost: "pi-robson.share.zrok.io",
  remoteAddress: "127.0.0.1",
  createdAt: 1,
  expiresAt: 2,
  attemptsLeft: 5,
};

beforeEach(() => act(() => pairingApprovalStore.setPending([KNOCK, QR])));
afterEach(() => {
  cleanup();
  act(() => pairingApprovalStore.setPending([]));
});

describe("WaitingDevices provenance (E26)", () => {
  it("renders nothing when empty", () => {
    act(() => pairingApprovalStore.setPending([]));
    render(<WaitingDevices />);
    expect(screen.queryByTestId("pairing-waiting-list")).toBeNull();
  });

  it("knock row: pill, address first, says, Unencrypted word; QR row: Pairing link, no Unencrypted", () => {
    render(<WaitingDevices />);
    const rows = screen.getAllByTestId("pairing-waiting-row");
    expect(rows).toHaveLength(2);
    const [knock, qr] = rows;

    expect(within(knock).getByTestId("pairing-waiting-provenance").textContent).toContain("Network request");
    const text = knock.textContent ?? "";
    expect(text).toContain("192.168.16.31");
    expect(text).toContain("says “Roberts-MacBook-Pro”");
    expect(text).toContain("Unencrypted");
    expect(text.indexOf("192.168.16.31")).toBeLessThan(text.indexOf("Roberts-MacBook-Pro"));
    // address is mono
    const addr = within(knock).getByText("192.168.16.31");
    expect(addr.className).toContain("font-mono");

    expect(within(qr).getByTestId("pairing-waiting-provenance").textContent).toContain("Pairing link");
    expect(qr.textContent).not.toContain("Unencrypted");
    expect(qr.textContent).toContain("Safari on iPhone");
    expect(qr.textContent).toContain("pi-robson.share.zrok.io");
  });

  it("knock without a name shows the address and browser, no 'says'; not unencrypted → no pill", () => {
    act(() => pairingApprovalStore.setPending([{ ...KNOCK, requesterName: undefined, unencrypted: false }]));
    render(<WaitingDevices />);
    const row = screen.getByTestId("pairing-waiting-row");
    expect(row.textContent).toContain("192.168.16.31");
    expect(row.textContent).not.toContain("says");
    expect(row.textContent).not.toContain("Unencrypted");
  });

  it("Review buttons carry accessible names that identify their request; test id intact; click reviews", () => {
    render(<WaitingDevices />);
    const buttons = screen.getAllByTestId("pairing-waiting-review");
    expect(buttons[0].getAttribute("aria-label")).toBe("Review request from 192.168.16.31");
    expect(buttons[1].getAttribute("aria-label")).toBe("Review pairing link request");
    fireEvent.click(buttons[0]);
    expect(pairingApprovalStore.getState().preferred).toBe("knock-1");
  });

  it("existing hooks stay: list + row data-pending-id", () => {
    render(<WaitingDevices />);
    expect(screen.getByTestId("pairing-waiting-list")).toBeTruthy();
    expect(screen.getAllByTestId("pairing-waiting-row").map((r) => r.getAttribute("data-pending-id"))).toEqual([
      "knock-1",
      "qr-1",
    ]);
  });

  it("requester name is inert text (never HTML)", () => {
    act(() =>
      pairingApprovalStore.setPending([{ ...KNOCK, requesterName: "<img src=x onerror=alert(1)>" }]),
    );
    render(<WaitingDevices />);
    const row = screen.getByTestId("pairing-waiting-row");
    expect(row.querySelector("img")).toBeNull();
    expect(row.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
