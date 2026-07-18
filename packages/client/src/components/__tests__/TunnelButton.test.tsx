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
