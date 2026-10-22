/**
 * AsciiDoc preview without browser Trusted Types support (jsdom): app-owned
 * HTML is still sanitized with its profile, output is plain-string, nothing
 * throws. See change: harden-client-sinks (test-plan #F7).
 *
 * Harness glue copied from AsciiDocPreview.markup-repair.test.tsx.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import DOMPurify from "dompurify";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ASCIIDOC_PROFILE } from "@blackbelt-technology/pi-dashboard-shared/sanitize-profiles.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../MermaidBlock.js", () => ({ MermaidBlock: () => <div data-testid="mmd-block" /> }));

import { AsciiDocPreview } from "../AsciiDocPreview.js";

const SERVER_HTML = '<div class="sect1"><h2 id="_t">Title</h2><p>Body<img src="x" onerror="f()"></p></div>';

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

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { html: SERVER_HTML, repairs: [], warnings: [], mtime: 1 } }) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AsciiDocPreview without Trusted Types (#F7)", () => {
  it("renders the sanitized server HTML, drops onerror, never throws", async () => {
    expect((globalThis as { trustedTypes?: unknown }).trustedTypes).toBeUndefined();
    const { container } = render(
      <ThemeProvider>
        <AsciiDocPreview target={{ kind: "file", cwd: "/proj", path: "guide.adoc" }} />
      </ThemeProvider>,
    );
    await waitFor(() => expect(container.textContent).toContain("Title"));
    const body = container.querySelector(".asciidoc-body") as HTMLElement;
    expect(body.querySelector("[onerror]")).toBeNull();
    const expected = document.createElement("div");
    expected.innerHTML = String(DOMPurify.sanitize(SERVER_HTML, ASCIIDOC_PROFILE as never));
    expect(body.firstElementChild?.innerHTML).toBe(expected.innerHTML);
  });
});

// harden-client-sinks (test-plan #X5): the AsciiDoc sink fails closed too.
describe("AsciiDocPreview sanitizer failure (#X5)", () => {
  it("DOMPurify unsupported → error text, raw HTML never injected", async () => {
    const spy = vi.spyOn(DOMPurify, "isSupported", "get").mockReturnValue(false);
    try {
      const { container } = render(
        <ThemeProvider>
          <AsciiDocPreview target={{ kind: "file", cwd: "/proj", path: "guide.adoc" }} />
        </ThemeProvider>,
      );
      await waitFor(() => expect(container.textContent).toMatch(/sanitizer unavailable/));
      expect(container.innerHTML).not.toContain("Title</h2>");
      expect(container.innerHTML).not.toMatch(/onerror/);
    } finally {
      spy.mockRestore();
    }
  });
});
