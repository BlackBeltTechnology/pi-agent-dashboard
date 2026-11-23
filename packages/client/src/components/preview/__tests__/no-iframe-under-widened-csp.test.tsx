/**
 * CSP widening (`frame-src 'self' https:`) must not let untrusted HTML create a frame: every renderer
 * sanitizer keeps stripping `<iframe>`. Pattern: `canvas-doc-csp.test.ts` + the per-sanitizer tests.
 * See change: rich-chat-links (task 3.12, test-plan #E37).
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { trustedSanitizedHtml } from "../../../lib/security/trusted-types.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { sanitizeMermaidSvg } from "../MermaidBlock.js";

const EVIL = '<iframe src="https://evil.example"></iframe>';

afterEach(cleanup);

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

/** Mount sanitizer output the way the real sinks do (innerHTML into a live element). */
function mountHtml(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe("untrusted HTML cannot create frames (#E37)", () => {
  it("chat markdown strips an injected iframe", () => {
    const { container } = render(
      <ThemeProvider>
        <MarkdownContent content={`before\n\n${EVIL}\n\nafter`} />
      </ThemeProvider>,
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("DOCX profile strips an injected iframe", () => {
    const host = mountHtml(String(trustedSanitizedHtml(`<p>doc</p>${EVIL}`, "docx")));
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).toContain("doc");
    host.remove();
  });

  it("AsciiDoc profile strips an injected iframe", () => {
    const host = mountHtml(String(trustedSanitizedHtml(`<div class="paragraph"><p>adoc</p></div>${EVIL}`, "asciidoc")));
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).toContain("adoc");
    host.remove();
  });

  it("diagram SVG (PlantUML) profile strips an injected iframe, bare and inside foreignObject", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text>x</text>${EVIL}<foreignObject>${EVIL}</foreignObject></svg>`;
    const host = mountHtml(String(trustedSanitizedHtml(svg, "diagram-svg")));
    expect(host.querySelector("iframe")).toBeNull();
    host.remove();
  });

  it("mermaid profile strips an injected iframe, bare and inside foreignObject", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g>${EVIL}</g><foreignObject>${EVIL}</foreignObject></svg>`;
    const viaPolicy = mountHtml(String(trustedSanitizedHtml(svg, "mermaid")));
    expect(viaPolicy.querySelector("iframe")).toBeNull();
    viaPolicy.remove();
    const viaBlock = mountHtml(await sanitizeMermaidSvg(svg));
    expect(viaBlock.querySelector("iframe")).toBeNull();
    viaBlock.remove();
  });
});
