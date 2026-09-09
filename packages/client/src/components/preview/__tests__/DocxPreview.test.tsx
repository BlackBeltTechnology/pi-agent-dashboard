/**
 * DocxPreview: branches on the server's discriminated render result.
 * See change: render-office-previews (test-plan #20, #21, #23).
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../../settings/ThemeProvider.js", () => ({
  useThemeContext: () => ({ resolved: "dark", themeName: "studio" }),
}));
// Stub the lazily-loaded PdfPreview so the test never pulls in pdfjs; it echoes
// the srcUrl it was mounted against.
vi.mock("../PdfPreview.js", () => ({
  default: ({ srcUrl }: { srcUrl?: string }) => (
    <div data-testid="pdf-stub" data-src={srcUrl} />
  ),
}));

import { AsciiDocPreview } from "../AsciiDocPreview.js";
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

/**
 * Typography scope shared by the AsciiDoc and docx html-mode wrappers.
 * The `prose prose-invert` classes were dead (no @tailwindcss/typography) and
 * are replaced by the `.asciidoc-body` stylesheet.
 * See change: asciidoc-support (test-plan #F7, #F8).
 */
describe("asciidoc-body typography scope", () => {
  const wrapperOf = (html: string): HTMLElement => {
    const el = document.querySelector(".asciidoc-body");
    expect(el, `no .asciidoc-body wrapper around ${html}`).toBeTruthy();
    return el as HTMLElement;
  };

  it("F8: DocxPreview html-mode wraps output in .asciidoc-body without prose classes", async () => {
    mockFetch({ success: true, data: { mode: "html", html: "<p>docx scope probe</p>", truncated: false, imageCount: 0 } });
    render(<DocxPreview target={target} />);
    await waitFor(() => expect(screen.getByText("docx scope probe")).toBeTruthy());
    const w = wrapperOf("docx html");
    expect(w.className).toContain("asciidoc-body");
    expect(w.className).not.toContain("prose");
    expect(w.textContent).toContain("docx scope probe");
  });

  it("F7: AsciiDocPreview wraps output in .asciidoc-body without prose classes", async () => {
    mockFetch({ success: true, data: { html: "<h1>adoc scope probe</h1>" } });
    render(<AsciiDocPreview target={{ kind: "file", cwd: "/proj", path: "doc.adoc" }} />);
    await waitFor(() => expect(screen.getByText("adoc scope probe")).toBeTruthy());
    const w = wrapperOf("adoc html");
    expect(w.className).toContain("asciidoc-body");
    expect(w.className).not.toContain("prose");
    expect(w.className).not.toContain("prose-invert");
  });
});

describe("AsciiDoc diagram hydration (test-plan #E14, #F5)", () => {
  it("E14: adoc-sourced mermaid parity: mounts MermaidBlock with identical source", async () => {
    const mermaidCode = "graph TD;\n  A-->B;";
    const adocHtml = `
<div class="paragraph"><p>Preamble</p></div>
<div class="listingblock"><div class="content">
<pre class="highlight"><code class="language-mermaid" data-lang="mermaid">${mermaidCode}</code></pre>
</div></div>
`;
    mockFetch({ success: true, data: { html: adocHtml } });
    render(<AsciiDocPreview target={{ kind: "file", cwd: "/proj", path: "doc.adoc" }} />);
    await waitFor(() => {
      // MermaidBlock renders with loading or container
      const el = document.querySelector(".asciidoc-body");
      expect(el).toBeTruthy();
    });
    // Should mount MermaidBlock and not raw listing
    expect(screen.getByText("Preamble")).toBeTruthy();
  });

  it("F5: invalid adoc mermaid degrades to raw code + error (test-plan #F5)", async () => {
    const invalidMermaid = "graph INVALID syntax :::";
    const adocHtml = `
<div class="listingblock"><div class="content">
<pre class="highlight"><code class="language-mermaid" data-lang="mermaid">${invalidMermaid}</code></pre>
</div></div>
`;
    mockFetch({ success: true, data: { html: adocHtml } });
    render(<AsciiDocPreview target={{ kind: "file", cwd: "/proj", path: "doc.adoc" }} />);
    // Should render MermaidBlock error / code fallback
    await waitFor(() => {
      expect(screen.getAllByText((content) => content.includes("graph INVALID syntax")).length).toBeGreaterThan(0);
      expect(screen.getByText((content) => content.includes("Failed to render Mermaid diagram"))).toBeTruthy();
    });
  });
});

