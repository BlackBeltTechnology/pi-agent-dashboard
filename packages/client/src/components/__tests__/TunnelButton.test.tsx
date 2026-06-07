import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { TunnelButton } from "../TunnelButton.js";

const navigateFn = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/", navigateFn],
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

describe("TunnelButton", () => {
  it("should render the tunnel button", () => {
    render(<TunnelButton />);
    expect(screen.getByTestId("tunnel-btn")).toBeDefined();
  });

  it("should navigate to setup when unavailable", async () => {
    mockFetch("unavailable");
    render(<TunnelButton />);
    fireEvent.click(screen.getByTestId("tunnel-btn"));
    await waitFor(() => {
      expect(navigateFn).toHaveBeenCalledWith("/tunnel-setup");
    });
  });

  it("should open dialog with connect button when inactive", async () => {
    mockFetch("inactive");
    render(<TunnelButton />);
    fireEvent.click(screen.getByTestId("tunnel-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qr-dialog-overlay")).toBeDefined();
      expect(screen.getByTestId("qr-connect-btn")).toBeDefined();
    });
  });

  it("should open dialog with QR code and disconnect when active", async () => {
    mockFetch("active", "https://example.zrok.io");
    render(<TunnelButton />);
    fireEvent.click(screen.getByTestId("tunnel-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qr-dialog-overlay")).toBeDefined();
      expect(screen.getByTestId("qr-disconnect-btn")).toBeDefined();
      expect(screen.getByTestId("qr-setup-btn")).toBeDefined();
      expect(screen.getByTestId("qr-canvas")).toBeDefined();
    });
  });

  it("should not show disconnect when inactive", async () => {
    mockFetch("inactive");
    render(<TunnelButton />);
    fireEvent.click(screen.getByTestId("tunnel-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qr-connect-btn")).toBeDefined();
    });
    expect(screen.queryByTestId("qr-disconnect-btn")).toBeNull();
  });

  it("should not show connect when active", async () => {
    mockFetch("active", "https://example.zrok.io");
    render(<TunnelButton />);
    fireEvent.click(screen.getByTestId("tunnel-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("qr-disconnect-btn")).toBeDefined();
    });
    expect(screen.queryByTestId("qr-connect-btn")).toBeNull();
  });
});
