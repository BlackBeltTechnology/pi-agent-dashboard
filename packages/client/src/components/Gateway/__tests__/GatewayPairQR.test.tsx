import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Only the pairing payload / approve calls are mocked; endpoints are injected
// via the `endpoints` prop and split by the real `splitEndpoints` helper.
// collapse-pairing-into-gateway: hosts that render <GatewayPairQR /> without the
// `endpoints` prop go through `getGatewayEndpoints()` — mocked here so the
// endpoints-fetch failure modes (X3/X4) are drivable, while `splitEndpoints`,
// `guardPairingUrls` and `isPairingEligible` stay real.
const { getPairPayload, approvePairing, getGatewayEndpoints } = vi.hoisted(() => ({
  getPairPayload: vi.fn(),
  approvePairing: vi.fn(),
  getGatewayEndpoints: vi.fn(),
}));
vi.mock("../../../lib/pairing/pairing-api.js", () => ({ getPairPayload, approvePairing }));
vi.mock("../../../lib/gateway/gateway-endpoints.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/gateway/gateway-endpoints.js")>()),
  getGatewayEndpoints,
}));

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

/** One TLS endpoint — the minimal healthy pairing deployment. */
const TLS_EPS: TunnelEndpoint[] = [{ kind: "public", url: "https://tls.example", tls: true }];

/** One no-TLS link endpoint — the plain LAN-only deployment (the E5 regression row). */
const LINK_EPS: TunnelEndpoint[] = [{ kind: "lan", url: "http://192.168.1.10:8000", tls: false }];

/** Full-length fingerprint id (E8: the survivor must render it in full). */
const ID_64 = "3a9f1e2d4c5b6a79887766554433221100ffeeddccbbaa9988776655443322111";

/** Exact-code-equality row lookup — the selector row's <code> carries the
 * full endpoint url, so equality replaces URL-substring matching
 * (CodeQL js/incomplete-url-substring-sanitization). */
function rowFor(url: string): HTMLElement {
  const row = screen.getAllByRole("radio").find((r) => r.querySelector("code")?.textContent === url);
  if (!row) throw new Error(`no selector row for ${url}`);
  return row as HTMLElement;
}

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
    const pairingRow = rowFor("https://cwanni9.zrok.io");
    expect(pairingRow?.textContent).toMatch(/pairing/i);
    expect(pairingRow?.textContent).toMatch(/public/i);
    const lanRow = rowFor("http://192.168.16.220:8000");
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

    const lanRow = rowFor("http://192.168.16.220:8000");
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
    fireEvent.click(rowFor("http://192.168.16.220:8000"));
    await waitFor(() => expect(screen.queryByTestId("gateway-pair-copystring")).toBeNull());

    fireEvent.click(rowFor("https://cwanni9.zrok.io"));
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

describe("collapse-pairing-into-gateway — no secure road condition (E1–E5)", () => {
  // E1 — the condition keys on the no_reachable_endpoint RESPONSE, never on an
  // unloaded payload: while either fetch is pending the block must not flash.
  it("E1 while both fetches are pending: no no-secure-road block, a loading affordance instead", async () => {
    getGatewayEndpoints.mockReturnValue(new Promise(() => {}));
    getPairPayload.mockReturnValue(new Promise(() => {}));
    render(<GatewayPairQR />);
    await act(async () => {});

    expect(screen.queryByTestId("gateway-pair-no-secure-road")).toBeNull();
    expect(screen.queryByTestId("gateway-pair-no-secure-road-setup")).toBeNull();
    expect(screen.queryByText(/localhost/i)).toBeNull();
    expect(screen.getByTestId("gateway-pair-loading")).toBeDefined();
  });

  // E2 — happy row: healthy TLS deployment renders the QR deep link + copy-string
  // + fingerprint + countdown (pins the surface the collapse keeps).
  it("E2 healthy TLS deployment: QR deep link, copy-string, fingerprint, countdown", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: { v: 1, id: ID_64, code: "482913", urls: ["wss://x.example/ws"] } });
    render(<GatewayPairQR endpoints={TLS_EPS} />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-copystring")).toBeDefined());

    const qr = qrText() ?? "";
    expect(qr.startsWith("https://")).toBe(true);
    expect(qr).toContain("/pair#pi:pair:v1.");
    expect(screen.getByTestId("gateway-pair-copystring").textContent).toMatch(/^pi:pair:v1\./);
    // Fingerprint + countdown affordances present.
    expect(screen.getByTestId("gateway-pair-fingerprint")).toBeDefined();
    expect(screen.getByText(/code expires/i)).toBeDefined();
  });

  // E3 — zero-endpoint row: explanation + setup action + localhost note all render.
  it("E3 no_reachable_endpoint with no endpoints: explanation + setup action + localhost note", async () => {
    getGatewayEndpoints.mockResolvedValue([]);
    getPairPayload.mockResolvedValue({ ok: false, error: "no_reachable_endpoint" });
    const onSetupRequested = vi.fn();
    render(<GatewayPairQR onSetupRequested={onSetupRequested} />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-no-secure-road")).toBeDefined());

    const block = screen.getByTestId("gateway-pair-no-secure-road");
    expect(block.textContent).toMatch(/secure road/i); // outcome headline + why
    expect(screen.getByTestId("gateway-pair-no-secure-road-setup")).toBeDefined();
    expect(screen.getByText(/localhost/i)).toBeDefined();
    // The action performs something real: the host callback fires.
    fireEvent.click(screen.getByTestId("gateway-pair-no-secure-road-setup"));
    expect(onSetupRequested).toHaveBeenCalledTimes(1);
  });

  // E4 — the retired one-sentence `gateway.pair.empty` message is gone; the new
  // block is the ONLY zero-endpoint message.
  it("E4 no_reachable_endpoint: retired gateway.pair.empty string absent, exactly one message block", async () => {
    getGatewayEndpoints.mockResolvedValue([]);
    getPairPayload.mockResolvedValue({ ok: false, error: "no_reachable_endpoint" });
    render(<GatewayPairQR />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-no-secure-road")).toBeDefined());

    expect(screen.queryByText(/No TLS endpoint to pair over/i)).toBeNull();
    expect(screen.queryByTestId("gateway-pair-empty")).toBeNull();
    expect(screen.getAllByTestId("gateway-pair-no-secure-road").length).toBe(1);
  });

  // E5 — THE regression row: link-only (http LAN) deployment gets no_reachable_endpoint
  // while state is "ready". Block AND link-endpoint panel must render simultaneously.
  it("E5 no_reachable_endpoint WITH link endpoints: block and link note render together", async () => {
    getPairPayload.mockResolvedValue({ ok: false, error: "no_reachable_endpoint" });
    render(<GatewayPairQR endpoints={LINK_EPS} />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-no-secure-road")).toBeDefined());

    expect(screen.getByTestId("gateway-pair-no-secure-road").textContent).toMatch(/secure road/i);
    expect(screen.getByTestId("gateway-pair-no-secure-road-setup")).toBeDefined();
    expect(screen.getByText(/localhost/i)).toBeDefined();
    // The link-endpoint panel is still there, alongside — not replaced.
    expect(screen.getByTestId("gateway-link-note")).toBeDefined();
    expect(screen.getByTestId("gateway-link-note").textContent).toContain("192.168.1.10:8000");
  });
});

describe("collapse-pairing-into-gateway — display parity (E8, E9)", () => {
  // E8 — the fingerprint renders in FULL and selectable; the 12-char form may
  // additionally appear as the QR caption (D7).
  it("E8 full 64-char fingerprint id is present and selectable", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: { v: 1, id: ID_64, code: "482913", urls: ["wss://x.example/ws"] } });
    render(<GatewayPairQR endpoints={TLS_EPS} />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-fingerprint")).toBeDefined());

    const fp = screen.getByTestId("gateway-pair-fingerprint");
    expect(fp.textContent).toBe(ID_64);
    expect(fp.className).toContain("select-all");
    // The compact caption may ALSO show the prefix — but never instead.
    expect(screen.getAllByText(new RegExp(ID_64.slice(0, 12))).length).toBeGreaterThanOrEqual(1);
  });

  // E9 — advertised urls come from the PAYLOAD, not the endpoint-selection list.
  it("E9 rendered advertised-URL list is the payload's urls[], not the endpoint list", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: { v: 1, id: ID_64, code: "482913", urls: ["wss://tunnel.example/ws"] } });
    render(
      <GatewayPairQR
        endpoints={[
          { kind: "public", url: "https://other.example", tls: true },
          { kind: "lan", url: "http://lan.example", tls: false },
        ]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("gateway-pair-urls")).toBeDefined());

    const items = within(screen.getByTestId("gateway-pair-urls")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["wss://tunnel.example/ws"]);
    expect(screen.getByTestId("gateway-pair-urls").textContent).not.toContain("other.example");
  });
});

describe("collapse-pairing-into-gateway — approval invariants + failure modes (E6, E7, X1–X5, F1)", () => {
  // E6 — BVA row: the countdown does not gate approval at ANY reading.
  it("E6 countdown ticked to 1: Approve is not disabled", async () => {
    vi.useFakeTimers();
    try {
      getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
      render(<GatewayPairQR endpoints={MIXED_EPS} />);
      await act(async () => {});
      await act(async () => {
        vi.advanceTimersByTime(59_000); // exactly 1s left
      });
      fireEvent.change(screen.getByTestId("gateway-pair-confirm-input"), { target: { value: "482913" } });
      expect((screen.getByTestId("gateway-pair-approve-btn") as HTMLButtonElement).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // E7 — BVA row: at zero and past it the control stays usable and submitting
  // issues the POST (the server is the sole validity authority, D12).
  it("E7 countdown at 0 and past it: Approve enabled and POST issued", async () => {
    vi.useFakeTimers();
    try {
      getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
      approvePairing.mockResolvedValue({ id: "d1", label: "iPhone", createdAt: 0, lastSeen: 0 });
      render(<GatewayPairQR endpoints={MIXED_EPS} />);
      await act(async () => {});
      await act(async () => {
        vi.advanceTimersByTime(60_000); // at zero…
      });
      fireEvent.change(screen.getByTestId("gateway-pair-confirm-input"), { target: { value: PAYLOAD.code } });
      expect((screen.getByTestId("gateway-pair-approve-btn") as HTMLButtonElement).disabled).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(5_000); // …and past it
      });
      fireEvent.change(screen.getByTestId("gateway-pair-confirm-input"), { target: { value: PAYLOAD.code } });
      await act(async () => {
        fireEvent.click(screen.getByTestId("gateway-pair-approve-btn"));
      });
      expect(approvePairing).toHaveBeenCalledWith(PAYLOAD.code, PAYLOAD.code);
    } finally {
      vi.useRealTimers();
    }
  });

  // X1 — a non-no_reachable_endpoint error is NOT the no-secure-road condition.
  it("X1 payload error 'internal': error surfaced, no-secure-road block absent", async () => {
    getGatewayEndpoints.mockResolvedValue([]);
    getPairPayload.mockResolvedValue({ ok: false, error: "internal" });
    render(<GatewayPairQR />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-error")).toBeDefined());

    expect(screen.getByTestId("gateway-pair-error").textContent).toContain("internal");
    expect(screen.queryByTestId("gateway-pair-no-secure-road")).toBeNull();
  });

  // X2 — the client-side TLS re-guard is fail-closed: a poisoned url aborts the
  // encode and surfaces, it is never silently filtered out of a rendered QR.
  it("X2 non-TLS url in payload urls[]: guard throws, encode aborted, no QR carries it", async () => {
    getPairPayload.mockResolvedValue({
      ok: true,
      payload: { v: 1, id: ID_64, code: "482913", urls: ["https://ok.example", "http://192.168.1.10:8000"] },
    });
    render(<GatewayPairQR endpoints={TLS_EPS} />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-error")).toBeDefined());

    expect(screen.getByTestId("gateway-pair-error").textContent).toContain("refusing non-TLS");
    expect(screen.queryByTestId("gateway-qr-canvas")).toBeNull();
    expect(screen.queryByTestId("gateway-pair-copystring")).toBeNull();
  });

  // X3 — D8 accepted regression, pinned: an endpoints-fetch failure now takes
  // down the ONLY pairing surface; it must at least report, not blank out.
  it("X3 getGatewayEndpoints rejects: error reported, not a blank or loading panel", async () => {
    getGatewayEndpoints.mockRejectedValue(new Error("endpoints exploded"));
    render(<GatewayPairQR />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-error")).toBeDefined());

    expect(screen.getByTestId("gateway-pair-error").textContent).toContain("endpoints exploded");
    expect(screen.queryByTestId("gateway-pair-loading")).toBeNull();
  });

  // X4 — E1×D8 interaction: while the endpoints fetch is in flight the block
  // must not flash, even though the payload answer already failed.
  it("X4 endpoints fetch resolves late, payload fails immediately: no block during the gap, once after", async () => {
    let resolveEps!: (eps: TunnelEndpoint[]) => void;
    getGatewayEndpoints.mockReturnValue(new Promise<TunnelEndpoint[]>((resolve) => { resolveEps = resolve; }));
    getPairPayload.mockResolvedValue({ ok: false, error: "no_reachable_endpoint" });
    render(<GatewayPairQR />);
    await act(async () => {});

    expect(screen.queryByTestId("gateway-pair-no-secure-road")).toBeNull();
    expect(screen.getByTestId("gateway-pair-loading")).toBeDefined();

    await act(async () => {
      resolveEps([{ kind: "lan", url: "http://192.168.1.10:8000", tls: false }]);
    });
    await waitFor(() => expect(screen.getAllByTestId("gateway-pair-no-secure-road").length).toBe(1));
  });

  // X5 — regenerate re-evaluates the flag: it is never latched from a prior
  // successful load (tunnel dropped mid-session).
  it("X5 first load ok then no_reachable_endpoint on regenerate: stale panel clears, block appears", async () => {
    getPairPayload
      .mockResolvedValueOnce({ ok: true, payload: PAYLOAD })
      .mockResolvedValueOnce({ ok: false, error: "no_reachable_endpoint" });
    render(<GatewayPairQR endpoints={MIXED_EPS} />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-copystring")).toBeDefined());
    expect(screen.queryByTestId("gateway-pair-no-secure-road")).toBeNull();

    fireEvent.click(screen.getByTestId("gateway-pair-regenerate"));
    await waitFor(() => expect(screen.getByTestId("gateway-pair-no-secure-road")).toBeDefined());
    expect(screen.queryByTestId("gateway-pair-copystring")).toBeNull();
  });

  // X5 mirror (review nit): the block must CLEAR when a regenerate succeeds —
  // setNoSecureRoad(false) at the top of load() is what makes the flag
  // re-evaluated in BOTH directions, so pin the no-road → healthy transition.
  it("X5-mirror first load no_reachable_endpoint then ok on regenerate: block clears, panel returns", async () => {
    getPairPayload
      .mockResolvedValueOnce({ ok: false, error: "no_reachable_endpoint" })
      .mockResolvedValueOnce({ ok: true, payload: PAYLOAD });
    render(<GatewayPairQR endpoints={MIXED_EPS} />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-no-secure-road")).toBeDefined());
    expect(screen.queryByTestId("gateway-pair-copystring")).toBeNull();

    fireEvent.click(screen.getByTestId("gateway-pair-regenerate"));
    await waitFor(() => expect(screen.getByTestId("gateway-pair-copystring")).toBeDefined());
    expect(screen.queryByTestId("gateway-pair-no-secure-road")).toBeNull();
  });

  // F1 — D7a selection coupling, pinned as deliberate: link selection swaps the
  // payload panel for the link note; TLS re-selection restores everything
  // without a reload.
  it("F1 link select swaps payload panel for link note; TLS re-select restores it", async () => {
    getPairPayload.mockResolvedValue({ ok: true, payload: PAYLOAD });
    render(<GatewayPairQR endpoints={MIXED_EPS} />);
    await waitFor(() => expect(screen.getByTestId("gateway-pair-copystring")).toBeDefined());

    const rows = () => screen.getAllByRole("radio");
    fireEvent.click(rowFor("http://192.168.16.220:8000"));
    await waitFor(() => expect(screen.queryByTestId("gateway-pair-copystring")).toBeNull());
    expect(screen.getByTestId("gateway-link-note")).toBeDefined();
    expect(screen.queryByTestId("gateway-pair-fingerprint")).toBeNull();

    fireEvent.click(rowFor("https://cwanni9.zrok.io"));
    await waitFor(() => expect(screen.getByTestId("gateway-pair-copystring")).toBeDefined());
    expect(screen.getByTestId("gateway-pair-fingerprint")).toBeDefined();
    expect(screen.getByTestId("gateway-pair-urls")).toBeDefined();
    expect(screen.getByTestId("gateway-pair-approve-btn")).toBeDefined();
    expect(screen.getByText(/code expires/i)).toBeDefined();
  });
});
