/**
 * PptxPreview: on-demand slide render (design P2). Initial state shows a
 * "Render slides" affordance and does NOT auto-fetch; activating it calls
 * `/api/file/render` and, on `{mode:"pdf"}`, mounts PdfPreview against
 * `/api/file/rendered-pdf`. `{success:false}` → FallbackPreview.
 * See change: render-pptx-preview (test-plan #6.10, #6.11, #6.12).
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
// Stub the lazily-loaded PdfPreview so the test never pulls in pdfjs; it echoes
// the srcUrl it was mounted against.
vi.mock("../PdfPreview.js", () => ({
  default: ({ srcUrl }: { srcUrl?: string }) => <div data-testid="pdf-stub" data-src={srcUrl} />,
}));

import { PptxPreview } from "../PptxPreview.js";

const target = { kind: "file" as const, cwd: "/proj", path: "deck.pptx" };

function mockFetch(body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ json: async () => body }) as any;
  return global.fetch as unknown as ReturnType<typeof vi.fn>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PptxPreview", () => {
  it("initial render shows the 'Render slides' affordance and does NOT auto-fetch (test-plan #6.10)", async () => {
    const fetchFn = mockFetch({ success: true, data: { mode: "pdf" } });
    render(<PptxPreview target={target} />);
    expect(screen.getByTestId("pptx-render-slides")).toBeTruthy();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(screen.queryByTestId("pdf-stub")).toBeNull();
  });

  it("after activate + success → mounts PdfPreview against /api/file/rendered-pdf (test-plan #6.11)", async () => {
    mockFetch({ success: true, data: { mode: "pdf" } });
    render(<PptxPreview target={target} />);
    fireEvent.click(screen.getByTestId("pptx-render-slides"));
    const stub = await screen.findByTestId("pdf-stub");
    expect(stub.getAttribute("data-src")).toContain("/api/file/rendered-pdf");
    expect(stub.getAttribute("data-src")).toContain("path=deck.pptx");
  });

  it("{success:false} (incl. engine-absent) → FallbackPreview download card (test-plan #6.12)", async () => {
    mockFetch({ success: false, error: "presentation rendering requires the document engine" });
    render(<PptxPreview target={target} />);
    fireEvent.click(screen.getByTestId("pptx-render-slides"));
    await waitFor(() => {
      const link = document.querySelector("a[download]");
      expect(link).toBeTruthy();
      expect(link?.getAttribute("href")).toContain("/api/file/raw");
    });
  });
});
