/**
 * PdfPreview: renders the document through pdfjs's `PDFViewer` component viewer
 * (continuous scroll + text layer), NOT a hand-rolled paged canvas. pdfjs is
 * mocked so the test never loads the real library. See change:
 * pdf-preview-continuous-scroll (tasks §4.1, §4.2).
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

// Capture how the pdfjs component viewer is constructed + driven.
const pdfViewerCalls: { options: Record<string, unknown> }[] = [];
const setDocumentCalls: unknown[] = [];

vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => {
  class EventBus {}
  class PDFLinkService {
    setViewer = vi.fn();
    setDocument = vi.fn();
  }
  class PDFViewer {
    constructor(options: Record<string, unknown>) {
      pdfViewerCalls.push({ options });
    }
    setDocument = vi.fn((doc: unknown) => setDocumentCalls.push(doc));
  }
  return { EventBus, PDFLinkService, PDFViewer };
});

// Worker `?url` import → a plain string; never loads a real worker.
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

const destroy = vi.fn();
const getDocument = vi.fn(() => ({ promise: Promise.resolve({ numPages: 3, destroy }) }));

vi.mock("pdfjs-dist", () => ({
  getDocument,
  GlobalWorkerOptions: { workerSrc: "" },
}));

import { PdfPreview } from "../PdfPreview.js";

const target = { kind: "file" as const, cwd: "/proj", path: "spec.pdf" };

afterEach(() => {
  cleanup();
  pdfViewerCalls.length = 0;
  setDocumentCalls.length = 0;
  vi.clearAllMocks();
});

describe("PdfPreview", () => {
  it("continuous scroll: one scroll container with a stacked-pages viewer, no Prev/Next chrome (§4.1)", async () => {
    const { container, queryByText } = render(<PdfPreview target={target} />);

    // Exactly one absolutely-positioned scroll container holding the pdfjs viewer.
    const scrollers = container.querySelectorAll(".pdfViewerContainer");
    expect(scrollers.length).toBe(1);
    expect(scrollers[0].className).toContain("overflow-auto");
    expect(container.querySelector(".pdfViewer")).toBeTruthy();

    // No paged toolbar.
    expect(queryByText("Prev")).toBeNull();
    expect(queryByText("Next")).toBeNull();
    expect(container.textContent).not.toMatch(/Page \d+ of \d+/);

    // The document is driven into the viewer (not rendered per-page onto a canvas).
    await waitFor(() => expect(setDocumentCalls.length).toBeGreaterThan(0));
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("text layer: the viewer is constructed with the text layer enabled (§4.2)", async () => {
    render(<PdfPreview target={target} />);
    await waitFor(() => expect(pdfViewerCalls.length).toBe(1));
    // textLayerMode 2 = enabled → selection + ctrl-F find.
    expect(pdfViewerCalls[0].options.textLayerMode).toBe(2);
    expect(pdfViewerCalls[0].options.container).toBeTruthy();
  });

  it("surfaces a load failure via the error state", async () => {
    getDocument.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error("boom pdf")),
    }));
    const { findByText, container } = render(<PdfPreview target={target} />);
    // The rejection is caught and surfaced as the error message.
    expect(await findByText("boom pdf")).toBeTruthy();
    expect(container.querySelector(".pdfViewerContainer")).toBeNull();
  });

  it("switching target tears down the previous document and mounts the new one", async () => {
    const { rerender } = render(<PdfPreview target={target} />);
    await waitFor(() => expect(pdfViewerCalls.length).toBe(1));
    // A new target re-runs the effect: the previous document is destroyed on
    // teardown (no leak / no stale-mount clobber) and a fresh viewer mounts.
    rerender(<PdfPreview target={{ ...target, path: "other.pdf" }} />);
    await waitFor(() => expect(pdfViewerCalls.length).toBe(2));
    await waitFor(() => expect(destroy).toHaveBeenCalled());
  });
});
