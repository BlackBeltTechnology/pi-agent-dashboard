/**
 * `.csv` Preview/Edit toggle (D4). Preview mounts the spreadsheet grid; Edit
 * mounts a Monaco text buffer over the raw CSV; a stale save (409) surfaces the
 * changed-on-disk banner and leaves the loaded content unchanged.
 *
 * See change: open-view-command-in-editor-pane (task 5.2).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
// Keep the grid light — assert it mounts without its own /api/file/sheet fetch.
vi.mock("../../preview/SpreadsheetPreview.js", () => ({
  SpreadsheetPreview: () => <div data-testid="sheet-grid">grid</div>,
}));

import { ThemeProvider } from "../../settings/ThemeProvider.js";
import EditableSpreadsheetTab from "../EditableSpreadsheetTab.js";

const originalFetch = globalThis.fetch;
let writeResponse: { status: number; body: unknown };

function mockFetch(content = "a,b\n1,2\n", mtime = 123) {
  globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve({ status: writeResponse.status, json: () => Promise.resolve(writeResponse.body) });
    }
    return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { type: "file", content, mtime } }) });
  }) as unknown as typeof fetch;
}

function renderTab() {
  return render(
    <ThemeProvider>
      <EditableSpreadsheetTab cwd="/proj" path="data.csv" kind="spreadsheet" mimeType="text/csv" size={0} />
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

describe("EditableSpreadsheetTab — csv Preview/Edit (D4)", () => {
  it("defaults to the spreadsheet grid in Preview", () => {
    renderTab();
    expect(screen.getByTestId("sheet-grid")).toBeTruthy();
    expect(screen.queryByTestId("monaco-textarea")).toBeNull();
  });

  it("switches to a Monaco text buffer over the raw CSV in Edit, and back", async () => {
    renderTab();
    fireEvent.click(screen.getByTestId("csv-edit-toggle"));
    const ta = (await screen.findByTestId("monaco-textarea")) as HTMLTextAreaElement;
    expect(ta.value).toBe("a,b\n1,2\n");
    // Toggle back restores the grid.
    fireEvent.click(screen.getByTestId("csv-preview-toggle"));
    expect(screen.getByTestId("sheet-grid")).toBeTruthy();
  });

  it("a stale save (409) shows the changed-on-disk banner and keeps content unchanged", async () => {
    writeResponse = { status: 409, body: { success: false, error: "changed on disk" } };
    renderTab();
    fireEvent.click(screen.getByTestId("csv-edit-toggle"));
    const ta = (await screen.findByTestId("monaco-textarea")) as HTMLTextAreaElement;
    // Make an edit so Save is enabled.
    fireEvent.change(ta, { target: { value: "a,b\n9,9\n" } });
    fireEvent.click(screen.getByTestId("csv-save-btn"));
    // Banner appears; the loaded content baseline stays "a,b\n1,2\n" (dirty dot persists).
    expect(await screen.findByTestId("changed-on-disk-banner")).toBeTruthy();
    expect(screen.getByTestId("csv-dirty-dot")).toBeTruthy();
  });
});
