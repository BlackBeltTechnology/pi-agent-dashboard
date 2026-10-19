/**
 * TooLargePreview: default cap unchanged (CappedViewer path) + optional `cap`.
 * See change: harden-untrusted-content-ingestion (test-plan #F5, D6).
 */
import { OFFICE_SIZE_CAPS } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import {
  __resetEditorLimitsConfig,
  hydrateEditorLimitsConfig,
} from "../../../lib/preview/editor-limits-config.js";
import { DocxPreview } from "../../preview/DocxPreview.js";
import { TooLargePreview } from "../TooLargePreview.js";

afterEach(() => {
  cleanup();
  __resetEditorLimitsConfig();
});

describe("TooLargePreview", () => {
  it("F5: without `cap` the notice names the 10 MB default limit", () => {
    render(<TooLargePreview cwd="/proj" path="big.md" size={11 * 1024 * 1024} />);
    expect(screen.getByTestId("too-large-preview").textContent).toContain("limit 10 MB");
  });

  it("an explicit `cap` overrides the named limit", () => {
    render(<TooLargePreview cwd="/proj" path="big.xlsx" cap={50 * 1024 * 1024} />);
    expect(screen.getByTestId("too-large-preview").textContent).toContain("limit 50 MB");
  });

  it("without `cap` the notice names the configured editor limit from the store", () => {
    hydrateEditorLimitsConfig({ success: true, data: { editor: { largeFileLimitMb: 64 } } });
    render(<TooLargePreview cwd="/proj" path="big.md" size={70 * 1024 * 1024} />);
    expect(screen.getByTestId("too-large-preview").textContent).toContain("limit 64 MB");
  });

  // test-plan #E4 — the editor limit never leaks into an office 413 notice.
  it("E4: a docx 413 names the fixed 40 MB docx cap, not the 256 MB editor limit", async () => {
    hydrateEditorLimitsConfig({ success: true, data: { editor: { largeFileLimitMb: 256 } } });
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 413, json: () => Promise.resolve({ success: false }) }),
    ) as unknown as typeof fetch;
    try {
      render(<DocxPreview target={{ kind: "file", cwd: "/proj", path: "big.docx" }} />);
      const notice = await waitFor(() => screen.getByTestId("too-large-preview"));
      expect(notice.textContent).toContain(`limit ${OFFICE_SIZE_CAPS.docx / (1024 * 1024)} MB`);
      expect(notice.textContent).not.toContain("256 MB");
    } finally {
      globalThis.fetch = original;
    }
  });
});
