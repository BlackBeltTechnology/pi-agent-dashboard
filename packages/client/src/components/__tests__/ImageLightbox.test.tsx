import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { ImageLightbox } from "../preview/ImageLightbox.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe("ImageLightbox", () => {
  it("renders the image at full size", () => {
    render(
      <ImageLightbox src="data:image/png;base64,abc123" alt="test image" onClose={vi.fn()} />
    );
    const img = document.body.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("data:image/png;base64,abc123");
    expect(img!.getAttribute("alt")).toBe("test image");
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<ImageLightbox src="data:image/png;base64,abc" alt="test" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", async () => {
    const onClose = vi.fn();
    await act(async () => {
      render(
        <ImageLightbox src="data:image/png;base64,abc" alt="test" onClose={onClose} />
      );
    });
    const backdrop = document.body.querySelector("[data-testid='lightbox-backdrop']");
    expect(backdrop).not.toBeNull();
    await act(async () => {
      backdrop!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when image is clicked", () => {
    const onClose = vi.fn();
    render(
      <ImageLightbox src="data:image/png;base64,abc" alt="test" onClose={onClose} />
    );
    const img = document.body.querySelector("img");
    fireEvent.click(img!);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// Transcript attachments open the full-resolution ORIGINAL, with the fitted
// derivative as fallback so a failed original degrades only the zoom.
// See change: fit-attachments-for-display (task 5.9b, test-plan #F6).
describe("ImageLightbox — original/fallback (F6)", () => {
  const ORIGINAL = "/api/sessions/s1/attachments/" + "a".repeat(64);
  const FITTED = "data:image/png;base64,Zml0dGVk";

  it("shows the original first when one is supplied", () => {
    render(<ImageLightbox src={ORIGINAL} alt="a" fallbackSrc={FITTED} onClose={vi.fn()} />);
    const img = document.body.querySelector("[data-testid='lightbox-image']")!;
    expect(img.getAttribute("src")).toBe(ORIGINAL);
    expect(img.getAttribute("data-degraded")).toBeNull();
  });

  it("F6: falls back to the fitted image when the original fails to load", () => {
    render(<ImageLightbox src={ORIGINAL} alt="a" fallbackSrc={FITTED} onClose={vi.fn()} />);
    let img = document.body.querySelector("[data-testid='lightbox-image']")!;
    act(() => { fireEvent.error(img); });
    img = document.body.querySelector("[data-testid='lightbox-image']")!;
    expect(img.getAttribute("src")).toBe(FITTED);
    expect(img.getAttribute("data-degraded")).toBe("true");
  });

  it("without a fallback a failed load leaves the src alone (no blank swap)", () => {
    render(<ImageLightbox src={ORIGINAL} alt="a" onClose={vi.fn()} />);
    let img = document.body.querySelector("[data-testid='lightbox-image']")!;
    act(() => { fireEvent.error(img); });
    img = document.body.querySelector("[data-testid='lightbox-image']")!;
    expect(img.getAttribute("src")).toBe(ORIGINAL);
  });
});

