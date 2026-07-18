/**
 * Markdown Preview/Edit toggle + save (#4).
 *
 * - `.md`/`.mdx` (editable) show a Preview/Edit toggle; Edit mounts
 *   MarkdownEditor. `.markdown` stays read-only (no Edit affordance).
 * - Save → POST /api/file/write with the loaded mtime; 200 clears dirty,
 *   409 surfaces the changed-on-disk banner.
 *
 * See change: improve-content-editor (tasks §5).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../monaco-setup.js", () => ({}));
vi.mock("../../../lib/theme/monaco-theme.js", () => ({
  buildMonacoTheme: () => ({ name: "t", data: {} }),
}));
// Controllable Monaco editor stub → a textarea wired to onChange.
vi.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="monaco-textarea"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));
// Keep MarkdownContent light.
vi.mock("../../preview/MarkdownContent.js", () => ({
  MarkdownContent: ({ content }: { content: string }) => <div data-testid="md-preview">{content}</div>,
}));

import MarkdownViewer from "../MarkdownViewer.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";

const originalFetch = globalThis.fetch;

/** Programmable write-response for the POST leg. */
let writeResponse: { status: number; body: unknown };

function mockFetch(content = "# hi", mtime = 123) {
  globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve({
        status: writeResponse.status,
        json: () => Promise.resolve(writeResponse.body),
      });
    }
    return Promise.resolve({
      json: () => Promise.resolve({ success: true, data: { type: "file", content, mtime } }),
    });
  }) as unknown as typeof fetch;
}

function renderViewer(path: string) {
  return render(
    <ThemeProvider>
      <MarkdownViewer cwd="/proj" path={path} kind="markdown" mimeType="text/markdown" size={0} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null,
  })) as unknown as typeof window.matchMedia;
  writeResponse = { status: 200, body: { success: true, data: { mtime: 456 } } };
  mockFetch();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("MarkdownViewer — Preview/Edit (#4)", () => {
  it("shows a Preview/Edit toggle for .md and switches to the editor", async () => {
    renderViewer("notes.md");
    await screen.findByTestId("md-preview");
    const editBtn = screen.getByTestId("md-edit-toggle");
    expect(editBtn).toBeTruthy();
    fireEvent.click(editBtn);
    expect(await screen.findByTestId("monaco-textarea")).toBeTruthy();
  });

  it("does not offer edit for read-only .markdown", async () => {
    renderViewer("notes.markdown");
    await screen.findByTestId("md-preview");
    expect(screen.queryByTestId("md-edit-toggle")).toBeNull();
  });

  it("save success clears dirty", async () => {
    renderViewer("notes.md");
    await screen.findByTestId("md-preview");
    fireEvent.click(screen.getByTestId("md-edit-toggle"));
    const ta = await screen.findByTestId("monaco-textarea");
    fireEvent.change(ta, { target: { value: "# edited" } });
    // Dirty → Save enabled.
    const saveBtn = screen.getByTestId("md-save-btn");
    expect(saveBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(saveBtn);
    await waitFor(() => expect(screen.getByTestId("md-save-btn").hasAttribute("disabled")).toBe(true));
  });

  it("mtime conflict (409) shows the changed-on-disk banner", async () => {
    writeResponse = { status: 409, body: { success: false, error: "changed" } };
    renderViewer("notes.md");
    await screen.findByTestId("md-preview");
    fireEvent.click(screen.getByTestId("md-edit-toggle"));
    const ta = await screen.findByTestId("monaco-textarea");
    fireEvent.change(ta, { target: { value: "# edited" } });
    fireEvent.click(screen.getByTestId("md-save-btn"));
    expect(await screen.findByTestId("changed-on-disk-banner")).toBeTruthy();
  });
});
