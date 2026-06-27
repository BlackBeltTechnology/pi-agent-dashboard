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
