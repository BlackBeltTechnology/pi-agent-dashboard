/**
 * Component + selector tests for the canvas-type registry settings section.
 * See change: auto-canvas (task 5.2).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { displayedCanvasTypes } from "../../lib/canvas-types-api.js";
import { DEFAULT_CANVAS_TYPES } from "@blackbelt-technology/pi-dashboard-shared/canvas-types.js";
import { NON_FALLBACK_KINDS } from "@blackbelt-technology/pi-dashboard-shared/renderer-by-ext.js";
import { CanvasTypesSettingsSection } from "../CanvasTypesSettingsSection.js";

// Derive expectations from the live kind union so new preview kinds
// (docx/spreadsheet/email …) don't break these tests.
const ALL_KINDS = [...NON_FALLBACK_KINDS].sort();

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

// The section reads getApiBase(); stub the module so it needs no window setup.
vi.mock("../../lib/api-context.js", () => ({ getApiBase: () => "" }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function jsonOnce(body: unknown) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(body) });
}

describe("displayedCanvasTypes", () => {
  const res = {
    global: { html: false },
    project: { pdf: false },
    effective: {
      markdown: true, asciidoc: true, html: false, pdf: false,
      video: true, audio: true, image: true, youtube: true,
    },
  } as const;

  it("global scope shows default <- global (no project override)", () => {
    const d = displayedCanvasTypes("global", res as never);
    expect(d.html).toBe(false); // global override
    expect(d.pdf).toBe(true); // project override NOT applied
    expect(d.markdown).toBe(true);
  });

  it("project scope shows default <- global <- project (== effective)", () => {
    const d = displayedCanvasTypes("project", res as never);
    expect(d.html).toBe(false);
    expect(d.pdf).toBe(false);
  });
});

describe("CanvasTypesSettingsSection", () => {
  it("renders checkboxes reflecting fetched global values", async () => {
    jsonOnce({
      global: { html: false },
      project: {},
      effective: {
        markdown: true, asciidoc: true, html: false, pdf: true,
        video: true, audio: true, image: true, youtube: true,
      },
    });

    render(<CanvasTypesSettingsSection />);

    await waitFor(() => {
      expect((screen.getByTestId("canvas-type-html") as HTMLInputElement).checked).toBe(false);
    });
    expect((screen.getByTestId("canvas-type-markdown") as HTMLInputElement).checked).toBe(true);
    // every non-fallback kind present
    for (const k of NON_FALLBACK_KINDS) {
      expect(screen.getByTestId(`canvas-type-${k}`)).toBeTruthy();
    }
  });

  it("toggling a checkbox PATCHes the full kind map for the global scope", async () => {
    const allOn = { ...DEFAULT_CANVAS_TYPES };
    jsonOnce({ global: {}, project: {}, effective: allOn }); // initial GET
    jsonOnce({ global: { pdf: false }, project: {}, effective: { ...allOn, pdf: false } }); // PATCH

    render(<CanvasTypesSettingsSection />);
    await waitFor(() => {
      expect((screen.getByTestId("canvas-type-pdf") as HTMLInputElement).checked).toBe(true);
    });

    fireEvent.click(screen.getByTestId("canvas-type-pdf"));

    await waitFor(() => {
      expect((screen.getByTestId("canvas-type-pdf") as HTMLInputElement).checked).toBe(false);
    });

    // second fetch call is the PATCH
    const patchCall = mockFetch.mock.calls[1];
    expect(patchCall[1].method).toBe("PATCH");
    const body = JSON.parse(patchCall[1].body);
    expect(body.scope).toBe("global");
    expect(body.canvasTypes).toEqual({ ...allOn, pdf: false });
    // full kind map (sized to the live union)
    expect(Object.keys(body.canvasTypes).sort()).toEqual(ALL_KINDS);
  });

  it("disables project scope with a hint when no session selected", async () => {
    jsonOnce({
      global: {}, project: {},
      effective: {
        markdown: true, asciidoc: true, html: true, pdf: true,
        video: true, audio: true, image: true, youtube: true,
      },
    });

    render(<CanvasTypesSettingsSection />);
    await waitFor(() => {
      expect(screen.getByTestId("canvas-scope-global")).toBeTruthy();
    });
    expect((screen.getByTestId("canvas-scope-project") as HTMLButtonElement).disabled).toBe(true);
  });
});
