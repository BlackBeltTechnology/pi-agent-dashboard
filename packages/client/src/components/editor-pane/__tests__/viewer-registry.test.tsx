/**
 * Editor-pane registry delegates each rich kind to the shared `preview/*`
 * renderer (#3, gap-1). PDF no longer uses `<object>`; html/video/image/audio/
 * mermaid mount the right component.
 *
 * See change: improve-content-editor (tasks §4.3).
 */

import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { MAX_PREVIEW_BYTES } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { CappedViewer } from "../CappedViewer.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { viewerRegistry } from "../viewer-registry.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: true,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("<h1>hi</h1>") }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function renderKind(kind: keyof typeof viewerRegistry) {
  const V = viewerRegistry[kind];
  return render(
    <ThemeProvider>
      <V cwd="/proj" path={`f.${kind}`} kind="binary" mimeType="x" size={0} />
    </ThemeProvider>,
  );
}

describe("viewerRegistry — preview/* delegation", () => {
  it("exposes all viewer kinds incl. live-server, url, diff, terminal and the rich office/email kinds", () => {
    expect(Object.keys(viewerRegistry).sort()).toEqual(
      [
        "audio", "binary-warn", "diff", "html", "image", "live-server", "markdown", "mermaid", "monaco", "pdf", "terminal", "url", "video",
        "docx", "pptx", "spreadsheet", "asciidoc", "email",
      ].sort(),
    );
  });

  it("registers a component for each rich office/document/email kind", () => {
    for (const kind of ["docx", "pptx", "spreadsheet", "asciidoc", "email"] as const) {
      expect(typeof viewerRegistry[kind], kind).toBe("function");
    }
  });

  it("pdf mounts a canvas viewer, NOT an <object> plugin", () => {
    const { container } = renderKind("pdf");
    expect(container.querySelector("object")).toBeNull();
    expect(container.querySelector("canvas")).toBeTruthy();
  });

  it("video mounts a <video controls>", () => {
    const { container } = renderKind("video");
    const v = container.querySelector("video");
    expect(v).toBeTruthy();
    expect(v?.hasAttribute("controls")).toBe(true);
  });

  it("audio mounts an <audio controls>", () => {
    const { container } = renderKind("audio");
    const a = container.querySelector("audio");
    expect(a).toBeTruthy();
    expect(a?.hasAttribute("controls")).toBe(true);
  });

  it("image mounts the full pan/zoom variant (zoom controls present)", () => {
    const { getByLabelText } = renderKind("image");
    expect(getByLabelText("Zoom in")).toBeTruthy();
    expect(getByLabelText("Zoom out")).toBeTruthy();
  });

  it("html mounts a sandboxed iframe (scripts disabled)", async () => {
    const { container } = renderKind("html");
    await waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
    const iframe = container.querySelector("iframe")!;
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-scripts");
  });
});

// Large-file byte cap (D7 / test-plan P1). The `CappedViewer` gate obtains the
// file `size` from `/api/file` metadata and mounts `TooLargePreview` above the
// cap, the rich viewer at/below it. Boundary: 10MB−1 / 10MB / 10MB+1.
describe("CappedViewer — large-file byte cap (D7 / P1)", () => {
  function mockSize(size: number) {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data: { type: "file", size } }) }),
    ) as unknown as typeof fetch;
  }

  function renderCapped(size: number) {
    mockSize(size);
    return render(
      <ThemeProvider>
        <CappedViewer viewer="pdf" cwd="/proj" path="big.pdf" kind="pdf" mimeType="application/pdf" size={0} />
      </ThemeProvider>,
    );
  }

  it("at 10MB exactly → rich viewer mounts (not TooLargePreview)", async () => {
    const { queryByTestId, container } = renderCapped(MAX_PREVIEW_BYTES);
    await waitFor(() => expect(container.querySelector("canvas")).toBeTruthy());
    expect(queryByTestId("too-large-preview")).toBeNull();
  });

  it("at 10MB−1 → rich viewer mounts", async () => {
    const { queryByTestId, container } = renderCapped(MAX_PREVIEW_BYTES - 1);
    await waitFor(() => expect(container.querySelector("canvas")).toBeTruthy());
    expect(queryByTestId("too-large-preview")).toBeNull();
  });

  it("at 10MB+1 → TooLargePreview mounts, rich viewer does NOT", async () => {
    const { findByTestId, container } = renderCapped(MAX_PREVIEW_BYTES + 1);
    expect(await findByTestId("too-large-preview")).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
  });
});
