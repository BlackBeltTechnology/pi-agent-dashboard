/**
 * Editor-pane system-open tab actions (D9). File actions appear only when the
 * server advertises `systemOpen`; the url action is unconditional and calls
 * `window.open(url, "_blank")` with no server round-trip.
 *
 * See change: open-view-command-in-editor-pane (test-plan E17 / F11).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { TabActions } from "../TabActions.js";

const fileTarget = { kind: "file" as const, cwd: "/proj", path: "doc.docx" };
const urlTarget = { kind: "url" as const, url: "https://example.com/a" };

function renderActions(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: true, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TabActions — file tab (E17)", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })) as unknown as typeof fetch;
  });

  it("systemOpen:true → shows Open-in-app + Reveal", () => {
    renderActions(<TabActions target={fileTarget} systemOpen={true} />);
    expect(screen.getByTestId("tab-open-in-app")).toBeTruthy();
    expect(screen.getByTestId("tab-reveal-in-file-manager")).toBeTruthy();
  });

  it("systemOpen:false → both hidden", () => {
    renderActions(<TabActions target={fileTarget} systemOpen={false} />);
    expect(screen.queryByTestId("tab-open-in-app")).toBeNull();
    expect(screen.queryByTestId("tab-reveal-in-file-manager")).toBeNull();
  });

  it("Open-in-app POSTs /api/open-in-system with {cwd,path}", () => {
    renderActions(<TabActions target={fileTarget} systemOpen={true} />);
    fireEvent.click(screen.getByTestId("tab-open-in-app"));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/open-in-system",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ cwd: "/proj", path: "doc.docx" }) }),
    );
  });
});

describe("TabActions — url tab (F11)", () => {
  it("shows Open-in-browser regardless of systemOpen and calls window.open(_blank)", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    // Even with systemOpen:false, the url action is present.
    renderActions(<TabActions target={urlTarget} systemOpen={false} />);
    const btn = screen.getByTestId("tab-open-in-browser");
    fireEvent.click(btn);
    expect(openSpy).toHaveBeenCalledWith("https://example.com/a", "_blank");
    // No file actions for a url tab.
    expect(screen.queryByTestId("tab-open-in-app")).toBeNull();
  });
});
