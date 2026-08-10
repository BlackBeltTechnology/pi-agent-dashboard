/**
 * DocxPreview: branches on the server's discriminated render result.
 * See change: render-office-previews (test-plan #20, #21, #23).
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
// Stub the lazily-loaded PdfPreview so the test never pulls in pdfjs; it echoes
// the srcUrl it was mounted against.
vi.mock("../PdfPreview.js", () => ({
  default: ({ srcUrl }: { srcUrl?: string }) => (
    <div data-testid="pdf-stub" data-src={srcUrl} />
  ),
}));

import { DocxPreview } from "../DocxPreview.js";

const target = { kind: "file" as const, cwd: "/proj", path: "spec.docx" };

function mockFetch(body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ json: async () => body }) as any;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DocxPreview", () => {
  it("mode:'pdf' → mounts PdfPreview against /api/file/rendered-pdf (test-plan #20)", async () => {
    mockFetch({ success: true, data: { mode: "pdf" } });
    render(<DocxPreview target={target} />);
    const stub = await screen.findByTestId("pdf-stub");
    expect(stub.getAttribute("data-src")).toContain("/api/file/rendered-pdf");
    expect(stub.getAttribute("data-src")).toContain("path=spec.docx");
  });

  it("mode:'html' → renders sanitized html; banner shown when truncated (test-plan #21)", async () => {
    mockFetch({
      success: true,
      data: { mode: "html", html: "<p>Hello docx body</p>", truncated: true, imageCount: 30 },
    });
    render(<DocxPreview target={target} />);
    await waitFor(() => expect(screen.getByText("Hello docx body")).toBeTruthy());
    expect(screen.getByTestId("truncation-banner")).toBeTruthy();
  });

  it("mode:'html' with truncated:false → no banner", async () => {
    mockFetch({
      success: true,
      data: { mode: "html", html: "<p>short</p>", truncated: false, imageCount: 0 },
    });
    render(<DocxPreview target={target} />);
    await waitFor(() => expect(screen.getByText("short")).toBeTruthy());
    expect(screen.queryByTestId("truncation-banner")).toBeNull();
  });

  it("{success:false} → FallbackPreview download card (test-plan #23)", async () => {
    mockFetch({ success: false, error: "corrupt" });
    render(<DocxPreview target={target} />);
    await waitFor(() => {
      const link = document.querySelector("a[download]");
      expect(link).toBeTruthy();
      expect(link?.getAttribute("href")).toContain("/api/file/raw");
    });
  });
});
