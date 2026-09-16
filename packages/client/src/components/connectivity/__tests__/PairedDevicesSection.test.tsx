/**
 * F4 (test-plan, mcp-legacy-clients-and-token-issuance): pairing rows render
 * unchanged, manual rows get exactly one badge, and the create-token flow
 * shows the token + snippet once and clears on dismiss.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../../../lib/api/api-context.js";
import { PairedDevicesSection } from "../PairedDevicesSection.js";

const { listPairedDevices, revokePairedDevice, createPairedDevice, reachableUrls } = vi.hoisted(() => ({
  listPairedDevices: vi.fn(),
  revokePairedDevice: vi.fn(),
  createPairedDevice: vi.fn(),
  reachableUrls: vi.fn(),
}));

vi.mock("../../../lib/pairing/paired-devices-api.js", () => ({
  listPairedDevices,
  revokePairedDevice,
  createPairedDevice,
  reachableUrls,
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
    expect(screen.getByTestId("tier-d-o").textContent).toBe("observe");
    expect(screen.getByTestId("tier-d-p").textContent).toBe("operate");
  });
});
