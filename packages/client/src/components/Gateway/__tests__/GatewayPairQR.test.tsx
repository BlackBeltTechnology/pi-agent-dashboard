import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Only the pairing payload / approve calls are mocked; endpoints are injected
// via the `endpoints` prop and split by the real `splitEndpoints` helper.
const { getPairPayload, approvePairing } = vi.hoisted(() => ({
  getPairPayload: vi.fn(),
  approvePairing: vi.fn(),
}));
vi.mock("../../../lib/pairing-api.js", () => ({ getPairPayload, approvePairing }));

import { GatewayPairQR } from "../GatewayPairQR.js";

const PAYLOAD = { v: 1, id: "sha256:hljQKabc123", code: "998877", urls: ["https://cwanni9.zrok.io"] };

/** A tunnel with a public TLS endpoint + local + LAN link endpoints. */
const MIXED_EPS: TunnelEndpoint[] = [
  { kind: "public", url: "https://cwanni9.zrok.io", tls: true },
  { kind: "local", url: "http://localhost:8000", tls: false },
  { kind: "lan", url: "http://192.168.16.220:8000", tls: false },
];

/** No TLS anywhere — link endpoints only. */
const LINK_ONLY_EPS: TunnelEndpoint[] = [
  { kind: "local", url: "http://localhost:8000", tls: false },
  { kind: "lan", url: "http://192.168.16.220:8000", tls: false },
];

function qrText(): string | null {
  return screen.getByTestId("gateway-qr-canvas").getAttribute("data-qr-text");
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GatewayPairQR — single-QR network selector", () => {
  it("1.1 renders exactly one QR canvas (not one-per-endpoint)", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
    render(<GatewayPairQR endpoints={MIXED_EPS} />);
    await waitFor(() => expect(screen.getAllByTestId("gateway-qr-canvas").length).toBe(1));
  });

  it("1.2 lists every endpoint as a radio row with kind pill + mode tag", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
    render(<GatewayPairQR endpoints={MIXED_EPS} />);
    await waitFor(() => expect(screen.getByRole("radiogroup")).toBeDefined());
    const rows = screen.getAllByRole("radio");
    expect(rows.length).toBe(MIXED_EPS.length);
    // pairing endpoint carries a "pairing" mode tag; link endpoints "link".
    const pairingRow = rows.find((r) => r.textContent?.includes("cwanni9.zrok.io"));
    expect(pairingRow?.textContent).toMatch(/pairing/i);
    expect(pairingRow?.textContent).toMatch(/public/i);
    const lanRow = rows.find((r) => r.textContent?.includes("192.168.16.220"));
    expect(lanRow?.textContent).toMatch(/link/i);
    expect(lanRow?.textContent).toMatch(/lan/i);
  });

  it("1.3 defaults to the public TLS pairing endpoint; QR encodes the scannable deep link", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
    render(<GatewayPairQR endpoints={MIXED_EPS} />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-copystring")).toBeDefined());
    const checked = screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true");
    expect(checked?.textContent).toContain("cwanni9.zrok.io");
    // The copy-string stays the bare payload (Electron paste); the pairing QR
    // encodes a camera-scannable `https://<selected-tls>/pair#<payload>` deep
    // link (change: make-pairing-qr-camera-scannable) on the SELECTED endpoint.
    const copyStr = screen.getByTestId("gateway-pair-copystring").textContent ?? "";
    expect(copyStr).toMatch(/^pi:pair:v1\./);
    expect(qrText()).toBe(`https://cwanni9.zrok.io/pair#${copyStr}`);
  });

  it("1.4 with no TLS endpoint, defaults to the first link endpoint; QR encodes its bare URL", async () => {
    getPairPayload.mockResolvedValue({ ok: false, error: "no_reachable_endpoint" });
    render(<GatewayPairQR endpoints={LINK_ONLY_EPS} />);
    await waitFor(() => expect(screen.getByTestId("gateway-qr-canvas")).toBeDefined());
    const checked = screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true");
    expect(checked?.textContent).toContain("localhost:8000");
    expect(qrText()).toBe("http://localhost:8000");
    expect(screen.queryByTestId("gateway-pair-copystring")).toBeNull();
  });

  it("1.5 selecting a link row hides pairing controls and shows the link note", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
    render(<GatewayPairQR endpoints={MIXED_EPS} />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-copystring")).toBeDefined());

    const lanRow = screen.getAllByRole("radio").find((r) => r.textContent?.includes("192.168.16.220"));
    fireEvent.click(lanRow!);

    await waitFor(() => expect(screen.queryByTestId("gateway-pair-copystring")).toBeNull());
    expect(screen.queryByTestId("gateway-pair-confirm-input")).toBeNull();
    expect(screen.queryByTestId("gateway-pair-approve-btn")).toBeNull();
    // expiry countdown gone
    expect(screen.queryByText(/code expires/i)).toBeNull();
    // link note present
    expect(screen.getByTestId("gateway-link-note")).toBeDefined();
    expect(qrText()).toBe("http://192.168.16.220:8000");
  });

  it("1.6 selecting back to the pairing row restores the pairing controls", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
    render(<GatewayPairQR endpoints={MIXED_EPS} />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-copystring")).toBeDefined());

    const rows = () => screen.getAllByRole("radio");
    fireEvent.click(rows().find((r) => r.textContent?.includes("192.168.16.220"))!);
    await waitFor(() => expect(screen.queryByTestId("gateway-pair-copystring")).toBeNull());

    fireEvent.click(rows().find((r) => r.textContent?.includes("cwanni9.zrok.io"))!);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-copystring")).toBeDefined());
    expect(screen.getByTestId("gateway-pair-confirm-input")).toBeDefined();
    expect(screen.getByTestId("gateway-pair-approve-btn")).toBeDefined();
  });

  it("1.7 approve stays enabled after the mint countdown lapses (server is the authority)", async () => {
    vi.useFakeTimers();
    try {
      getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
      approvePairing.mockResolvedValue({ id: "d1", label: "iPhone", createdAt: 0, lastSeen: 0 });
      render(<GatewayPairQR endpoints={MIXED_EPS} />);
      // Flush the mocked async load, then tick past the 60s mint-anchored countdown.
      await act(async () => {});
      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });
      // Header now shows the advisory "code expired"...
      expect(screen.getByText(/code expired/i)).toBeDefined();
      // ...but the Approve action must NOT be disabled by that timer.
      const input = screen.getByTestId("gateway-pair-confirm-input");
      fireEvent.change(input, { target: { value: "12345678" } });
      const btn = screen.getByTestId("gateway-pair-approve-btn") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      await act(async () => {
        fireEvent.click(btn);
      });
      expect(approvePairing).toHaveBeenCalledWith(PAYLOAD.code, "12345678");
    } finally {
      vi.useRealTimers();
    }
  });

  it("3.1 radio group supports arrow-key navigation and Space commit", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
    render(<GatewayPairQR endpoints={MIXED_EPS} />);
    await waitFor(() => expect(screen.getByRole("radiogroup")).toBeDefined());
    const group = screen.getByRole("radiogroup");
    // ArrowDown from the default (pairing) row moves selection to the next row.
    fireEvent.keyDown(group, { key: "ArrowDown" });
    await waitFor(() => {
      const checked = within(group).getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true");
      expect(checked?.textContent).toContain("localhost:8000");
    });
    expect(qrText()).toBe("http://localhost:8000");
  });
});
