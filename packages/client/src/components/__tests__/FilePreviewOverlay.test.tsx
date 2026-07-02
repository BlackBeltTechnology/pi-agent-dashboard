import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { FilePreviewOverlay } from "../FilePreviewOverlay.js";
import { ThemeProvider } from "../ThemeProvider.js";

function renderOverlay(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function mockFileFetch(content: string) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ success: true, data: { type: "file", content } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }) as any,
  );
}

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
  // jsdom lacks scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FilePreviewOverlay — syntax highlighting", () => {
  it("renders a code file with the highlighted code view", async () => {
    mockFileFetch("const x: number = 1;\n");
    const { findByTestId } = renderOverlay(
      <FilePreviewOverlay cwd="/repo" path="src/foo.ts" onClose={() => {}} />,
    );
    expect(await findByTestId("file-preview-code")).toBeTruthy();
  });

  it("unknown extension falls back to plain line-numbered text", async () => {
    mockFileFetch("line one\nline two\n");
    const { queryByTestId, getByTestId } = renderOverlay(
      <FilePreviewOverlay cwd="/repo" path="notes.unknownext" onClose={() => {}} />,
    );
    await waitFor(() => expect(getByTestId("file-preview-overlay")).toBeTruthy());
    await waitFor(() => {
      // content loaded → no highlighted code view for an undetected language
      expect(queryByTestId("file-preview-code")).toBeNull();
    });
  });

  it("markdown files render via MarkdownContent, not the code view", async () => {
    mockFileFetch("# Title\n\nbody\n");
    const { queryByTestId, getByTestId } = renderOverlay(
      <FilePreviewOverlay cwd="/repo" path="README.md" onClose={() => {}} />,
    );
    await waitFor(() => expect(getByTestId("file-preview-overlay")).toBeTruthy());
    // Overlay portals to document.body (DialogPortal), so query the document.
    await waitFor(() => expect(document.body.querySelector("h1")).toBeTruthy());
    expect(queryByTestId("file-preview-code")).toBeNull();
  });
});

// Regression for change: fix-file-preview-backdrop-blocks-composer.
// The preview is a non-blocking inspector: its dim backdrop must not capture
// pointer events (otherwise it obscures the composer send button), and clicking
// inside the composer must NOT dismiss the preview while clicking elsewhere
// outside the panel does.
describe("FilePreviewOverlay — non-blocking inspector", () => {
  it("outer overlay layer is click-through so the composer beneath stays hittable", async () => {
    mockFileFetch("x\n");
    const { findByTestId } = renderOverlay(
      <FilePreviewOverlay cwd="/repo" path="notes.txt" onClose={() => {}} />,
    );
    const panel = await findByTestId("file-preview-overlay");
    const backdrop = document.querySelector('[data-testid="file-preview-backdrop"]') as HTMLElement;
    // The full-viewport wrapper is pointer-events-none, so the composer send
    // button (rendered below it) is never obscured.
    const wrapper = backdrop.parentElement as HTMLElement;
    expect(wrapper.className).toContain("pointer-events-none");
    // The dim layer (message-area only) and the panel stay interactive.
    expect(backdrop.className).toContain("pointer-events-auto");
    expect(panel.className).toContain("pointer-events-auto");
  });

  it("clicking the dim backdrop dismisses; clicking the composer does NOT", async () => {
    const onClose = vi.fn();
    mockFileFetch("x\n");
    renderOverlay(<FilePreviewOverlay cwd="/repo" path="notes.txt" onClose={onClose} />);
    const backdrop = await waitFor(
      () => document.querySelector('[data-testid="file-preview-backdrop"]') as HTMLElement,
    );

    // A composer click (e.g. the send button) must keep the preview open: the
    // backdrop dim layer does not extend over the composer, and the click never
    // lands on the backdrop element.
    const composer = document.createElement("div");
    composer.setAttribute("data-testid", "composer-root");
    const sendBtn = document.createElement("button");
    sendBtn.setAttribute("data-testid", "send-button");
    composer.appendChild(sendBtn);
    document.body.appendChild(composer);
    sendBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    // Clicking the dim backdrop (outside the panel) dismisses.
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    composer.remove();
  });

  it("measures composer height and sets the backdrop bottom cutout accordingly", async () => {
    // Mount a composer-root with a known height BEFORE the overlay renders, so
    // the measurement effect reads it and reserves an equal bottom cutout —
    // real coverage of the ResizeObserver-driven inset (not just the dismissal
    // path). The dim layer must stop `80px` above the viewport bottom.
    const composer = document.createElement("div");
    composer.setAttribute("data-testid", "composer-root");
    Object.defineProperty(composer, "getBoundingClientRect", {
      value: () => ({ height: 80 }) as DOMRect,
    });
    document.body.appendChild(composer);
    mockFileFetch("x\n");
    renderOverlay(<FilePreviewOverlay cwd="/repo" path="notes.txt" onClose={() => {}} />);
    await waitFor(() => {
      const backdrop = document.querySelector(
        '[data-testid="file-preview-backdrop"]',
      ) as HTMLElement | null;
      expect(backdrop?.style.bottom).toBe("80px");
    });
    composer.remove();
  });
});

import { friendlyReadError } from "../FilePreviewOverlay.js";

function mockFileError(error: string, status = 404) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ success: false, error }), {
      status,
      headers: { "Content-Type": "application/json" },
    }) as any,
  );
}

describe("FilePreviewOverlay — stale link errors", () => {
  it("maps 'not found' to a file-no-longer-exists message", () => {
    expect(friendlyReadError("not found", "src/foo.ts", "/repo")).toMatch(
      /no longer exists at src\/foo\.ts/i,
    );
  });

  it("maps 'unknown session path' to a working-directory-gone message", () => {
    expect(friendlyReadError("unknown session path", "src/foo.ts", "/old/wt")).toMatch(
      /working directory is no longer available/i,
    );
  });

  it("passes through an unrecognised error verbatim", () => {
    expect(friendlyReadError("path outside working directory", "x.ts", "/repo")).toBe(
      "path outside working directory",
    );
  });

  it("renders the friendly message in the overlay error slot", async () => {
    mockFileError("not found");
    const { findByTestId } = renderOverlay(
      <FilePreviewOverlay cwd="/repo" path="src/gone.ts" onClose={() => {}} />,
    );
    const err = await findByTestId("file-preview-error");
    expect(err.textContent).toMatch(/no longer exists at src\/gone\.ts/i);
  });
});
