import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { QrCodeDialog } from "../QrCodeDialog.js";

// Mock qrcode — avoid canvas rendering in jsdom
vi.mock("qrcode", () => ({
  default: { toCanvas: vi.fn() },
}));

afterEach(cleanup);

describe("QrCodeDialog", () => {
  const url = "https://abc123.share.zrok.io";

  it("renders the tunnel URL", () => {
    render(<QrCodeDialog url={url} connected={true} onClose={() => {}} />);
    expect(screen.getByTestId("qr-url").textContent).toBe(url);
  });

  it("renders a canvas for the QR code", () => {
    render(<QrCodeDialog url={url} connected={true} onClose={() => {}} />);
    expect(screen.getByTestId("qr-canvas")).toBeDefined();
  });

  it("calls onClose when overlay clicked", () => {
    const onClose = vi.fn();
    render(<QrCodeDialog url={url} connected={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("qr-dialog-overlay"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(<QrCodeDialog url={url} connected={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders a copy button", () => {
    render(<QrCodeDialog url={url} connected={true} onClose={() => {}} />);
    expect(screen.getByTestId("qr-copy-btn")).toBeDefined();
  });
});
