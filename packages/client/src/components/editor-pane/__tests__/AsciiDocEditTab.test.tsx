/**
 * `.adoc` Preview/Edit toggle via the registry's `asciidoc` viewer: Preview
 * mounts the rendered AsciiDoc; Edit mounts a Monaco buffer over the raw
 * source; Save posts to `/api/file/write` with the loaded mtime.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../monaco-setup.js", () => ({}));
vi.mock("../../../lib/theme/monaco-theme.js", () => ({
  buildMonacoTheme: () => ({ name: "t", data: {} }),
}));
vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea data-testid="monaco-textarea" value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));
vi.mock("../../preview/AsciiDocPreview.js", () => ({
  AsciiDocPreview: () => <div data-testid="adoc-rendered">rendered</div>,
}));

import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { viewerRegistry } from "../viewer-registry.js";

const originalFetch = globalThis.fetch;
const posts: unknown[] = [];

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null,
  })) as unknown as typeof window.matchMedia;
  posts.length = 0;
  globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return Promise.resolve({ status: 200, json: () => Promise.resolve({ success: true, data: { mtime: 2 } }) });
    }
    return Promise.resolve({
      json: () => Promise.resolve({ success: true, data: { type: "file", content: "= Title\n", mtime: 1 } }),
    });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function renderAdoc() {
  const V = viewerRegistry.asciidoc;
  return render(
    <ThemeProvider>
      <V cwd="/proj" path="doc.adoc" kind="asciidoc" mimeType="text/asciidoc" size={0} />
    </ThemeProvider>,
  );
}

describe("asciidoc viewer — Preview/Edit", () => {
  it("defaults to the rendered preview inside a scroll container", () => {
    renderAdoc();
    const rendered = screen.getByTestId("adoc-rendered");
    expect(rendered.closest(".overflow-auto")).not.toBeNull();
    expect(screen.queryByTestId("monaco-textarea")).toBeNull();
  });

  it("edits the raw source and saves it with the loaded mtime", async () => {
    renderAdoc();
    fireEvent.click(screen.getByTestId("adoc-edit-toggle"));
    const ta = (await screen.findByTestId("monaco-textarea")) as HTMLTextAreaElement;
    expect(ta.value).toBe("= Title\n");
    fireEvent.change(ta, { target: { value: "= New\n" } });
    fireEvent.click(screen.getByTestId("adoc-save-btn"));
    await waitFor(() => expect(posts).toEqual([{ cwd: "/proj", path: "doc.adoc", content: "= New\n", mtime: 1 }]));
    fireEvent.click(screen.getByTestId("adoc-preview-toggle"));
    expect(screen.getByTestId("adoc-rendered")).toBeTruthy();
  });
});
