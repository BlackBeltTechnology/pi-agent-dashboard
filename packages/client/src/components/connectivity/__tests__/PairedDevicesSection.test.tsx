/**
 * F4 (test-plan, mcp-legacy-clients-and-token-issuance): pairing rows render
 * unchanged, manual rows get exactly one badge, and the create-token flow
 * shows the token + snippet once and clears on dismiss.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../../../lib/api/api-context.js";
import { PairedDevicesSection } from "../PairedDevicesSection.js";

const { listPairedDevices, revokePairedDevice, createPairedDevice } = vi.hoisted(() => ({
  listPairedDevices: vi.fn(),
  revokePairedDevice: vi.fn(),
  createPairedDevice: vi.fn(),
}));

vi.mock("../../../lib/pairing/paired-devices-api.js", () => ({
  listPairedDevices,
  revokePairedDevice,
  createPairedDevice,
}));

const PAIRING_ROW = {
  id: "dev-1",
  label: "My iPhone",
  createdAt: "2026-08-01T00:00:00.000Z",
  lastSeen: null,
  source: "pairing" as const,
};
const MANUAL_ROW = {
  id: "dev-2",
  label: "claude-code",
  createdAt: "2026-08-02T00:00:00.000Z",
  lastSeen: null,
  source: "manual" as const,
};
const MINTED = { device: MANUAL_ROW, token: "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };

beforeEach(() => {
  listPairedDevices.mockReset().mockResolvedValue([PAIRING_ROW, MANUAL_ROW]);
  revokePairedDevice.mockReset().mockResolvedValue(undefined);
  createPairedDevice.mockReset().mockResolvedValue(MINTED);
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

    expect(createPairedDevice).toHaveBeenCalledWith("claude-code");
    // The token is shown.
    expect(screen.getByText(MINTED_TOKEN)).toBeTruthy();
    // The snippet is copy-ready and embeds the same token.
    const snippet = screen.getByText(/claude mcp add/) as HTMLElement;
    expect(snippet.textContent).toBe(
      'claude mcp add --transport http pi-dashboard http://localhost:8000/mcp --header "Authorization: Bearer tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
    );
  });

  it("the token is not retrievable after dismissal", async () => {
    await openCreateFlow();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    // Panel gone, token gone from the document.
    expect(screen.queryByText(MINTED_TOKEN)).toBeNull();
    expect(document.body.textContent).not.toContain(MINTED_TOKEN);
    // The list has refreshed with the new manual row.
    await waitFor(() => expect(screen.getAllByText("manual")).toHaveLength(1));
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

const MINTED_TOKEN = "tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
