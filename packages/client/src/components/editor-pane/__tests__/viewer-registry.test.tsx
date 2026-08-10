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
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { CappedViewer } from "../CappedViewer.js";
import { pseudoTabRegistry } from "../pseudo-tab-registry.js";
import { OPEN_PATH_VIEWERS, PSEUDO_TAB_VIEWERS, isPseudoTabViewer } from "../viewer-kinds.js";
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
  // test-plan #E5 — the D3 split must be TOTAL and DISJOINT across the two
  // halves. Expected keys are derived from the const arrays in `viewer-kinds`
  // (never a hand-typed literal, which would false-pass while a kind is
  // unregistered); the `_AssertNever` checks in that module are what prove the
  // arrays themselves still match the `ViewerKind` union.
  // See change: cleanup-import-cycles (D3).
  it("half (a) registers exactly the fileKind()-returnable viewers", () => {
    expect(Object.keys(viewerRegistry).sort()).toEqual([...OPEN_PATH_VIEWERS].sort());
  });

  it("half (b) registers exactly the pseudo-tab viewers", () => {
    expect(Object.keys(pseudoTabRegistry).sort()).toEqual([...PSEUDO_TAB_VIEWERS].sort());
  });

  it("the two halves are disjoint and together cover all 18 viewer kinds", () => {
    const a = Object.keys(viewerRegistry);
    const b = Object.keys(pseudoTabRegistry);
    expect(a.filter((k) => b.includes(k))).toEqual([]);
    expect(new Set([...a, ...b]).size).toBe(18);
    expect(a).toHaveLength(14);
    expect(b).toHaveLength(4);
  });

  // test-plan #E6 — correct-half assignment. The compile-time checks prove the
  // union is partitioned but NOT that a kind sits in the right half (a swap
  // still partitions), so this is the only oracle for mis-routing.
  it("routes every kind to the correct half", () => {
    // `monaco` and `pdf` are `React.lazy` OBJECTS, not functions — assert the
    // entry is a renderable component type rather than over-specifying it.
    const isRenderable = (c: unknown) => c != null && ["function", "object"].includes(typeof c);
    for (const kind of OPEN_PATH_VIEWERS) {
      expect(isPseudoTabViewer(kind), kind).toBe(false);
      expect(isRenderable(viewerRegistry[kind]), kind).toBe(true);
      expect(Object.keys(pseudoTabRegistry), kind).not.toContain(kind);
    }
    for (const kind of PSEUDO_TAB_VIEWERS) {
      expect(isPseudoTabViewer(kind), kind).toBe(true);
      expect(isRenderable(pseudoTabRegistry[kind]), kind).toBe(true);
      expect(Object.keys(viewerRegistry), kind).not.toContain(kind);
    }
  });

  // `binary-warn` and `monaco` are fileKind()-returnable and were the two most
  // likely to be dropped when the partition was mis-counted as 12 + 4.
  it("keeps binary-warn and monaco in the fileKind()-returnable half", () => {
    expect(Object.keys(viewerRegistry)).toEqual(expect.arrayContaining(["binary-warn", "monaco"]));
  });

  it("registers a component for each rich office/document/email kind", () => {
    for (const kind of ["docx", "pptx", "spreadsheet", "asciidoc", "email"] as const) {
      expect(typeof viewerRegistry[kind], kind).toBe("function");
    }
  });

  it("pdf mounts the pdfjs continuous-scroll viewer, NOT an <object> plugin", async () => {
    // See change: pdf-preview-continuous-scroll — PdfPreview renders the pdfjs
    // component viewer (`.pdfViewerContainer` scroll box), not a bare <canvas>
    // + Prev/Next toolbar. pdfjs fills canvases into `.pdfViewer` at runtime.
    const { container } = renderKind("pdf");
    // PdfPreview is lazy here (Option B, change: fix-vite-build-warnings) — wait
    // for the <Suspense> boundary to resolve past its "Loading PDF viewer…"
    // fallback before asserting the viewer mounted.
    await waitFor(() => expect(container.querySelector(".pdfViewerContainer")).toBeTruthy());
    expect(container.querySelector("object")).toBeNull();
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
    await waitFor(() => expect(container.querySelector(".pdfViewerContainer")).toBeTruthy());
    expect(queryByTestId("too-large-preview")).toBeNull();
  });

  it("at 10MB−1 → rich viewer mounts", async () => {
    const { queryByTestId, container } = renderCapped(MAX_PREVIEW_BYTES - 1);
    await waitFor(() => expect(container.querySelector(".pdfViewerContainer")).toBeTruthy());
    expect(queryByTestId("too-large-preview")).toBeNull();
  });

  it("at 10MB+1 → TooLargePreview mounts, rich viewer does NOT", async () => {
    const { findByTestId, container } = renderCapped(MAX_PREVIEW_BYTES + 1);
    expect(await findByTestId("too-large-preview")).toBeTruthy();
    expect(container.querySelector("canvas")).toBeNull();
  });
});

/**
 * test-plan #X2 — an unregistered kind must be a COMPILE error, not a runtime
 * `<undefined/>`. The guard lives in `viewer-kinds.ts` as `_AssertNever`-based
 * type checks; this test proves those checks actually fail closed rather than
 * trusting them, because the obvious `const _x: T[] = []` spelling is vacuous
 * (an empty array literal is assignable to every array type, including
 * `never[]`) and would silently prove nothing.
 *
 * See change: cleanup-import-cycles (D3).
 */
describe("D3 partition guard fails closed (test-plan #X2)", () => {
  // Resolve through node, NOT process.cwd() — vitest runs this project with cwd
  // at packages/client, where the hoisted typescript is NOT a direct child. A
  // bad path makes execFileSync throw, which the negative cases would happily
  // read as "rejected", false-passing three of the four assertions.
  const tsc = require.resolve("typescript/lib/tsc.js");

  function compile(openPathMembers: string) {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { execFileSync } = require("node:child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-kinds-guard-"));
    const file = path.join(dir, "probe.ts");
    fs.writeFileSync(
      file,
      `type ViewerKind = "monaco" | "image" | "diff" | "terminal" | "url" | "live-server";
const PSEUDO_TAB_VIEWERS = ["diff","terminal","url","live-server"] as const;
const OPEN_PATH_VIEWERS = [${openPathMembers}] as const;
type _AssertNever<T extends never> = T;
type _Uncovered = _AssertNever<Exclude<ViewerKind,(typeof OPEN_PATH_VIEWERS)[number]|(typeof PSEUDO_TAB_VIEWERS)[number]>>;
type _NoExtraOpen = _AssertNever<Exclude<(typeof OPEN_PATH_VIEWERS)[number], ViewerKind>>;
type _NoOverlap = _AssertNever<Extract<(typeof OPEN_PATH_VIEWERS)[number],(typeof PSEUDO_TAB_VIEWERS)[number]>>;
`,
    );
    try {
      // --skipLibCheck isolates the probe: without it tsc pulls ambient
      // @types/* from node_modules, one of which (@types/diff) has a
      // pre-existing Intl.Segmenter error that would mask the real result.
      execFileSync(process.execPath, [tsc, "--noEmit", "--strict", "--skipLibCheck", file], {
        stdio: "pipe",
      });
      return 0;
    } catch (e: unknown) {
      return (e as { status?: number }).status ?? 1;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("accepts an exact, disjoint partition", () => {
    expect(compile('"monaco","image"')).toBe(0);
  });

  it("REJECTS a ViewerKind member registered in neither half", () => {
    expect(compile('"image"')).not.toBe(0); // monaco uncovered
  });

  it("REJECTS a member that is not a ViewerKind at all", () => {
    expect(compile('"monaco","image","bogus"')).not.toBe(0);
  });

  it("REJECTS a member present in BOTH halves", () => {
    expect(compile('"monaco","image","diff"')).not.toBe(0);
  });
}, 120_000);
