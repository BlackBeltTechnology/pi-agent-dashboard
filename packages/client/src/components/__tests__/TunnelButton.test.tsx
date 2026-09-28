import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TunnelButton } from "../connectivity/TunnelButton.js";

const navigateFn = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/", navigateFn],
}));

// The Gateway dialog fetches config/endpoints/pair payload on open; stub the
// child so this unit test stays focused on the button's open/navigate logic.
vi.mock("../Gateway/GatewayDialog.js", () => ({
  GatewayDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="gateway-dialog-overlay">
      <button type="button" data-testid="gateway-dialog-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigateFn.mockReset();
});

function mockFetch(status: "active" | "inactive" | "unavailable", url?: string) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ status, url, serverOs: "darwin" }),
  } as Response);
}

describe("TunnelButton (Gateway)", () => {
  it("renders the button", () => {
    render(<TunnelButton />);
    expect(screen.getByTestId("tunnel-btn")).toBeDefined();
  });

  it("navigates to the Gateway settings page when unavailable", async () => {
    mockFetch("unavailable");
    render(<TunnelButton />);
    fireEvent.click(screen.getByTestId("tunnel-btn"));
    await waitFor(() => {
      expect(navigateFn).toHaveBeenCalledWith("/settings/gateway");
    });
  });

  it("opens the Gateway dialog when inactive", async () => {
    mockFetch("inactive");
    render(<TunnelButton />);
    fireEvent.click(screen.getByTestId("tunnel-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("gateway-dialog-overlay")).toBeDefined();
    });
  });

  it("opens the Gateway dialog when active", async () => {
    mockFetch("active", "https://example.zrok.io");
    render(<TunnelButton />);
    fireEvent.click(screen.getByTestId("tunnel-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("gateway-dialog-overlay")).toBeDefined();
    });
  });
});

describe("TunnelButton reflects ALL providers", () => {
  function mockGateway(status: string, gateway: { connected: number; expected: number }) {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status, serverOs: "darwin", gateway }),
    } as Response);
  }

  it("partial (zrok down, tailscale up) → amber with the count", async () => {
    mockGateway("inactive", { connected: 1, expected: 2 });
    render(<TunnelButton />);
    await waitFor(() => expect(screen.getByTestId("tunnel-btn").getAttribute("data-tone")).toBe("partial"));
    expect(screen.getByTestId("tunnel-btn").title).toBe("Gateway: 1/2 connected (click to open)");
  });

  it("tailscale-only up with zrok missing opens the dialog, not the setup page", async () => {
    mockGateway("unavailable", { connected: 1, expected: 1 });
    render(<TunnelButton />);
    fireEvent.click(screen.getByTestId("tunnel-btn"));
    await waitFor(() => expect(screen.getByTestId("gateway-dialog-overlay")).toBeDefined());
    expect(navigateFn).not.toHaveBeenCalled();
  });
});
