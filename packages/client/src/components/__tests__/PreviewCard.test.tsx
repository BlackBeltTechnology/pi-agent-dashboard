/**
 * Tests for PreviewCard + ChatView integration of `view`-bearing messages.
 * See change: render-file-previews.
 */

import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PreviewProvenance } from "../../lib/access-grants/preview-provenance.js";
import { ChatView } from "../chat/ChatView.js";
import { PreviewCard } from "../preview/PreviewCard.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const defaultToolContext: ToolContext = {};

afterEach(() => cleanup());

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function wrap(ui: React.ReactNode, opts?: { path?: string }) {
  const { hook, navigate } = memoryLocation({ path: opts?.path ?? "/", record: true });
  const result = render(
    <ThemeProvider>
      <Router hook={hook}>{ui}</Router>
    </ThemeProvider>,
  );
  return { ...result, navigate };
}

describe("PreviewCard", () => {
  it("dispatches markdown renderer for .md files", () => {
    const target: ViewTarget = { kind: "file", cwd: "/x", path: "README.md" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("markdown");
  });

  it("dispatches pdf renderer for .pdf files", () => {
    const target: ViewTarget = { kind: "file", cwd: "/x", path: "doc.pdf" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("pdf");
  });

  it("dispatches youtube renderer for youtu.be URLs", () => {
    const target: ViewTarget = { kind: "url", url: "https://youtu.be/abc123" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("youtube");
  });

  it("dispatches image renderer for .png files", () => {
    const target: ViewTarget = { kind: "file", cwd: "/x", path: "pic.png" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("image");
  });

  it("dispatches video renderer for .mp4 files", () => {
    const target: ViewTarget = { kind: "file", cwd: "/x", path: "clip.mp4" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("video");
  });

  it("dispatches fallback for unknown extension", () => {
    const target: ViewTarget = { kind: "file", cwd: "/x", path: "blob.dat" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("fallback");
  });

  // test-plan #3 — a URL target ending `.eml` dispatches to "email", but
  // PreviewBody guards `kind !== "file"` → FallbackPreview (no crash).
  it("URL ending .eml falls back to FallbackPreview without crashing (test-plan #3)", () => {
    const target: ViewTarget = { kind: "url", url: "https://example.com/mail.eml" };
    const { getByTestId, getByText } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("email");
    // FallbackPreview for a URL target renders an "Open in new tab" link.
    expect(getByText("Open in new tab")).toBeTruthy();
  });

  it("dispatches docx renderer for .docx files", () => {
    const target: ViewTarget = { kind: "file", cwd: "/x", path: "spec.docx" };
    const { getByTestId } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("docx");
  });

  it("dispatches spreadsheet renderer for .xlsx and .csv files", () => {
    for (const path of ["data.xlsx", "export.csv"]) {
      const target: ViewTarget = { kind: "file", cwd: "/x", path };
      const { getByTestId } = wrap(<PreviewCard target={target} />);
      expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("spreadsheet");
      cleanup();
    }
  });

  it("a URL target ending .docx renders FallbackPreview, no crash (test-plan #6)", () => {
    // dispatch maps the .docx URL to kind "docx", but PreviewBody guards
    // target.kind !== "file" and degrades to FallbackPreview.
    const target: ViewTarget = { kind: "url", url: "https://example.com/report.docx" };
    const { getByTestId, container } = wrap(<PreviewCard target={target} />);
    expect(getByTestId("preview-card").getAttribute("data-kind")).toBe("docx");
    // Fallback for a URL target renders an "Open in new tab" link, not a docx body.
    expect(container.querySelector('a[href="https://example.com/report.docx"]')).toBeTruthy();
  });

  it("expand button navigates to file-view overlay route", () => {
    const target: ViewTarget = { kind: "file", cwd: "/home/u/proj", path: "doc.md" };
    const loc = memoryLocation({ path: "/", record: true }) as any;
    const { getByTestId } = render(
      <ThemeProvider>
        <Router hook={loc.hook}>
          <PreviewCard target={target} />
        </Router>
      </ThemeProvider>,
    );
    act(() => {
      fireEvent.click(getByTestId("preview-expand"));
    });
    const last = loc.history[loc.history.length - 1];
    expect(last).toMatch(/^\/folder\/[^/]+\/view\?path=doc\.md$/);
  });

  it("expand button navigates to /pi-view for URL targets", () => {
    const target: ViewTarget = { kind: "url", url: "https://youtu.be/xyz" };
    const loc = memoryLocation({ path: "/", record: true }) as any;
    const { getByTestId } = render(
      <ThemeProvider>
        <Router hook={loc.hook}>
          <PreviewCard target={target} />
        </Router>
      </ThemeProvider>,
    );
    act(() => {
      fireEvent.click(getByTestId("preview-expand"));
    });
    const last = loc.history[loc.history.length - 1];
    expect(last).toBe("/pi-view?url=https%3A%2F%2Fyoutu.be%2Fxyz");
  });
});

// The "ChatView — view-bearing messages" suite is removed: the inline `/view`
// PreviewCard surface is retired (change: open-view-command-in-editor-pane).
// `/view` opens the editor pane; `PreviewBody`/overlay renderers stay covered
// by the suites above.

// ── harden-client-sinks (D10): navigation intents only for operator actions ──
describe("PreviewCard Expand × navigation intent (#E21, #F8, #X2)", () => {
  const fileTarget: ViewTarget = { kind: "file", cwd: "/home/u/proj", path: "page.html" };

  function mount(operator: boolean, fetchImpl: (url: string, init?: RequestInit) => Promise<unknown>) {
    const fetchSpy = vi.fn(fetchImpl);
    vi.stubGlobal("fetch", fetchSpy);
    const loc = memoryLocation({ path: "/", record: true }) as any;
    const card = <PreviewCard target={fileTarget} />;
    const utils = render(
      <ThemeProvider>
        <Router hook={loc.hook}>{operator ? <PreviewProvenance autoOpened={false}>{card}</PreviewProvenance> : card}</Router>
      </ThemeProvider>,
    );
    const mints = () => fetchSpy.mock.calls.filter(([u]) => String(u) === "/api/nav-intent").length;
    return { ...utils, loc, mints };
  }
  const okMint = async () => ({ ok: true, json: async () => ({ success: true, ni: "ZXhw.bWFj" }) });

  afterEach(() => vi.unstubAllGlobals());

  it("Expand on an operator card mints once and navigates with ni", async () => {
    const { getByTestId, loc, mints } = mount(true, okMint);
    fireEvent.click(getByTestId("preview-expand"));
    await waitFor(() => expect(loc.history.at(-1)).toMatch(/\/view\?path=page\.html&ni=ZXhw\.bWFj$/));
    expect(mints()).toBe(1);
  });

  it("Expand on an agent card navigates without ni and mints nothing", async () => {
    const { getByTestId, loc, mints } = mount(false, okMint);
    act(() => {
      fireEvent.click(getByTestId("preview-expand"));
    });
    expect(loc.history.at(-1)).toMatch(/\/view\?path=page\.html$/);
    expect(mints()).toBe(0);
  });

  it("middle-click / cmd-click use the plain href (no ni) and mint nothing (#F8)", () => {
    const { getByTestId, loc, mints } = mount(true, okMint);
    const a = getByTestId("preview-expand");
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toMatch(/\/view\?path=page\.html$/);
    fireEvent.click(a, { button: 1 });
    fireEvent.click(a, { metaKey: true });
    fireEvent.click(a, { ctrlKey: true });
    expect(mints()).toBe(0);
    expect(loc.history.at(-1)).toBe("/");
  });

  it("a failing mint (500) still navigates, without ni (#X2)", async () => {
    const { getByTestId, loc, mints } = mount(true, async () => ({ ok: false, status: 500, json: async () => ({}) }));
    fireEvent.click(getByTestId("preview-expand"));
    await waitFor(() => expect(loc.history.at(-1)).toMatch(/\/view\?path=page\.html$/));
    expect(mints()).toBe(1);
  });
});
