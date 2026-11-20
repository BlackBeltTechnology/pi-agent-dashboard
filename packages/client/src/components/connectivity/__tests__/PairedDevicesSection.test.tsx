/**
 * F4 (test-plan, mcp-legacy-clients-and-token-issuance): pairing rows render
 * unchanged, manual rows get exactly one badge, and the create-token flow
 * shows the token + snippet once and clears on dismiss.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../../../lib/api/api-context.js";
import { PairedDevicesSection } from "../PairedDevicesSection.js";

const {
  listPairedDevices,
  revokePairedDevice,
  createPairedDevice,
  reachableUrls,
  getBridgeTokenContext,
  listRevokedDevices,
  restorePairedDevice,
  deleteRevokedDevice,
  removeCompanion,
} = vi.hoisted(() => ({
  listPairedDevices: vi.fn(),
  revokePairedDevice: vi.fn(),
  createPairedDevice: vi.fn(),
  reachableUrls: vi.fn(),
  getBridgeTokenContext: vi.fn(),
  listRevokedDevices: vi.fn(),
  restorePairedDevice: vi.fn(),
  deleteRevokedDevice: vi.fn(),
  removeCompanion: vi.fn(),
}));

vi.mock("../../../lib/pairing/paired-devices-api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/pairing/paired-devices-api.js")>()),
  listPairedDevices,
  revokePairedDevice,
  createPairedDevice,
  reachableUrls,
  getBridgeTokenContext,
  listRevokedDevices,
  restorePairedDevice,
  deleteRevokedDevice,
  removeCompanion,
}));

const PAIRING_ROW = {
  id: "dev-1",
  label: "My iPhone",
  createdAt: "2026-08-01T00:00:00.000Z",
  lastSeen: null,
  source: "pairing" as const,
  tier: "operate" as const,
};
const MANUAL_ROW = {
  id: "dev-2",
  label: "claude-code",
  createdAt: "2026-08-02T00:00:00.000Z",
  lastSeen: null,
  source: "manual" as const,
  tier: "observe" as const,
};
const MINTED = { device: MANUAL_ROW, token: "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
const MINTED_TOKEN = MINTED.token;

beforeEach(() => {
  listPairedDevices.mockReset().mockResolvedValue([PAIRING_ROW, MANUAL_ROW]);
  revokePairedDevice.mockReset().mockResolvedValue(undefined);
  createPairedDevice.mockReset().mockResolvedValue(MINTED);
  reachableUrls.mockReset().mockResolvedValue([]);
  // Default: a plain-HTTP dashboard with no TLS listener (the pre-change world).
  getBridgeTokenContext.mockReset().mockResolvedValue({ httpsChannel: false, tlsListenerUrls: [], acceptBridges: false });
  // Default viewer: an operator with nothing revoked (the pre-change world keeps its Revoke buttons).
  listRevokedDevices.mockReset().mockResolvedValue({ operator: true, devices: [], unreadable: false });
  restorePairedDevice.mockReset().mockResolvedValue("restored");
  deleteRevokedDevice.mockReset().mockResolvedValue("deleted");
  removeCompanion.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  setGlobalApiBase("");
});

describe("F4 — pairing rows unchanged, manual rows marked", () => {
  it("renders one manual badge and a revoke control on every row", async () => {
    render(<PairedDevicesSection />);
    await screen.findByText("claude-code");
    expect(screen.getByText("My iPhone")).toBeTruthy();
    // Exactly ONE "manual" badge in the DOM.
    expect(screen.getAllByText("manual")).toHaveLength(1);
    // Every row carries a revoke control (title from the icon button).
    const revokeButtons = screen.getAllByTitle("Revoke device");
    expect(revokeButtons).toHaveLength(2);
  });

  it("a pairing row carries no badge", async () => {
    listPairedDevices.mockResolvedValue([PAIRING_ROW]);
    render(<PairedDevicesSection />);
    await screen.findByText("My iPhone");
    expect(screen.queryByText("manual")).toBeNull();
  });
});

describe("create-token flow", () => {
  async function openCreateFlow() {
    render(<PairedDevicesSection />);
    await screen.findByText("My iPhone");
    fireEvent.click(screen.getByText("Create token for an MCP client"));
    const input = await screen.findByLabelText("Token label");
    fireEvent.change(input, { target: { value: "claude-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText(MINTED.token);
  }

  it("mints via the API and shows the token + claude snippet once", async () => {
    setGlobalApiBase("http://localhost:8000");
    await openCreateFlow();

    expect(createPairedDevice).toHaveBeenCalledWith("claude-code", "observe");
    // The token is shown.
    expect(screen.getByText(MINTED_TOKEN)).toBeTruthy();
    // The snippet is copy-ready and embeds the same token.
    const snippet = screen.getByText(/claude mcp add/) as HTMLElement;
    expect(snippet.textContent).toBe(
      'claude mcp add --transport http pi-dashboard http://localhost:8000/mcp --header "Authorization: Bearer tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
    );
  });

  it("the token is not retrievable after dismissal", async () => {
    // The dismissal triggers a reload; make the assertion DISCRIMINATING:
    // the first list call returns only the pairing row, the reload call
    // brings the minted manual row.
    listPairedDevices
      .mockReset()
      .mockResolvedValueOnce([PAIRING_ROW])
      .mockResolvedValueOnce([PAIRING_ROW, MANUAL_ROW]);
    await openCreateFlow();
    expect(listPairedDevices).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    // Panel gone, token gone from the document.
    expect(screen.queryByText(MINTED_TOKEN)).toBeNull();
    expect(document.body.textContent).not.toContain(MINTED_TOKEN);
    // The list has refreshed with the new manual row.
    await waitFor(() => expect(screen.getAllByText("manual")).toHaveLength(1));
    expect(listPairedDevices).toHaveBeenCalledTimes(2);
  });

  it("an API failure surfaces as an error, not a token panel", async () => {
    createPairedDevice.mockRejectedValue(new Error("operator credential required"));
    render(<PairedDevicesSection />);
    await screen.findByText("My iPhone");
    fireEvent.click(screen.getByText("Create token for an MCP client"));
    const input = await screen.findByLabelText("Token label");
    fireEvent.change(input, { target: { value: "claude-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("operator credential required");
    expect(document.body.textContent).not.toContain(MINTED_TOKEN);
  });
});


// ── F1–F5 (test-plan expand-mcp-tiered-surface) ───────────────────────────

describe("F1 — tier picker defaults to observe and warns on operate", () => {
  it("observe is preselected; choosing operate shows the restart warning; no snippet yet", async () => {
    reachableUrls.mockResolvedValue([window.location.origin]);
    render(<PairedDevicesSection />);
    await screen.findByText("My iPhone");
    fireEvent.click(screen.getByText("Create token for an MCP client"));
    const form = await screen.findByTestId("create-token-form");

    const observe = form.querySelector('input[value="observe"]') as HTMLInputElement;
    const operate = form.querySelector('input[value="operate"]') as HTMLInputElement;
    expect(observe.checked).toBe(true);
    expect(screen.queryByTestId("operate-warning")).toBeNull();

    fireEvent.click(operate);
    expect(screen.getByTestId("operate-warning").textContent).toMatch(/restart/i);
    // The snippet only exists in the result stage.
    expect(screen.queryByText(/claude mcp add/)).toBeNull();
  });
});

describe("F2 — base-URL select", () => {
  it("preselects the browser origin and lists the reachable URLs", async () => {
    reachableUrls.mockResolvedValue([window.location.origin, "https://x.share.zrok.io"]);
    render(<PairedDevicesSection />);
    await screen.findByText("My iPhone");
    fireEvent.click(screen.getByText("Create token for an MCP client"));
    const select = (await screen.findByLabelText("Reachable at")) as HTMLSelectElement;
    expect(select.value).toBe(window.location.origin);
    expect(select.querySelectorAll("option")).toHaveLength(2);
  });
});

describe("F3 — snippet uses the chosen tier + base, token shown once", () => {
  it("control + zrok base → snippet targets the tunnel with Bearer tok_123", async () => {
    const minted = {
      device: { ...MANUAL_ROW, tier: "control" as const },
      token: "tok_123",
    };
    createPairedDevice.mockResolvedValue(minted);
    reachableUrls.mockResolvedValue([window.location.origin, "https://x.share.zrok.io"]);
    render(<PairedDevicesSection />);
    await screen.findByText("My iPhone");
    fireEvent.click(screen.getByText("Create token for an MCP client"));
    const form = await screen.findByTestId("create-token-form");
    fireEvent.change(screen.getByLabelText("Token label"), { target: { value: "cursor" } });
    fireEvent.click(form.querySelector('input[value="control"]') as HTMLInputElement);
    fireEvent.change(screen.getByLabelText("Reachable at"), {
      target: { value: "https://x.share.zrok.io" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText("tok_123");
    expect(createPairedDevice).toHaveBeenCalledWith("cursor", "control");
    const snippet = screen.getByText(/claude mcp add/) as HTMLElement;
    expect(snippet.textContent).toContain("https://x.share.zrok.io/mcp");
    expect(snippet.textContent).toContain("Bearer tok_123");
    // The token element's exact text appears once (the snippet is a longer string).
    expect(screen.getAllByText("tok_123")).toHaveLength(1);
  });
});

describe("F4 — token not shown again", () => {
  it("after dismiss and reopen no tok_123 remains", async () => {
    createPairedDevice.mockResolvedValue({ device: MANUAL_ROW, token: "tok_123" });
    reachableUrls.mockResolvedValue([window.location.origin]);
    render(<PairedDevicesSection />);
    await screen.findByText("My iPhone");
    fireEvent.click(screen.getByText("Create token for an MCP client"));
    await screen.findByTestId("create-token-form");
    fireEvent.change(screen.getByLabelText("Token label"), { target: { value: "cursor" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("tok_123");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(document.body.textContent).not.toContain("tok_123");

    fireEvent.click(screen.getByText("Create token for an MCP client"));
    await screen.findByTestId("create-token-form");
    expect(document.body.textContent).not.toContain("tok_123");
  });
});

describe("F5 — tier badge on every row", () => {
  it("each row shows its tier text", async () => {
    listPairedDevices.mockResolvedValue([
      { ...PAIRING_ROW, id: "d-o", tier: "observe" as const },
      { ...MANUAL_ROW, id: "d-p", tier: "operate" as const },
    ]);
    render(<PairedDevicesSection />);
    await screen.findByText("My iPhone");
    // Names come from TIER_OPTIONS (Observe / Control / Operate). See change: device-key-mutual-check (F4).
    expect(screen.getByTestId("tier-d-o").textContent).toBe("Observe");
    expect(screen.getByTestId("tier-d-p").textContent).toBe("Operate");
  });
});


// ── F7 (test-plan prove-vault-bridge-tls): the "Bridge on another machine" purpose ──

describe("F7 — bridge purpose in the token-issue dialog", () => {
  const TLS_URL = "https://dash.example.ts.net:8443";
  const BRIDGE_TOKEN = "pi_tls_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const bridgeRadio = () => screen.getByLabelText(/Bridge on another machine/) as HTMLInputElement;

  async function openDialog() {
    render(<PairedDevicesSection />);
    await screen.findByText("My iPhone");
    fireEvent.click(screen.getByText("Create token for an MCP client"));
    await screen.findByTestId("create-token-form");
  }

  it("(a) proven channel + Accept bridges on + reachable bind: issues a pi_tls_ token with the wss snippet", async () => {
    getBridgeTokenContext.mockResolvedValue({ httpsChannel: true, tlsListenerUrls: [TLS_URL], acceptBridges: true });
    createPairedDevice.mockResolvedValue({ device: { ...MANUAL_ROW, tier: "operate" as const }, token: BRIDGE_TOKEN });
    await openDialog();
    await waitFor(() => expect(bridgeRadio().disabled).toBe(false));
    fireEvent.click(bridgeRadio());
    fireEvent.change(screen.getByLabelText("Token label"), { target: { value: "laptop" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await screen.findByText(BRIDGE_TOKEN);
    // Bridge forces the operate tier and sends the purpose.
    expect(createPairedDevice).toHaveBeenCalledWith("laptop", "operate", "bridge");
    expect(BRIDGE_TOKEN).toMatch(/^pi_tls_/);
    const snippet = screen.getByTestId("bridge-token-snippet");
    expect(snippet.textContent).toContain("PI_DASHBOARD_URL=wss://dash.example.ts.net:8443");
    expect(snippet.textContent).toContain(`PI_DASHBOARD_TOKEN=${BRIDGE_TOKEN}`);
    // The MCP snippet is not shown for a bridge token.
    expect(screen.queryByText(/claude mcp add/)).toBeNull();
  });

  it("(a') Accept bridges off: the token shows with the switch-on remedy and no PI_DASHBOARD_URL line", async () => {
    getBridgeTokenContext.mockResolvedValue({ httpsChannel: true, tlsListenerUrls: [TLS_URL], acceptBridges: false });
    createPairedDevice.mockResolvedValue({ device: { ...MANUAL_ROW, tier: "operate" as const }, token: BRIDGE_TOKEN });
    await openDialog();
    await waitFor(() => expect(bridgeRadio().disabled).toBe(false));
    fireEvent.click(bridgeRadio());
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText(BRIDGE_TOKEN);
    expect(screen.queryByTestId("bridge-token-snippet")).toBeNull();
    expect(screen.getByTestId("bridge-token-note").textContent).toContain("Accept bridges");
    expect(document.body.textContent).not.toContain("PI_DASHBOARD_URL=");
  });

  it("(b) plain HTTP + a TLS listener: purpose disabled and the HTTPS address is shown", async () => {
    getBridgeTokenContext.mockResolvedValue({ httpsChannel: false, tlsListenerUrls: [TLS_URL], acceptBridges: true });
    await openDialog();
    await waitFor(() => expect(screen.getByTestId("bridge-unavailable")).toBeTruthy());
    expect(bridgeRadio().disabled).toBe(true);
    const box = screen.getByTestId("bridge-unavailable");
    expect(box.textContent).toContain(TLS_URL);
    expect(box.textContent).toMatch(/not vault-eligible/i);
    expect(within(box).queryByText(/Turn on Built-in HTTPS/)).toBeNull();
    // jsdom toggles a disabled radio on a synthetic click; the state that matters is that the purpose did not switch.
    fireEvent.click(bridgeRadio());
    expect(screen.queryByTestId("bridge-tier-note")).toBeNull();
    expect(screen.getByTestId("create-token-form").querySelector('input[value="observe"]')).not.toBeNull();
  });

  it("(c) plain HTTP, no TLS URL: purpose disabled with the Built-in HTTPS link", async () => {
    await openDialog();
    await waitFor(() => expect(screen.getByTestId("bridge-unavailable")).toBeTruthy());
    expect(bridgeRadio().disabled).toBe(true);
    const link = within(screen.getByTestId("bridge-unavailable")).getByRole("link", { name: /Turn on Built-in HTTPS to issue bridge tokens/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/settings/gateway#gateway-built-in-https");
  });

  it("the MCP purpose flow is unchanged in every case: two arguments, no purpose", async () => {
    for (const ctx of [
      { httpsChannel: true, tlsListenerUrls: [TLS_URL], acceptBridges: true },
      { httpsChannel: false, tlsListenerUrls: [TLS_URL], acceptBridges: true },
      { httpsChannel: false, tlsListenerUrls: [], acceptBridges: false },
    ]) {
      cleanup();
      createPairedDevice.mockClear();
      createPairedDevice.mockResolvedValue(MINTED);
      getBridgeTokenContext.mockResolvedValue(ctx);
      await openDialog();
      expect((screen.getByLabelText(/MCP client/) as HTMLInputElement).checked).toBe(true);
      fireEvent.change(screen.getByLabelText("Token label"), { target: { value: "claude-code" } });
      fireEvent.click(screen.getByRole("button", { name: "Create" }));
      await screen.findByText(MINTED.token);
      expect(createPairedDevice).toHaveBeenCalledWith("claude-code", "observe");
      expect(MINTED.token.startsWith("pi_tls_")).toBe(false);
      expect(screen.getByText(/claude mcp add/)).toBeTruthy();
      expect(screen.queryByTestId("bridge-token-snippet")).toBeNull();
    }
  });

  it("a server refusal (bridge_token_requires_https) shows the reason and the HTTPS address", async () => {
    getBridgeTokenContext.mockResolvedValue({ httpsChannel: true, tlsListenerUrls: [], acceptBridges: true });
    createPairedDevice.mockRejectedValue(Object.assign(new Error("bridge_token_requires_https"), { code: "bridge_token_requires_https", httpsUrl: TLS_URL }));
    await openDialog();
    await waitFor(() => expect(bridgeRadio().disabled).toBe(false));
    fireEvent.click(bridgeRadio());
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const err = await screen.findByTestId("bridge-refused");
    expect(err.textContent).toContain(TLS_URL);
    expect(document.body.textContent).not.toContain("pi_tls_");
  });

  it("text in the purpose block stays at 12 px or larger", async () => {
    await openDialog();
    await waitFor(() => expect(screen.getByTestId("bridge-unavailable")).toBeTruthy());
    expect(screen.getByTestId("create-token-form").innerHTML).not.toMatch(/text-\[(?:\d|1[01])(?:\.\d+)?px\]/);
  });
});

// ── F4 (test-plan, device-key-mutual-check): key + companion columns, held revoke, operator-only ──

describe("F4 — device key, status checks, revoke notice, revoked list", () => {
  const DAY = 86_400_000;
  const KEYED = {
    id: "dev-k",
    label: "Roberts-MacBook",
    createdAt: "2026-08-01T00:00:00.000Z",
    lastSeen: null,
    source: "pairing" as const,
    tier: "control" as const,
    keyId: "dk:AbCdEfGhIjKl",
    companions: [{ id: "dk:ZZZZZZZZZZZZ", origin: "http://192.168.16.31:8000", createdAt: 1 }],
  };
  const KEYLESS = PAIRING_ROW;
  const revoked = (over: Record<string, unknown> = {}) => ({
    ...KEYLESS,
    id: "dev-r",
    label: "Old phone",
    revokedAt: Date.now(),
    revokedBy: "local",
    ...over,
  });
  const asOperator = (devices: unknown[] = [], unreadable = false) =>
    listRevokedDevices.mockResolvedValue({ operator: true, devices, unreadable });
  const NOT_OPERATOR = { operator: false };
  const LOST_STOLEN =
    "Undo only if you revoked by mistake. If the device was lost or stolen, leave it revoked: undo makes its saved access work again.";

  afterEach(() => vi.useRealTimers());

  it("Device key column: short id, or 'none yet' for a keyless device; no raw i18n keys render", async () => {
    listPairedDevices.mockResolvedValue([KEYED, KEYLESS]);
    const { container } = render(<PairedDevicesSection />);
    await screen.findByText("Roberts-MacBook");
    expect(screen.getByTestId("device-key-dev-k").textContent).toContain("dk:AbCdEfGhIjKl");
    expect(screen.getByTestId("device-key-dev-1").textContent).toContain("none yet");
    expect(container.textContent).not.toMatch(/\b(pairedDevices|common|settings)\.[a-zA-Z]+/);
  });

  it("'Status checks from' lists the companion origin as text with its own remove control", async () => {
    listPairedDevices.mockResolvedValue([KEYED, KEYLESS]);
    render(<PairedDevicesSection />);
    await screen.findByText("Roberts-MacBook");
    const cell = screen.getByTestId("companions-dev-k");
    expect(cell.textContent).toContain("Status checks from");
    expect(cell.textContent).toContain("http://192.168.16.31:8000");
    expect(screen.getByTestId("companions-dev-1").textContent).toContain("none");
    listPairedDevices.mockResolvedValue([{ ...KEYED, companions: [] }, KEYLESS]);
    fireEvent.click(within(cell).getByRole("button", { name: "Remove status check from http://192.168.16.31:8000" }));
    await waitFor(() => expect(removeCompanion).toHaveBeenCalledWith("dev-k", "dk:ZZZZZZZZZZZZ"));
    await waitFor(() => expect(screen.getByTestId("companions-dev-k").textContent).not.toContain("192.168.16.31"));
  });

  it("a hostile companion origin renders as text, never markup", async () => {
    listPairedDevices.mockResolvedValue([{ ...KEYED, companions: [{ id: "dk:X", origin: "http://a<b>.example", createdAt: 1 }] }]);
    render(<PairedDevicesSection />);
    await screen.findByText("Roberts-MacBook");
    const cell = screen.getByTestId("companions-dev-k");
    expect(cell.querySelector("b")).toBeNull();
    expect(cell.textContent).toContain("http://a<b>.example");
  });

  it("tier badges use the Observe / Control / Operate names", async () => {
    listPairedDevices.mockResolvedValue([KEYED, KEYLESS, MANUAL_ROW]);
    render(<PairedDevicesSection />);
    await screen.findByText("Roberts-MacBook");
    expect(screen.getByTestId("tier-dev-k").textContent).toBe("Control");
    expect(screen.getByTestId("tier-dev-1").textContent).toBe("Operate");
    expect(screen.getByTestId("tier-dev-2").textContent).toBe("Observe");
  });

  async function revokeKeyless() {
    listPairedDevices.mockResolvedValueOnce([KEYLESS]).mockResolvedValue([]);
    listRevokedDevices.mockResolvedValueOnce({ operator: true, devices: [], unreadable: false });
    render(<PairedDevicesSection />);
    await screen.findByText("My iPhone");
    listRevokedDevices.mockResolvedValue({ operator: true, devices: [revoked({ label: "My iPhone", id: "dev-1" })], unreadable: false });
    fireEvent.click(screen.getByTitle("Revoke device"));
    fireEvent.click(screen.getByText("Confirm revoke"));
    return screen.findByTestId("revoke-notice-dev-1");
  }

  it("revoke shows '<name> revoked' with Undo for exactly 10 s: present at 9.9 s, gone at 10 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    listPairedDevices.mockResolvedValueOnce([KEYLESS]).mockResolvedValue([]);
    render(<PairedDevicesSection />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByTitle("Revoke device"));
    await act(async () => { fireEvent.click(screen.getByText("Confirm revoke")); await vi.advanceTimersByTimeAsync(0); });
    const notice = screen.getByTestId("revoke-notice-dev-1");
    expect(notice.textContent).toContain("My iPhone revoked");
    expect(within(notice).getByRole("button", { name: "Undo" })).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(9_900); });
    expect(screen.queryByTestId("revoke-notice-dev-1")).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.queryByTestId("revoke-notice-dev-1")).toBeNull();
  });

  it("Undo at 9.9 s restores the device and removes the notice", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    listPairedDevices.mockResolvedValueOnce([KEYLESS]).mockResolvedValue([]);
    render(<PairedDevicesSection />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByTitle("Revoke device"));
    await act(async () => { fireEvent.click(screen.getByText("Confirm revoke")); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(9_900); });
    listPairedDevices.mockResolvedValue([KEYLESS]);
    await act(async () => { fireEvent.click(within(screen.getByTestId("revoke-notice-dev-1")).getByRole("button", { name: "Undo" })); await vi.advanceTimersByTimeAsync(0); });
    expect(restorePairedDevice).toHaveBeenCalledWith("dev-1");
    expect(screen.queryByTestId("revoke-notice-dev-1")).toBeNull();
    // the timer of the dismissed notice must not fire anything later
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByText("My iPhone")).toBeTruthy();
  });

  it("Undo on the notice answered 'unavailable' shows 'No longer available' and refreshes", async () => {
    restorePairedDevice.mockResolvedValue("unavailable");
    const notice = await revokeKeyless();
    const callsBefore = listPairedDevices.mock.calls.length;
    fireEvent.click(within(notice).getByRole("button", { name: "Undo" }));
    await screen.findByText("No longer available");
    await waitFor(() => expect(listPairedDevices.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("revoked list: name, who/when, 'Deleted for good in 90 days', Undo revoke, Delete now and the exact warning", async () => {
    asOperator([revoked({ revokedAt: Date.now() })]);
    render(<PairedDevicesSection />);
    const list = await screen.findByTestId("revoked-devices");
    expect(list.textContent).toContain("Revoked devices");
    const row = within(list).getByTestId("revoked-dev-r");
    expect(row.textContent).toContain("Old phone");
    expect(row.textContent).toContain("local");
    expect(row.textContent).toContain("Deleted for good in 90 days");
    expect(within(row).getByRole("button", { name: "Undo revoke" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Delete now" })).toBeTruthy();
    expect(screen.getByTestId("revoked-lost-warning").textContent).toBe(LOST_STOLEN);
    expect(screen.queryByTestId("revoked-unreadable")).toBeNull();
  });

  it("N days rounds up: 89 d 12 h left → 90 days, 24 h or more → N days, under 24 h → 1 day (singular)", async () => {
    asOperator([
      revoked({ id: "a", label: "A", revokedAt: Date.now() - 0.5 * DAY }),
      revoked({ id: "b", label: "B", revokedAt: Date.now() - 89.5 * DAY }),
      revoked({ id: "c", label: "C", revokedAt: Date.now() - 60 * DAY }),
    ]);
    render(<PairedDevicesSection />);
    await screen.findByTestId("revoked-devices");
    expect(screen.getByTestId("revoked-a").textContent).toContain("Deleted for good in 90 days");
    expect(screen.getByTestId("revoked-b").textContent).toContain("Deleted for good in 1 day");
    expect(screen.getByTestId("revoked-b").textContent).not.toContain("1 days");
    expect(screen.getByTestId("revoked-c").textContent).toContain("Deleted for good in 30 days");
  });

  it("Undo revoke restores and refreshes both lists", async () => {
    asOperator([revoked()]);
    render(<PairedDevicesSection />);
    const row = await screen.findByTestId("revoked-dev-r");
    asOperator([]);
    fireEvent.click(within(row).getByRole("button", { name: "Undo revoke" }));
    await waitFor(() => expect(restorePairedDevice).toHaveBeenCalledWith("dev-r"));
    await waitFor(() => expect(screen.queryByTestId("revoked-dev-r")).toBeNull());
  });

  it.each(["unavailable"] as const)("Undo revoke answered %s shows 'No longer available' and refreshes the lists", async () => {
    asOperator([revoked()]);
    restorePairedDevice.mockResolvedValue("unavailable");
    render(<PairedDevicesSection />);
    const row = await screen.findByTestId("revoked-dev-r");
    const before = listRevokedDevices.mock.calls.length;
    asOperator([]);
    fireEvent.click(within(row).getByRole("button", { name: "Undo revoke" }));
    await screen.findByText("No longer available");
    await waitFor(() => expect(listRevokedDevices.mock.calls.length).toBeGreaterThan(before));
  });

  it("Delete now opens a confirm dialog naming the device and deletes nothing until confirmed", async () => {
    asOperator([revoked()]);
    render(<PairedDevicesSection />);
    const row = await screen.findByTestId("revoked-dev-r");
    fireEvent.click(within(row).getByRole("button", { name: "Delete now" }));
    const dialog = await screen.findByTestId("delete-revoked-confirm");
    expect(dialog.textContent).toContain("Old phone");
    expect(deleteRevokedDevice).not.toHaveBeenCalled();
    // cancel: nothing deleted
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("delete-revoked-confirm")).toBeNull());
    expect(deleteRevokedDevice).not.toHaveBeenCalled();
    // confirm: deleted
    fireEvent.click(within(screen.getByTestId("revoked-dev-r")).getByRole("button", { name: "Delete now" }));
    asOperator([]);
    fireEvent.click(within(await screen.findByTestId("delete-revoked-confirm")).getByRole("button", { name: "Delete now" }));
    await waitFor(() => expect(deleteRevokedDevice).toHaveBeenCalledWith("dev-r"));
    await waitFor(() => expect(screen.queryByTestId("revoked-dev-r")).toBeNull());
  });

  it("Delete now answered 'unavailable' shows 'No longer available' and refreshes", async () => {
    asOperator([revoked()]);
    deleteRevokedDevice.mockResolvedValue("unavailable");
    render(<PairedDevicesSection />);
    fireEvent.click(within(await screen.findByTestId("revoked-dev-r")).getByRole("button", { name: "Delete now" }));
    asOperator([]);
    fireEvent.click(within(await screen.findByTestId("delete-revoked-confirm")).getByRole("button", { name: "Delete now" }));
    await screen.findByText("No longer available");
  });

  it("unreadable store: warning shows, also when the revoked list is empty; absent otherwise", async () => {
    asOperator([], true);
    render(<PairedDevicesSection />);
    expect((await screen.findByTestId("revoked-unreadable")).textContent).toBe(
      "Revoked-device list unreadable — revoked devices may be purged early",
    );
    cleanup();
    asOperator([], false);
    render(<PairedDevicesSection />);
    await screen.findByText("My iPhone");
    expect(screen.queryByTestId("revoked-unreadable")).toBeNull();
    expect(screen.queryByTestId("revoked-devices")).toBeNull();
  });

  it("a viewer without an operator credential gets no Revoke, Undo revoke, Delete now or companion-remove control", async () => {
    listRevokedDevices.mockResolvedValue(NOT_OPERATOR);
    listPairedDevices.mockResolvedValue([KEYED, KEYLESS]);
    render(<PairedDevicesSection />);
    await screen.findByText("Roberts-MacBook");
    expect(screen.queryByTitle("Revoke device")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remove status check/ })).toBeNull();
    expect(screen.queryByTestId("revoked-devices")).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo revoke" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete now" })).toBeNull();
    // the read-only columns are still shown
    expect(screen.getByTestId("device-key-dev-k").textContent).toContain("dk:AbCdEfGhIjKl");
    expect(screen.getByTestId("companions-dev-k").textContent).toContain("http://192.168.16.31:8000");
  });

  it("an operator sees every control", async () => {
    asOperator([revoked()]);
    listPairedDevices.mockResolvedValue([KEYED, KEYLESS]);
    render(<PairedDevicesSection />);
    await screen.findByTestId("revoked-devices");
    expect(screen.getAllByTitle("Revoke device")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Remove status check/ })).toBeTruthy();
  });

  it("a failing revoked-list call hides the controls (fail closed) but never the paired list", async () => {
    listRevokedDevices.mockRejectedValue(new Error("boom"));
    render(<PairedDevicesSection />);
    await screen.findByText("My iPhone");
    expect(screen.queryByTitle("Revoke device")).toBeNull();
  });
});
