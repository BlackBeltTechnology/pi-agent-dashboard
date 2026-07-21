import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { __resetEscapeStack } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { ImageLightbox } from "../preview/ImageLightbox.js";
import { ImagePreviewStrip } from "../preview/ImagePreviewStrip.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";
import { FilePreviewOverlay } from "../preview/FilePreviewOverlay.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  __resetEscapeStack();
});

const escape = () => fireEvent.keyDown(document, { key: "Escape" });
const lightboxEl = () =>
  document.body.querySelector("[data-testid='lightbox-backdrop']");

// ── F1 — reported case: Explore dialog + pasted-image lightbox ─────────────
describe("escape-stack integration — F1 reported case (dialog + lightbox)", () => {
  it("one Escape peels only the lightbox; a second closes the dialog", () => {
    const dialogClose = vi.fn();
    const img: ImageContent = { type: "image", data: "abc", mimeType: "image/png" };
    const { getByAltText, queryByTestId } = render(
      <Dialog open onClose={dialogClose} testId="explore">
        <ImagePreviewStrip images={[img]} error={null} onRemove={() => {}} />
      </Dialog>,
    );

    // Open the lightbox by clicking the thumbnail.
    fireEvent.click(getByAltText("Attachment 1"));
    expect(lightboxEl()).not.toBeNull();

    // First Escape: lightbox unmounts, dialog stays, dialog onClose NOT called.
    escape();
    expect(lightboxEl()).toBeNull();
    expect(queryByTestId("explore")).not.toBeNull();
    expect(dialogClose).not.toHaveBeenCalled();

    // Second Escape: dialog is now topmost → its onClose fires.
    escape();
    expect(dialogClose).toHaveBeenCalledTimes(1);
  });
});

// ── F2 — markdown-dialog + lightbox (PackageReadme / WhatsNew class) ────────
describe("escape-stack integration — F2 markdown dialog + lightbox", () => {
  it("one Escape closes the lightbox; the dialog stays open", () => {
    const dialogClose = vi.fn();
    const { container, queryByTestId } = render(
      <ThemeProvider>
        <Dialog open onClose={dialogClose} testId="readme">
          <MarkdownContent content={"![pic](https://example.com/a.png)"} />
        </Dialog>
      </ThemeProvider>,
    );

    const img = container.querySelector("img") ?? document.body.querySelector("img");
    fireEvent.click(img!);
    expect(lightboxEl()).not.toBeNull();

    escape();
    expect(lightboxEl()).toBeNull();
    expect(queryByTestId("readme")).not.toBeNull();
    expect(dialogClose).not.toHaveBeenCalled();
  });
});

// ── F3 — overlay-on-overlay: file preview (base) + lightbox (top) ──────────
describe("escape-stack integration — F3 overlay-on-overlay", () => {
  function Stack({ previewClose }: { previewClose: () => void }) {
    const [lightbox, setLightbox] = useState(true);
    return (
      <ThemeProvider>
        <FilePreviewOverlay cwd="/repo" path="notes.txt" onClose={previewClose} />
        {lightbox && (
          <ImageLightbox src="data:image/png;base64,x" alt="pic" onClose={() => setLightbox(false)} />
        )}
      </ThemeProvider>
    );
  }

  it("first Escape closes the lightbox; the preview stays; second closes preview", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { type: "file", content: "x\n" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as any,
    );
    const previewClose = vi.fn();
    render(<Stack previewClose={previewClose} />);
    await waitFor(() =>
      expect(document.querySelector("[data-testid='file-preview-overlay']")).not.toBeNull(),
    );
    expect(lightboxEl()).not.toBeNull();

    // First Escape: lightbox (registered last → topmost) closes; preview stays.
    escape();
    expect(lightboxEl()).toBeNull();
    expect(previewClose).not.toHaveBeenCalled();

    // Second Escape: preview is now topmost → its onClose fires.
    escape();
    expect(previewClose).toHaveBeenCalledTimes(1);
  });
});

// ── F4 — React stopPropagation opt-out (open combobox in a dialog) ─────────
describe("escape-stack integration — F4 combobox opt-out", () => {
  function Combobox() {
    const [open, setOpen] = useState(true);
    return (
      <input
        data-testid="combo"
        onKeyDown={(e) => {
          // An OPEN combobox consumes Escape for itself (closes the popup) and
          // opts out of the modal stack by stopping the event before `document`.
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
    );
  }

  it("first Escape closes the combobox (dialog stays); second closes the dialog", () => {
    const dialogClose = vi.fn();
    const { getByTestId } = render(
      <Dialog open onClose={dialogClose} testId="dlg">
        <Combobox />
      </Dialog>,
    );
    const combo = getByTestId("combo");

    // First Escape while the combobox is open → consumed by the child, dialog stays.
    fireEvent.keyDown(combo, { key: "Escape" });
    expect(dialogClose).not.toHaveBeenCalled();

    // Second Escape: combobox is closed and no longer opts out → dialog dismisses.
    fireEvent.keyDown(combo, { key: "Escape" });
    expect(dialogClose).toHaveBeenCalledTimes(1);
  });
});

// ── F6 — parity: Escape in a plain textarea still closes the dialog ────────
describe("escape-stack integration — F6 textarea parity", () => {
  it("Escape in a dialog's plain textarea (no opt-out) closes the dialog", () => {
    const dialogClose = vi.fn();
    const { getByTestId } = render(
      <Dialog open onClose={dialogClose} testId="dlg">
        <textarea data-testid="ta" />
      </Dialog>,
    );
    fireEvent.keyDown(getByTestId("ta"), { key: "Escape" });
    expect(dialogClose).toHaveBeenCalledTimes(1);
  });
});

// ── X1 — migrated surface deletes its old listener (no double-fire) ────────
describe("escape-stack integration — X1 no double-fire", () => {
  it("a lone migrated Dialog fires onClose exactly once on Escape", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} testId="d">
        <p>x</p>
      </Dialog>,
    );
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
