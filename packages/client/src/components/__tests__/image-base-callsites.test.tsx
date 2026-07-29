/**
 * Call-site wiring: the three on-disk markdown surfaces that opt into local
 * image resolution pass a correctly-derived `imageBase`; the out-of-scope
 * `MarkdownPreviewView` host does not.
 * See change: fix-markdown-preview-relative-images (test-plan #E9, #E10, #E12).
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownViewer from "../editor-pane/MarkdownViewer.js";
import { FilePreviewOverlay } from "../preview/FilePreviewOverlay.js";
import { MarkdownPreviewView } from "../preview/MarkdownPreviewView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

const originalFetch = globalThis.fetch;

/** Mock `/api/file` (text read) to return `content` for any md fetch. */
function mockFileRead(content: string) {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve({ success: true, data: { type: "file", content, mtime: 1 } }),
    }),
  ) as unknown as typeof fetch;
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("local-image imageBase wiring", () => {
  beforeEach(() => mockFileRead("![a](p.png)"));

  it("#E9 FilePreviewOverlay opts in — sibling img resolves against the file's dir", async () => {
    render(
      <ThemeProvider>
        <FilePreviewOverlay cwd="/w" path="docs/review.md" onClose={() => {}} />
      </ThemeProvider>,
    );
    // FilePreviewOverlay renders through DialogPortal (document.body).
    const img = await waitFor(() => {
      const el = document.querySelector("img");
      if (!el) throw new Error("no img yet");
      return el;
    });
    expect(img.getAttribute("src")).toBe("/api/file/raw?cwd=%2Fw&path=%2Fw%2Fdocs%2Fp.png");
  });

  it("#E10 editor MarkdownViewer opts in — dir derives from a nested path", async () => {
    const { container } = render(
      <ThemeProvider>
        <MarkdownViewer cwd="/w" path="a/b/n.md" kind="markdown" mimeType="text/markdown" size={0} />
      </ThemeProvider>,
    );
    const img = await waitFor(() => {
      const el = container.querySelector("img");
      if (!el) throw new Error("no img yet");
      return el;
    });
    expect(img.getAttribute("src")).toBe("/api/file/raw?cwd=%2Fw&path=%2Fw%2Fa%2Fb%2Fp.png");
  });

  it("#E12 MarkdownPreviewView is out of scope — a relative src stays verbatim", async () => {
    const { container } = render(
      <ThemeProvider>
        <MarkdownPreviewView content="![a](p.png)" searchable={false} />
      </ThemeProvider>,
    );
    const img = await waitFor(() => {
      const el = container.querySelector("img");
      if (!el) throw new Error("no img yet");
      return el;
    });
    expect(img.getAttribute("src")).toBe("p.png");
  });
});
