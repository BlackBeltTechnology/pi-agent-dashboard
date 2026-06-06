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
