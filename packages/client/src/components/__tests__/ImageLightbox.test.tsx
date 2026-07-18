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
